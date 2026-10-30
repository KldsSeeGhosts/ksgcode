import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as AcpErrors from "effect-acp/errors";
import type * as AcpSchema from "effect-acp/compat";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";

import { withAntigravityContext } from "./AntigravityContext.ts";

type Runtime = AcpSessionRuntime.AcpSessionRuntime["Service"];

function setup(
  stopReason: AcpSchema.PromptResponse["stopReason"] = "end_turn",
  summary = "Keep the pending task and verified findings.",
) {
  let sessionId = "original";
  let handler: Parameters<Runtime["handleSessionUpdate"]>[0] | undefined;
  const prompts: string[] = [];
  const resumed: string[] = [];
  const started = () => ({
    sessionId,
    initializeResult: { protocolVersion: 1 },
    sessionSetupResult: { sessionId },
    modelConfigId: undefined,
  });
  const base: Partial<Runtime> = {
    start: () => Effect.sync(started),
    getConfigOptions: Effect.succeed([]),
    getModeState: Effect.undefined,
    setMode: () => Effect.succeed({}),
    setConfigOption: () => Effect.succeed({ configOptions: [] }),
    handleSessionUpdate: (next) =>
      Effect.sync(() => {
        handler = next;
      }),
    handleRequestPermission: () => Effect.void,
    createSession: () =>
      Effect.sync(() => {
        sessionId = "replacement";
        return started();
      }),
    resumeSession: (id) =>
      Effect.sync(() => {
        resumed.push(id);
        sessionId = id;
        return started();
      }),
    prompt: (payload) =>
      Effect.gen(function* () {
        prompts.push(JSON.stringify(payload.prompt));
        yield* (
          handler?.({
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: summary },
            },
          }) ?? Effect.void
        );
        return { stopReason };
      }),
  };
  const runtime = withAntigravityContext(base as Runtime, () =>
    Effect.succeed({ usedTokens: sessionId === "original" ? 50_000 : 2_000 }),
  );
  return { runtime, prompts, resumed };
}

describe("Antigravity context", () => {
  it.effect(
    "summarizes into a fresh session, hides internal messages, and reports reduced context",
    () =>
      Effect.gen(function* () {
        const { runtime, prompts, resumed } = setup();
        const updates: AcpSchema.SessionNotification[] = [];
        yield* runtime.handleSessionUpdate((update) =>
          Effect.sync(() => {
            updates.push(update);
          }),
        );
        yield* runtime.start();
        const result = yield* runtime.compactSession!();
        assert.equal(result.replacement?.sessionId, "replacement");
        assert.deepEqual(result.contextUsage, { usedTokens: 2_000 });
        assert.equal(prompts.length, 2);
        assert.include(prompts[1]!, "Keep the pending task");
        assert.notInclude(prompts.join(""), "/compact");
        assert.deepEqual(resumed, []);
        assert.isFalse(
          updates.some(({ update }) => update.sessionUpdate === "agent_message_chunk"),
        );
      }),
  );

  it.effect.each([
    { reason: "cancelled", summary: "A partial summary.", cancelled: true },
    { reason: "max_tokens", summary: "An incomplete summary.", cancelled: false },
    { reason: "end_turn", summary: "", cancelled: false },
    { reason: "end_turn", summary: "x".repeat(48_001), cancelled: false },
  ] as const)("keeps the original session for an unusable summary: $reason", (testCase) =>
    Effect.gen(function* () {
      const { runtime, prompts } = setup(testCase.reason, testCase.summary);
      yield* runtime.handleSessionUpdate(() => Effect.void);
      yield* runtime.start();
      const result = yield* Effect.result(runtime.compactSession!());
      if (testCase.cancelled) {
        assert.equal(result._tag, "Success");
        if (result._tag === "Success") {
          assert.equal(result.success.response.stopReason, "cancelled");
          assert.isUndefined(result.success.replacement);
        }
      } else {
        assert.equal(result._tag, "Failure");
      }
      assert.equal((yield* runtime.start()).sessionId, "original");
      assert.equal(prompts.length, 1);
    }),
  );

  it.effect("restores the original session if replacement seeding fails", () =>
    Effect.gen(function* () {
      const { runtime, resumed } = setup();
      const prompt = runtime.prompt;
      let calls = 0;
      const wrapped = withAntigravityContext({
        ...runtime,
        prompt: (payload) =>
          ++calls === 2
            ? Effect.fail(
                new AcpErrors.AcpTransportError({ detail: "seed failed", cause: undefined }),
              )
            : prompt(payload),
      });
      yield* wrapped.handleSessionUpdate(() => Effect.void);
      yield* wrapped.start();
      const result = yield* Effect.result(wrapped.compactSession!());
      assert.equal(result._tag, "Failure");
      assert.deepEqual(resumed, ["original"]);
      assert.equal((yield* wrapped.start()).sessionId, "original");
    }),
  );
});
