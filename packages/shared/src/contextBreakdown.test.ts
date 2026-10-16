import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { estimateContextBreakdown, makeContextSizeTracker } from "./contextBreakdown.ts";

// Only the fields the tracker reads matter, so items are built loosely.
function item(id: string, fields: Record<string, unknown>): OrchestrationV2TurnItem {
  return { id, ...fields } as unknown as OrchestrationV2TurnItem;
}

const message = (id: string, chars: number) =>
  item(id, { type: "assistant_message", text: "x".repeat(chars) });
const command = (id: string, input: number, output: number) =>
  item(id, { type: "command_execution", input: "i".repeat(input), output: "o".repeat(output) });

describe("context size tracker", () => {
  it("sums sizes per category", () => {
    const tracker = makeContextSizeTracker();
    tracker.apply(message("a", 700));
    tracker.apply(command("b", 35, 3_500));
    expect(tracker.totals()).toMatchObject({ messages: 700, toolCalls: 35, toolOutput: 3_500 });
  });

  it("replaces an item that streams in again instead of adding to it", () => {
    const tracker = makeContextSizeTracker();
    tracker.apply(message("a", 100));
    tracker.apply(message("a", 400));
    expect(tracker.totals().messages).toBe(400);
  });

  it("drops everything before a compaction and keeps its summary", () => {
    const tracker = makeContextSizeTracker();
    tracker.apply(message("a", 5_000));
    tracker.apply(command("b", 10, 9_000));
    tracker.apply(item("c", { type: "compaction", summary: "s".repeat(300) }));
    tracker.apply(message("d", 70));
    expect(tracker.totals()).toMatchObject({ messages: 370, toolCalls: 0, toolOutput: 0 });
  });

  it("ignores items that never enter the model context", () => {
    const tracker = makeContextSizeTracker();
    tracker.apply(item("a", { type: "checkpoint" }));
    expect(Object.values(tracker.totals()).every((chars) => chars === 0)).toBe(true);
  });
});

describe("estimateContextBreakdown", () => {
  it("leaves the unexplained remainder as an inferred system row", () => {
    const tracker = makeContextSizeTracker();
    tracker.apply(message("a", 3_500)); // 1000 tokens
    tracker.apply(command("b", 0, 7_000)); // 2000 tokens
    const rows = estimateContextBreakdown(tracker.totals(), 10_000);
    expect(rows).toEqual([
      { label: "System", tokens: 7_000, kind: "inferred" },
      { label: "Tool output", tokens: 2_000, kind: "estimated" },
      { label: "Messages", tokens: 1_000, kind: "estimated" },
    ]);
  });

  it("scales sized items down to the reported total when they overshoot it", () => {
    const tracker = makeContextSizeTracker();
    tracker.apply(message("a", 7_000)); // 2000 tokens
    tracker.apply(command("b", 0, 7_000)); // 2000 tokens
    const rows = estimateContextBreakdown(tracker.totals(), 2_000);
    expect(rows?.map((row) => row.kind)).toEqual(["estimated", "estimated"]);
    expect(rows?.reduce((sum, row) => sum + row.tokens, 0)).toBe(2_000);
  });

  it("reports nothing without sized items or a usable total", () => {
    const tracker = makeContextSizeTracker();
    expect(estimateContextBreakdown(tracker.totals(), 10_000)).toBeUndefined();
    tracker.apply(message("a", 700));
    expect(estimateContextBreakdown(tracker.totals(), 0)).toBeUndefined();
  });
});
