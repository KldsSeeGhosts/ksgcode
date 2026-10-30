import { assert, describe, it } from "@effect/vitest";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import * as Effect from "effect/Effect";
import type * as AcpSchema from "effect-acp/compat";

import { withAntigravityContextUsage } from "./AntigravityContextUsage.ts";

type Runtime = AcpSessionRuntime.AcpSessionRuntime["Service"];

describe("Antigravity context usage", () => {
  it.effect.each([false, true])(
    "refreshes saved usage without overriding a fresh native report: %s",
    (nativeReport) =>
      Effect.gen(function* () {
        let handler: Parameters<Runtime["handleSessionUpdate"]>[0] | undefined;
        let savedUsage = 50_000;
        const updates: AcpSchema.SessionNotification[] = [];
        const started = {
          sessionId: "session-1",
          initializeResult: { protocolVersion: 1 },
          sessionSetupResult: { sessionId: "session-1" },
          modelConfigId: undefined,
        };
        const base: Partial<Runtime> = {
          start: () => Effect.succeed(started),
          handleSessionUpdate: (next) =>
            Effect.sync(() => {
              handler = next;
            }),
          prompt: () =>
            Effect.gen(function* () {
              savedUsage = 2_000;
              if (nativeReport) {
                yield* handler!({
                  sessionId: started.sessionId,
                  update: { sessionUpdate: "usage_update", used: 3_000, size: 100_000 },
                });
              }
              return { stopReason: "end_turn" as const };
            }),
        };
        const runtime = withAntigravityContextUsage(base as Runtime, () =>
          Effect.sync(() => ({ usedTokens: savedUsage })),
        );
        yield* runtime.handleSessionUpdate((update) =>
          Effect.sync(() => {
            updates.push(update);
          }),
        );
        yield* runtime.start();
        assert.deepEqual(updates[0]?.update, {
          sessionUpdate: "usage_update",
          used: 50_000,
          size: 0,
        });
        yield* runtime.prompt({ prompt: [{ type: "text", text: "Continue." }] });
        assert.deepEqual(updates.at(-1)?.update, {
          sessionUpdate: "usage_update",
          used: nativeReport ? 3_000 : 2_000,
          size: nativeReport ? 100_000 : 0,
        });
      }),
  );
});
