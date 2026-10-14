import type { OrchestratorFixtureInput } from "../shared.ts";

export const HERMES_COMPACTION_NORMAL_PROMPT = "Reply with exactly the word OK.";

/**
 * Hermes names compaction `/compress`, so the user's `/compact` (T3's Compact
 * action) must reach it as `/compress`. Two ordinary turns bracket the
 * compaction so the scenario proves the session still works afterward.
 */
export function hermesCompactionInput(): OrchestratorFixtureInput {
  return {
    steps: [
      { type: "message", text: HERMES_COMPACTION_NORMAL_PROMPT },
      { type: "message", text: "/compact" },
      { type: "message", text: HERMES_COMPACTION_NORMAL_PROMPT },
    ],
  };
}
