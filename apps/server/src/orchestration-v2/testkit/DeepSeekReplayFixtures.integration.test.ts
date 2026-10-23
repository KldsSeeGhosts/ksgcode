import { assert, describe, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { DEEPSEEK_PROFILE } from "@t3tools/provider-deepseek/server";

import { makeAcpAgentOrchestratorReplayHarness } from "../Adapters/AcpRegistryAdapterV2.testkit.ts";
import { runReplayFixture } from "./ProviderReplayFixtures.ts";
import {
  assertAssistantTextIncludes,
  assertBaseProjection,
  assertConversationMessageRoles,
  assertSemanticProjectionIntegrity,
  projectionFor,
} from "./fixtures/shared.ts";

const harness = makeAcpAgentOrchestratorReplayHarness(DEEPSEEK_PROFILE);

describe("DeepSeek Harness replay fixtures", () => {
  it.effect("runs recorded CPA model and reasoning selections through two orchestrated turns", () =>
    runReplayFixture({
      fixtureName: "deepseek_multi_turn",
      buildInput: () => ({
        steps: [
          { type: "message", text: "Reply HARNESS_OK." },
          { type: "message", text: "Reply HARNESS_OK." },
        ],
      }),
      harness,
      driver: {
        driver: ProviderDriverKind.make("deepseek"),
        transcriptFile: new URL(
          "./fixtures/deepseek_multi_turn/deepseek_transcript.ndjson",
          import.meta.url,
        ),
        modelSelection: {
          instanceId: ProviderInstanceId.make("deepseek"),
          model: '["cpa","opencode-go/deepseek-v4.1-flash"]',
          options: [{ id: "reasoning_effort", value: "high" }],
        },
        assertOutput: (result, transcript) => {
          assertBaseProjection({
            result,
            transcript,
            runCount: 2,
            runStatuses: ["completed", "completed"],
          });
          const projection = projectionFor(result, transcript.scenario);
          assertSemanticProjectionIntegrity(projection);
          assertConversationMessageRoles(projection, ["user", "assistant", "user", "assistant"]);
          assertAssistantTextIncludes(projection, "HARNESS_OK");
          assert.lengthOf(projection.providerThreads, 1);
          assert.lengthOf(
            projection.turnItems.filter((item) => item.type === "reasoning"),
            2,
          );
          assert.isTrue(
            projection.providerThreads.every((thread) => thread.providerInstanceId === "deepseek"),
          );
        },
      },
    }),
  );
});
