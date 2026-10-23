// @effect-diagnostics nodeBuiltinImport:off -- The plugin runs in Harness, outside the Effect runtime.
import * as NodeVM from "node:vm";
import { describe, expect, it } from "vite-plus/test";

import { DEEPSEEK_COMPACTION_BRIDGE_SOURCE } from "./compactionBridgeSource.ts";

interface Frame {
  readonly jsonrpc?: string;
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}
interface Agent {
  readonly session: { readonly requestContext: () => { readonly contextWindow: number } };
}
type CompactNow = (
  agent: Agent,
  signal: AbortSignal,
) => Promise<{ readonly shadowedSeqs: ReadonlyArray<number> } | null>;
interface Bridge {
  readonly stream: {
    readonly readable: ReadableStream<Frame>;
    readonly writable: WritableStream<Frame>;
  };
  readonly dispose: () => Promise<void>;
}
type MakeBridge = (
  services: {
    readonly agents: { readonly get: (id: string) => Agent | undefined };
    readonly compaction: { readonly compactNow: CompactNow };
    readonly tokenMeter: { readonly measure: () => { readonly totalTokens: number } };
  },
  wire: { readonly readable: ReadableStream<Frame>; readonly writable: WritableStream<Frame> },
) => Bridge;

function queue<T>() {
  const values: Array<T> = [];
  const waiting: Array<(value: T) => void> = [];
  return {
    put(value: T) {
      const resolve = waiting.shift();
      if (resolve) resolve(value);
      else values.push(value);
    },
    take: () =>
      new Promise<T>((resolve) => {
        if (values.length > 0) resolve(values.shift()!);
        else waiting.push(resolve);
      }),
  };
}

function setup(compactNow: CompactNow) {
  const source = DEEPSEEK_COMPACTION_BRIDGE_SOURCE.slice(
    DEEPSEEK_COMPACTION_BRIDGE_SOURCE.indexOf("export function makeCompactionBridge"),
    DEEPSEEK_COMPACTION_BRIDGE_SOURCE.indexOf("export function apply"),
  ).replace("export function", "function");
  const makeBridge = NodeVM.runInNewContext(`${source}; makeCompactionBridge`, {
    ReadableStream,
    WritableStream,
    AbortController,
  }) as MakeBridge;
  const native = queue<Frame>();
  const client = queue<Frame>();
  const requests = new TransformStream<Frame, Frame>();
  const input = requests.writable.getWriter();
  const agent: Agent = { session: { requestContext: () => ({ contextWindow: 1000 }) } };
  const bridge = makeBridge(
    {
      agents: { get: (id) => (id === "session" ? agent : undefined) },
      compaction: { compactNow },
      tokenMeter: { measure: () => ({ totalTokens: 40 }) },
    },
    {
      readable: requests.readable,
      writable: new WritableStream({ write: (frame) => client.put(frame) }),
    },
  );
  const nativeOutput = bridge.stream.writable.getWriter();
  const forwarded: Array<Frame> = [];
  const drainNative = (async () => {
    for await (const frame of bridge.stream.readable) {
      forwarded.push(frame);
      native.put(frame);
    }
  })();
  return {
    agent,
    forwarded,
    send: (frame: Frame) => input.write(frame),
    disconnect: () => input.close(),
    reply: (frame: Frame) => nativeOutput.write(frame),
    read: client.take,
    readNative: native.take,
    async open() {
      await input.write({ id: 1, method: "session/new", params: { cwd: "/work", mcpServers: [] } });
      await native.take();
      await nativeOutput.write({ id: 1, result: { sessionId: "session" } });
      await client.take();
    },
    async [Symbol.asyncDispose]() {
      await bridge.dispose();
      await drainNative;
      input.releaseLock();
      nativeOutput.releaseLock();
    },
  };
}

const compact = (id = 2): Frame => ({
  id,
  method: "session/prompt",
  params: { sessionId: "session", prompt: [{ type: "text", text: "/compact" }] },
});

