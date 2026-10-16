import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import {
  buildContextLegend,
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
  latestProviderTurnTokenUsage,
} from "./contextWindow";

describe("context window legend", () => {
  const row = (label: string, tokens: number, kind: "used" | "estimated" | "inferred" | "buffer") =>
    ({ label, tokens, kind }) as const;

  it("has no legend without a breakdown", () => {
    expect(buildContextLegend({ breakdown: null, maxTokens: 100_000 })).toBeNull();
  });

  it("folds rows past the fifth into Other and closes with buffer and free space", () => {
    const legend = buildContextLegend({
      maxTokens: 100_000,
      breakdown: [
        row("A", 9_000, "used"),
        row("B", 8_000, "used"),
        row("C", 7_000, "used"),
        row("D", 6_000, "used"),
        row("E", 5_000, "used"),
        row("F", 800, "used"),
        row("G", 200, "used"),
        row("Autocompact buffer", 30_000, "buffer"),
      ],
    });
    expect(legend?.map((item) => [item.label, item.tokens, item.kind])).toEqual([
      ["A", 9_000, "used"],
      ["B", 8_000, "used"],
      ["C", 7_000, "used"],
      ["D", 6_000, "used"],
      ["E", 5_000, "used"],
      ["Other", 1_000, "other"],
      ["Buffer", 30_000, "buffer"],
      ["Free space", 34_000, "free"],
    ]);
  });

  it("shows a lone trailing row as itself instead of folding it", () => {
    const legend = buildContextLegend({
      maxTokens: null,
      breakdown: [1, 2, 3, 4, 5, 6].map((n) => row(`R${n}`, n * 1_000, "estimated")),
    });
    expect(legend?.map((item) => item.label)).toEqual(["R6", "R5", "R4", "R3", "R2", "R1"]);
  });

  it("omits free space when the rows already fill the window", () => {
    const legend = buildContextLegend({
      maxTokens: 10_000,
      breakdown: [row("Messages", 12_000, "used")],
    });
    expect(legend?.map((item) => item.kind)).toEqual(["used"]);
  });
});

describe("latest provider turn usage breakdown", () => {
  const usage = (updatedAt: string, breakdown?: ReadonlyArray<never>) => ({
    tokenUsage: { usedTokens: 1, updatedAt, ...(breakdown ? { breakdown } : {}) },
  });

  it("carries the newest breakdown onto a newer report that has none", () => {
    const breakdown = [{ label: "Messages", tokens: 1, kind: "used" }] as never;
    const latest = latestProviderTurnTokenUsage([
      usage("2026-06-20T00:00:00.000Z", breakdown),
      usage("2026-06-20T00:05:00.000Z"),
    ]);
    expect(latest?.updatedAt).toBe("2026-06-20T00:05:00.000Z");
    expect(latest?.breakdown).toBe(breakdown);
  });
});

describe("V2 context window presentation", () => {
  it("uses retained compaction token data when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      {
        item: {
          id: "compaction-1" as never,
          threadId: "thread-1" as never,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 1,
          status: "completed",
          title: null,
          startedAt: null,
          completedAt: null,
          updatedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
          type: "compaction",
          driver: null,
          beforeTokenCount: 10_000,
          afterTokenCount: 2_000,
        },
      },
    ]);
    expect(snapshot?.usedTokens).toBe(2_000);
    expect(snapshot?.totalProcessedTokens).toBe(10_000);
  });

  it("prefers current provider usage and preserves ACP cost", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], undefined, {
      contextUsage: {
        usedTokens: 2_500,
        maxTokens: 10_000,
        cost: { amount: 0.42, currency: "USD" },
      },
      updatedAt: DateTime.makeUnsafe("2026-08-23T00:00:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      usedTokens: 2_500,
      maxTokens: 10_000,
      remainingTokens: 7_500,
      usedPercentage: 25,
      cost: { amount: 0.42, currency: "USD" },
    });
  });

  it("formats compact token values", () => {
    expect(formatContextWindowTokens(1_500)).toBe("1.5k");
  });

  it.each([
    [999_499, "999k"],
    [999_500, "1m"],
    [999_999, "1m"],
    [1_000_000, "1m"],
    [1_100_000, "1.1m"],
  ])("formats %d tokens as %s at the million boundary", (tokens, expected) => {
    expect(formatContextWindowTokens(tokens)).toBe(expected);
  });
});

describe("live provider-turn usage (#8144)", () => {
  it("prefers the provider's live report over compaction items", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], {
      usedTokens: 42_000,
      maxTokens: 200_000,
      inputTokens: 40_000,
      outputTokens: 2_000,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(42_000);
    expect(snapshot?.maxTokens).toBe(200_000);
    expect(snapshot?.remainingTokens).toBe(158_000);
    expect(snapshot?.usedPercentage).toBe(21);
  });

  it("handles a report without a known context window", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], {
      usedTokens: 42_000,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(snapshot?.maxTokens).toBeNull();
    expect(snapshot?.usedPercentage).toBeNull();
  });
});

describe("latestProviderTurnTokenUsage", () => {
  it("picks the newest report, not the last turn in snapshot order", () => {
    const usage = (usedTokens: number, updatedAt: string) => ({
      tokenUsage: { usedTokens, updatedAt },
    });
    // Snapshots sort by provider thread id, so an older thread can come last.
    const latest = latestProviderTurnTokenUsage([
      usage(300_000, "2026-06-20T12:00:00.000Z"),
      {},
      usage(90_000, "2026-06-20T09:00:00.000Z"),
    ]);
    expect(latest?.usedTokens).toBe(300_000);
  });
});
