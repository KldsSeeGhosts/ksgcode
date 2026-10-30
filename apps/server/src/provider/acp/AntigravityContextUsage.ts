import type { ThreadTokenUsageSnapshot } from "@t3tools/contracts";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import * as Effect from "effect/Effect";

type Runtime = AcpSessionRuntime.AcpSessionRuntime["Service"];

export function withAntigravityContextUsage(
  runtime: Runtime,
  readUsage: (sessionId: string) => Effect.Effect<ThreadTokenUsageSnapshot | null> = () =>
    Effect.succeed(null),
): Runtime {
  let sessionId: string | undefined;
  let handler: Parameters<Runtime["handleSessionUpdate"]>[0] | undefined;
  const usageBySession = new Map<string, ThreadTokenUsageSnapshot>();
  const refreshUsage = Effect.fn("AntigravityContextUsage.refreshUsage")(function* (
    preferNative = false,
  ) {
    if (sessionId === undefined) return;
    const saved = yield* readUsage(sessionId);
    const native = usageBySession.get(sessionId);
    const usage =
      preferNative && native !== undefined
        ? native
        : saved === null
          ? (native ?? null)
          : { ...native, ...saved };
    if (usage !== null) {
      usageBySession.set(sessionId, usage);
      if (handler !== undefined) {
        yield* handler({
          sessionId,
          update: {
            sessionUpdate: "usage_update",
            used: usage.usedTokens,
            size: usage.maxTokens ?? 0,
          },
        });
      }
    }
  });
  const adopt = (started: AcpSessionRuntime.AcpSessionRuntimeStartResult) =>
    Effect.sync(() => {
      sessionId = started.sessionId;
    }).pipe(Effect.andThen(refreshUsage()), Effect.as(started));
  return {
    ...runtime,
    start: () => runtime.start().pipe(Effect.flatMap(adopt)),
    resumeSession: (id, options) => runtime.resumeSession(id, options).pipe(Effect.flatMap(adopt)),
    loadSession: (id, options) => runtime.loadSession(id, options).pipe(Effect.flatMap(adopt)),
    prompt: Effect.fn("AntigravityContextUsage.prompt")(function* (payload, options) {
      const before = sessionId === undefined ? undefined : usageBySession.get(sessionId);
      const result = yield* runtime.prompt(payload, options);
      yield* refreshUsage(sessionId !== undefined && usageBySession.get(sessionId) !== before);
      return result;
    }),
    handleSessionUpdate: (next) => {
      handler = next;
      return runtime.handleSessionUpdate((notification) => {
        const update = notification.update;
        if (update.sessionUpdate === "usage_update") {
          usageBySession.set(notification.sessionId, {
            usedTokens: update.used,
            ...(update.size > 0 ? { maxTokens: update.size } : {}),
          });
        }
        return next(notification);
      });
    },
  };
}
