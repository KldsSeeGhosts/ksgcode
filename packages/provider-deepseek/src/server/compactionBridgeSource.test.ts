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
  readonly session: {
    readonly requestContext: () => { readonly contextWindow: number };
    readonly append: (type: string, data: unknown) => void;
  };
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
    readonly sessions: { readonly flush: (session: Agent["session"]) => Promise<void> };
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
    setSandboxMode: (session: Agent["session"], mode: string) =>
      session.append("sandbox/mode", { mode }),
    setApprovalPolicy: (session: Agent["session"], policy: string) =>
      session.append("approval/policy", { policy }),
  }) as MakeBridge;
  const native = queue<Frame>();
  const client = queue<Frame>();
  const requests = new TransformStream<Frame, Frame>();
  const input = requests.writable.getWriter();
  const events: Array<{ readonly type: string; readonly data: unknown }> = [];
  let flushes = 0;
  const agent: Agent = {
    session: {
      requestContext: () => ({ contextWindow: 1000 }),
      append: (type, data) => events.push({ type, data }),
    },
  };
  const bridge = makeBridge(
    {
      agents: { get: (id) => (id === "session" ? agent : undefined) },
      compaction: { compactNow },
      tokenMeter: { measure: () => ({ totalTokens: 40 }) },
      sessions: {
        flush: async () => {
          flushes++;
        },
      },
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
    events,
    get flushes() {
      return flushes;
    },
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
  it("advertises permission modes and persists unrestricted execution before acknowledging Full access", async () => {
    await using harness = setup(async () => null);
    await harness.send({ id: 1, method: "session/new", params: { cwd: "/work", mcpServers: [] } });
    await harness.readNative();
    await harness.reply({ id: 1, result: { sessionId: "session", configOptions: [] } });
    expect(await harness.read()).toMatchObject({
      id: 1,
      result: {
        sessionId: "session",
        modes: {
          currentModeId: "approval-required",
          availableModes: expect.arrayContaining([{ id: "full-access", name: "Full access" }]),
        },
      },
    });
    await harness.send({
      id: 2,
      method: "session/set_mode",
      params: { sessionId: "session", modeId: "full-access" },
    });
    expect(await harness.read()).toMatchObject({ id: 2, result: {} });
    expect(harness.events.slice(-2)).toEqual([
      { type: "sandbox/mode", data: { mode: "danger-full-access" } },
      { type: "approval/policy", data: { policy: "never" } },
    ]);
    expect(harness.flushes).toBe(2);
    expect(harness.forwarded.map((frame) => frame.method)).toEqual(["session/new"]);
  });

  it("restores Supervised restrictions on resume and can switch through automatic modes", async () => {
    await using harness = setup(async () => null);
    await harness.send({
      id: 1,
      method: "session/resume",
      params: { sessionId: "session", cwd: "/work", mcpServers: [] },
    });
    await harness.readNative();
    await harness.reply({ id: 1, result: { configOptions: [] } });
    expect(await harness.read()).toMatchObject({
      result: { modes: { currentModeId: "approval-required" } },
    });
    expect(harness.events).toEqual([
      { type: "sandbox/mode", data: { mode: "read-only" } },
      { type: "approval/policy", data: { policy: "ask" } },
    ]);
    for (const [modeId, sandbox, approval] of [
      ["full-access", "danger-full-access", "never"],
      ["approval-required", "read-only", "ask"],
      ["auto-accept-edits", "workspace-write", "ask"],
      ["auto", "danger-full-access", "ask"],
    ]) {
      await harness.send({
        id: 2,
        method: "session/set_mode",
        params: { sessionId: "session", modeId },
      });
      expect(await harness.read()).toMatchObject({ id: 2, result: {} });
      expect(harness.events.slice(-2)).toEqual([
        { type: "sandbox/mode", data: { mode: sandbox } },
        { type: "approval/policy", data: { policy: approval } },
      ]);
    }
    expect(harness.forwarded.map((frame) => frame.method)).toEqual(["session/resume"]);
  });

  it("rejects unknown sessions and invalid permission modes without changing native policy", async () => {
    await using harness = setup(async () => null);
    await harness.send({
      id: 1,
      method: "session/set_mode",
      params: { sessionId: "foreign", modeId: "full-access" },
    });
    expect(await harness.read()).toMatchObject({ id: 1, error: expect.anything() });
    await harness.open();
    const eventCount = harness.events.length;
    await harness.send({
      id: 2,
      method: "session/set_mode",
      params: { sessionId: "session", modeId: "invalid" },
    });
    expect(await harness.read()).toMatchObject({ id: 2, error: expect.anything() });
    expect(harness.events).toHaveLength(eventCount);
    expect(harness.forwarded.map((frame) => frame.method)).toEqual(["session/new"]);
  });

  it("does not change permissions during an active prompt", async () => {
    await using harness = setup(async () => null);
    await harness.open();
    await harness.send({
      id: 2,
      method: "session/prompt",
      params: { sessionId: "session", prompt: [{ type: "text", text: "Continue." }] },
    });
    await harness.readNative();
    const eventCount = harness.events.length;
    await harness.send({
      id: 3,
      method: "session/set_mode",
      params: { sessionId: "session", modeId: "full-access" },
    });
    expect(await harness.read()).toMatchObject({ id: 3, error: expect.anything() });
    expect(harness.events).toHaveLength(eventCount);
    await harness.reply({ id: 2, result: { stopReason: "end_turn" } });
    await harness.read();
    await harness.send({
      id: 4,
      method: "session/set_mode",
      params: { sessionId: "session", modeId: "full-access" },
    });
    expect(await harness.read()).toMatchObject({ id: 4, result: {} });
  });

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
