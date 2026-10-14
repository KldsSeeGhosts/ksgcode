import { assert } from "@effect/vitest";
import type { ProviderReplayTranscript } from "@t3tools/contracts";

import type { OrchestratorV2ScenarioResult } from "../../OrchestratorScenario.ts";
import {
  assertBaseProjection,
  assertSemanticProjectionIntegrity,
  projectionFor,
} from "../shared.ts";
import { HERMES_COMPACTION_NORMAL_PROMPT } from "./input.ts";

/** What Hermes replies to the fixture's ordinary prompt. */
const HERMES_COMPACTION_NORMAL_REPLY = "OK";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/**
 * A user `/compact` reaches Hermes as the flavor's `/compress` prompt, its
 * completed turn projects one synthetic compaction item, and the next turn
 * still runs. The transcript's `compaction.prompt` expectation matches
 * `/compress` exactly, so the replay peer fails the run if the adapter ever
 * sends `/compact` (or anything else) instead.
 */
export function assertHermesCompactionOutput(
  result: OrchestratorV2ScenarioResult,
  transcript: ProviderReplayTranscript,
) {
  const promptTexts = transcript.entries.flatMap((entry) => {
    if (entry.type !== "expect_outbound") return [];
    const frame = entry.frame;
    if (field(frame, "method") !== "session/prompt") return [];
    const prompt = field(field(frame, "params"), "prompt");
    return Array.isArray(prompt)
      ? [
          prompt.flatMap((part) =>
            typeof field(part, "text") === "string" ? [field(part, "text") as string] : [],
          ),
        ]
      : [];
  });
  assert.lengthOf(promptTexts, 3, "one prompt per fixture turn");
  assert.isFalse(
    promptTexts.some((parts) => parts.some((text) => text.includes("/compact"))),
    "/compact must never reach Hermes as a prompt",
  );
  const compactionPrompt = transcript.entries.find(
    (entry) => entry.type === "expect_outbound" && entry.label === "compaction.prompt",
  );
  assert.isDefined(compactionPrompt, "the fixture must record the compaction prompt");
  const compactionPromptParts = field(field(field(compactionPrompt, "frame"), "params"), "prompt");
  const compactionPromptPartList = Array.isArray(compactionPromptParts)
    ? compactionPromptParts
    : [];
  assert.equal(field(compactionPromptPartList[0], "text"), "/compress");
  assert.equal(promptTexts[2]?.[0], HERMES_COMPACTION_NORMAL_PROMPT);

  assertBaseProjection({
    result,
    transcript,
    runCount: 3,
    runStatuses: ["completed", "completed", "completed"],
  });
  const projection = projectionFor(result, transcript.scenario);
  assertSemanticProjectionIntegrity(projection);
  assert.deepEqual(
    projection.providerTurns.map((turn) => turn.status),
    ["completed", "completed", "completed"],
  );

  const compactionRun = projection.runs[1];
  const compactions = projection.turnItems.filter((item) => item.type === "compaction");
  assert.lengthOf(compactions, 1);
  const [compaction] = compactions;
  assert.equal(compaction?.runId, compactionRun?.id);
  assert.equal(compaction?.status, "completed");
  assert.equal(compaction?.title, "Context compacted");
  assert.isFalse(
    projection.turnItems.some((item) => item.type === "error" && item.runId === compactionRun?.id),
    "the compaction run must not fail",
  );
  // Hermes answers the compaction prompt with its own summary text; that reply
  // is the compaction run's assistant message.
  const compactionReply = projection.turnItems.find(
    (item) => item.type === "assistant_message" && item.runId === compactionRun?.id,
  );
  assert.include(
    compactionReply?.type === "assistant_message" ? compactionReply.text : "",
    "Context compressed",
  );

  // The turn after compaction answers, so the session survived compressing.
  const lastRun = projection.runs[2];
  const lastAssistant = projection.turnItems.findLast((item) => item.type === "assistant_message");
  assert.equal(lastAssistant?.runId, lastRun?.id);
  assert.equal(
    lastAssistant?.type === "assistant_message" ? lastAssistant.text : undefined,
    HERMES_COMPACTION_NORMAL_REPLY,
  );
}