describe("Harness native compaction bridge", () => {
  it("compacts the owned native agent and sends measured usage before completion", async () => {
    const calls: Array<Agent> = [];
    await using harness = setup(async (agent) => {
      calls.push(agent);
      return { shadowedSeqs: [1, 2, 3] };
    });
    await harness.open();
    await harness.send(compact());
    expect(await harness.read()).toMatchObject({
      method: "session/update",
      params: {
        sessionId: "session",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Compacted 3 history items." },
        },
      },
    });
    expect(await harness.read()).toMatchObject({
      params: { update: { sessionUpdate: "usage_update", used: 40, size: 1000 } },
    });
    expect(await harness.read()).toMatchObject({ id: 2, result: { stopReason: "end_turn" } });
    expect(calls).toEqual([harness.agent]);
    expect(harness.forwarded.map((frame) => frame.method)).toEqual(["session/new"]);
  });

  it("does not claim compaction when native history is too short", async () => {
    await using harness = setup(async () => null);
    await harness.open();
    await harness.send(compact());
    expect(await harness.read()).toMatchObject({
      id: 2,
      error: { message: "No compactable history yet." },
    });
    const next = {
      id: 3,
      method: "session/prompt",
      params: { sessionId: "session", prompt: [{ type: "text", text: "Continue." }] },
    };
    await harness.send(next);
    expect(await harness.readNative()).toEqual(next);
    await harness.reply({ id: 3, result: { stopReason: "end_turn" } });
    expect(await harness.read()).toMatchObject({ id: 3, result: { stopReason: "end_turn" } });
  });

  it("rejects unowned sessions without invoking compaction", async () => {
    let calls = 0;
    await using harness = setup(async () => {
      calls++;
      return null;
    });
    await harness.send(compact());
    expect(await harness.read()).toMatchObject({
      id: 2,
      error: { message: "Unknown Harness session." },
    });
    expect(calls).toBe(0);
  });

  it.each(["session/cancel", "$/cancel_request"])(
    "%s cancels native maintenance without losing the first request",
    async (method) => {
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      await using harness = setup(
        (_agent, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
            entered();
          }),
      );
      await harness.open();
      await harness.send(compact());
      await started;
      await harness.send(compact(3));
      expect(await harness.read()).toMatchObject({
        id: 3,
        error: { message: "Compaction requires an idle Harness session." },
      });
      await harness.send({
        method,
        params: method === "session/cancel" ? { sessionId: "session" } : { requestId: 2 },
      });
      expect(await harness.read()).toMatchObject({ id: 2, result: { stopReason: "cancelled" } });
      expect(harness.forwarded.map((frame) => frame.method)).toEqual(["session/new"]);
    },
  );

  it("compacts a resumed session whose response contains no session ID", async () => {
    const calls: Array<Agent> = [];
    await using harness = setup(async (agent) => {
      calls.push(agent);
      return { shadowedSeqs: [1] };
    });
    await harness.send({
      id: 1,
      method: "session/resume",
      params: { sessionId: "session", cwd: "/work", mcpServers: [] },
    });
    await harness.readNative();
    await harness.reply({ id: 1, result: { configOptions: [] } });
    await harness.read();
    await harness.send(compact());
    await harness.read();
    await harness.read();
    expect(await harness.read()).toMatchObject({ id: 2, result: { stopReason: "end_turn" } });
    expect(calls).toEqual([harness.agent]);
  });

  it("stops native compaction when the client disconnects", async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    await using harness = setup(
      (_agent, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
          entered();
        }),
    );
    await harness.open();
    await harness.send(compact());
    await started;
    await harness.disconnect();
    expect(await harness.read()).toMatchObject({ id: 2, result: { stopReason: "cancelled" } });
  });

  it("cancels maintenance before forwarding session close", async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    await using harness = setup(
      (_agent, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
          entered();
        }),
    );
    await harness.open();
    await harness.send(compact());
    await started;
    await harness.send({ id: 3, method: "session/close", params: { sessionId: "session" } });
    expect(await harness.read()).toMatchObject({ id: 2, result: { stopReason: "cancelled" } });
    expect(await harness.readNative()).toMatchObject({ id: 3, method: "session/close" });
    await harness.reply({ id: 3, result: {} });
    await harness.read();
    await harness.send(compact(4));
    expect(await harness.read()).toMatchObject({
      id: 4,
      error: { message: "Unknown Harness session." },
    });
  });

  it("reports native summary failures without leaking raw diagnostics", async () => {
    await using harness = setup(async () => {
      throw Object.assign(new Error("api_key=private"), { code: "summary" });
    });
    await harness.open();
    await harness.send(compact());
    expect(await harness.read()).toMatchObject({
      id: 2,
      error: { message: "Harness could not produce a useful compaction summary." },
    });
  });
});
