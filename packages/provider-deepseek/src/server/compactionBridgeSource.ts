// The plugin runs in the user's dsh installation and resolves Harness's own dependencies there.
export const DEEPSEEK_COMPACTION_BRIDGE_SOURCE = String.raw`
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Readable, Writable } from "node:stream";

const require = createRequire(process.argv[1]);
const appRequire = createRequire(require.resolve("@deepseek-ai/dsh-acp-app"));
const acpPath = appRequire.resolve("@deepseek-ai/dsh-acp");
const acp = await import(pathToFileURL(acpPath).href);
const { ndJsonStream } = await import(pathToFileURL(createRequire(acpPath).resolve("@agentclientprotocol/sdk")).href);

export const name = "ksg-deepseek-acp";
export const Config = acp.Config;
export const inject = [...acp.inject, "compaction", "tokenMeter"];

export function makeCompactionBridge({ agents, compaction, tokenMeter }, wire) {
  const reader = wire.readable.getReader();
  const writer = wire.writable.getWriter();
  const sessions = new Set();
  const forwarded = new Map();
  const active = new Map();
  let disposed = false;
  let input;
  const readable = new ReadableStream({ start(controller) { input = controller; } });
  const send = message => writer.write(message);
  const result = (id, value) => send({ jsonrpc: "2.0", id, result: value });
  const failure = (id, message) => send({ jsonrpc: "2.0", id, error: { code: -32603, message } });
  const notify = (sessionId, update) =>
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
  const failures = {
    busy: "Compaction requires an idle Harness session.",
    changed: "The history changed during compaction. Retry when the session is idle.",
    summary: "Harness could not produce a useful compaction summary.",
    commit: "Harness could not commit compaction. Inspect the native session before retrying.",
    persistence: "Harness compacted history but could not save the native session.",
  };

  const startCompaction = message => {
    const sessionId = message.params.sessionId;
    if (!sessions.has(sessionId)) return failure(message.id, "Unknown Harness session.");
    if (active.has(sessionId) || [...forwarded.values()].some(request =>
      request.method === "session/prompt" && request.params?.sessionId === sessionId)) {
      return failure(message.id, failures.busy);
    }
    const agent = agents.get(sessionId);
    if (!agent) return failure(message.id, "Unknown Harness session.");
    const operation = { id: message.id, abort: new AbortController(), done: undefined };
    active.set(sessionId, operation);
    const finish = (value, error) => {
      if (active.get(sessionId) === operation) active.delete(sessionId);
      return error === undefined ? result(message.id, value) : failure(message.id, error);
    };
    operation.done = (async () => {
      try {
        const compacted = await compaction.compactNow(agent, operation.abort.signal);
        if (compacted === null) {
          return await finish(undefined, "No compactable history yet.");
        }
        await notify(sessionId, {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Compacted " + compacted.shadowedSeqs.length + " history items." },
        });
        const size = agent.session.requestContext()?.contextWindow;
        if (size !== undefined) {
          await notify(sessionId, {
            sessionUpdate: "usage_update",
            used: tokenMeter.measure(agent.session).totalTokens,
            size,
          });
        }
        await finish({ stopReason: "end_turn" });
      } catch (error) {
        if (operation.abort.signal.aborted || error?.code === "cancelled") {
          await finish({ stopReason: "cancelled" });
        } else {
          const failureMessage = Object.hasOwn(failures, error?.code)
            ? failures[error.code] : "Native Harness compaction failed.";
          await finish(undefined, failureMessage);
        }
      } finally {
        if (active.get(sessionId) === operation) active.delete(sessionId);
      }
    })();
    return operation.done;
  };

  const writable = new WritableStream({
    async write(message) {
      if (!message.method && forwarded.has(message.id)) {
        const request = forwarded.get(message.id);
        forwarded.delete(message.id);
        if (message.result) {
          if (request.method === "session/new") sessions.add(message.result.sessionId);
          if (request.method === "session/resume") sessions.add(request.params.sessionId);
          if (request.method === "session/close") sessions.delete(request.params.sessionId);
        }
      }
      await send(message);
    },
  });

  const pump = (async () => {
    try {
      while (!disposed) {
        const { value: message, done } = await reader.read();
        if (done || disposed) break;
        const sessionId = message.params?.sessionId;
        const operation = active.get(sessionId);
        if (message.method === "session/cancel" && operation) {
          operation.abort.abort();
          continue;
        }
        if (message.method === "$/cancel_request") {
          const cancelled = [...active.values()].find(item => item.id === message.params?.requestId);
          if (cancelled) {
            cancelled.abort.abort();
            continue;
          }
        }
        const prompt = message.params?.prompt;
        if (message.method === "session/prompt" && message.id !== undefined &&
          Array.isArray(prompt) && prompt.length === 1 && prompt[0].type === "text" &&
          prompt[0].text.trim() === "/compact") {
          // Keep reading so session/cancel can abort the native maintenance operation.
          void startCompaction(message).catch(() => {});
          continue;
        }
        if (message.method === "session/prompt" && operation) {
          await failure(message.id, failures.busy);
          continue;
        }
        if (message.method === "session/close" && operation) {
          operation.abort.abort();
          await operation.done;
        }
        if (message.method && message.id !== undefined) forwarded.set(message.id, message);
        input.enqueue(message);
      }
    } catch (error) {
      if (!disposed) throw error;
    } finally {
      for (const operation of active.values()) operation.abort.abort();
      await Promise.allSettled([...active.values()].map(operation => operation.done));
      input.close();
    }
  })();
  // A failed client transport also closes the native ACP input in the pump's finalizer.
  void pump.catch(() => {});

  return {
    stream: { readable, writable },
    async dispose() {
      disposed = true;
      for (const operation of active.values()) operation.abort.abort();
      await reader.cancel();
      await pump;
    },
  };
}

export function apply(ctx, config) {
  const bridge = makeCompactionBridge({
    agents: ctx.agents,
    compaction: ctx.compaction,
    tokenMeter: ctx.tokenMeter,
  }, ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
  ctx.effect(() => () => bridge.dispose());
  acp.apply(ctx, { ...config, stream: bridge.stream });
}
`;
