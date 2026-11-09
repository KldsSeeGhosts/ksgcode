import { describe, expect, it } from "vite-plus/test";
import { OrchestrationV2ProviderTurnTokenUsage } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { formatContextWindowCompactionMessage } from "../components/chat/compaction.logic";
import * as DateTime from "effect/DateTime";
import {
  ContextTransferId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { makeThreadProjectionFixture } from "../test-fixtures";
import { buildContextLegend } from "./contextWindow";
import {
  activeProviderTokenUsage,
  deriveLatestContextWindowSnapshot,
  latestProviderTurnTokenUsage,
  shouldOfferResumeCompaction,
} from "@t3tools/client-runtime/state/context-window";

const decodeTokenUsage = Schema.decodeSync(OrchestrationV2ProviderTurnTokenUsage);

describe("context window legend", () => {
  const row = (label: string, tokens: number, kind: "used" | "estimated" | "inferred" | "buffer") =>
    ({ label, tokens, kind }) as const;

  it("has no legend without a breakdown", () => {
    expect(buildContextLegend({ breakdown: null, maxTokens: 100_000, usedTokens: 0 })).toBeNull();
  });

  it("folds rows past the fifth into Other and closes with buffer and free space", () => {
    const legend = buildContextLegend({
      maxTokens: 100_000,
      usedTokens: 36_000,
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
      usedTokens: 21_000,
      breakdown: [1, 2, 3, 4, 5, 6].map((n) => row(`R${n}`, n * 1_000, "estimated")),
    });
    expect(legend?.map((item) => item.label)).toEqual(["R6", "R5", "R4", "R3", "R2", "R1"]);
  });

  it("shows a trailing breakdown's gap to the reported total and frees only what is unused", () => {
    const legend = buildContextLegend({
      maxTokens: 100_000,
      usedTokens: 60_000,
      breakdown: [
        row("Messages", 30_000, "used"),
        row("System", 10_000, "used"),
        row("Autocompact buffer", 20_000, "buffer"),
      ],
    });
    expect(legend?.map((item) => [item.label, item.tokens, item.kind])).toEqual([
      ["Messages", 30_000, "used"],
      ["System", 10_000, "used"],
      ["Uncategorized", 20_000, "inferred"],
      ["Buffer", 20_000, "buffer"],
      ["Free space", 20_000, "free"],
    ]);
  });

  it("omits free space when the rows already fill the window", () => {
    const legend = buildContextLegend({
      maxTokens: 10_000,
      usedTokens: 12_000,
      breakdown: [row("Messages", 12_000, "used")],
    });
    expect(legend?.map((item) => item.kind)).toEqual(["used"]);
  });
});

describe("latest provider turn usage breakdown", () => {
  const breakdown = [
    { label: "Messages", tokens: 40_000, kind: "used" },
    { label: "Autocompact buffer", tokens: 30_000, kind: "buffer" },
  ] as const;
  const usage = (
    updatedAt: string,
    usedTokens: number,
    maxTokens: number,
    withBreakdown = false,
  ) => ({
    tokenUsage: { usedTokens, maxTokens, updatedAt, ...(withBreakdown ? { breakdown } : {}) },
  });

  it("carries the newest breakdown onto a newer report that has none", () => {
    const latest = latestProviderTurnTokenUsage([
      usage("2026-06-20T00:00:00.000Z", 40_000, 200_000, true),
      usage("2026-06-20T00:05:00.000Z", 45_000, 200_000),
    ]);
    expect(latest?.updatedAt).toBe("2026-06-20T00:05:00.000Z");
    expect(latest?.breakdown).toBe(breakdown);
  });

  it.each([
    ["the context window changed", 45_000, 1_000_000],
    ["compaction shrank the context", 12_000, 200_000],
  ])("drops the older breakdown when %s", (_, usedTokens, maxTokens) => {
    const latest = latestProviderTurnTokenUsage([
      usage("2026-06-20T00:00:00.000Z", 40_000, 200_000, true),
      usage("2026-06-20T00:05:00.000Z", usedTokens, maxTokens),
    ]);
    expect(latest?.usedTokens).toBe(usedTokens);
    expect(latest?.breakdown).toBeUndefined();
  });
});

describe("activeProviderTokenUsage", () => {
  it("ignores the previous provider conversation's usage after a switch", () => {
    const projection = makeThreadProjectionFixture();
    const turn = (providerThreadId: string, usedTokens: number, updatedAt: string) =>
      ({
        providerThreadId,
        tokenUsage: { usedTokens, maxTokens: 1_000_000, updatedAt },
      }) as never;
    const switched = {
      ...projection,
      thread: { ...projection.thread, activeProviderThreadId: "next" as never },
      providerTurns: [
        turn("previous", 500_000, "2026-06-20T00:05:00.000Z"),
        turn("next", 20_000, "2026-06-20T00:00:00.000Z"),
      ],
    };
    expect(activeProviderTokenUsage(switched).usage?.usedTokens).toBe(20_000);
    expect(
      activeProviderTokenUsage({ ...switched, providerTurns: switched.providerTurns.slice(0, 1) })
        .usage,
    ).toBeNull();
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
});

describe("live provider-turn usage (#8144)", () => {
  it("prefers the provider's live report over compaction items", () => {
    const usage = decodeTokenUsage({
      usedTokens: 42_000,
      maxTokens: 200_000,
      inputTokens: 40_000,
      outputTokens: 2_000,
      autoCompactThreshold: 150_000,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    const snapshot = deriveLatestContextWindowSnapshot([], usage);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(42_000);
    expect(snapshot?.maxTokens).toBe(200_000);
    expect(snapshot?.remainingTokens).toBe(158_000);
    expect(snapshot?.usedPercentage).toBe(21);
    expect(snapshot?.autoCompactThreshold).toBe(150_000);
    expect(formatContextWindowCompactionMessage(snapshot?.autoCompactThreshold)).toBe(
      "Compacts automatically at about 150,000 tokens.",
    );
  });
});

describe("latestProviderTurnTokenUsage", () => {
  it("picks the newest report, not the last turn in snapshot order", () => {
    const usage = (usedTokens: number, updatedAt: string) => ({
      tokenUsage: { usedTokens, updatedAt },
    });
    const latest = latestProviderTurnTokenUsage([
      usage(300_000, "2026-06-20T12:00:00.000Z"),
      {},
      usage(90_000, "2026-06-20T09:00:00.000Z"),
    ]);
    expect(latest?.usedTokens).toBe(300_000);
  });

  const sourceUsage = {
    usedTokens: 513_000,
    maxTokens: 1_000_000,
    promptCacheTtlMs: 5 * 60_000,
    updatedAt: "2026-10-19T12:00:00.000Z",
  };
  function forkProjection() {
    const projection = makeThreadProjectionFixture();
    const sourceThreadId = ThreadId.make("parent");
    const runId = RunId.make("fork-point");
    return {
      thread: {
        ...projection.thread,
        forkedFrom: { type: "run" as const, threadId: sourceThreadId, runId },
      },
      contextTransfers: [
        {
          id: ContextTransferId.make("fork-transfer"),
          type: "fork" as const,
          sourceThreadId,
          targetThreadId: projection.thread.id,
          sourcePoint: { threadId: sourceThreadId, runId },
          basePoint: null,
          sourceProviderInstanceId: projection.thread.modelSelection.instanceId,
          sourceTokenUsage: sourceUsage,
          targetProviderInstanceId: null,
          targetRunId: null,
          status: "pending" as const,
          resolution: null,
          createdBy: "user" as const,
          error: null,
          createdAt: projection.updatedAt,
          updatedAt: projection.updatedAt,
          consumedAt: null,
        },
      ],
    };
  }

  it("keeps fork-point context and its cache expiry before the fork reports usage", () => {
    const usage = latestProviderTurnTokenUsage([], forkProjection());
    expect(usage).toEqual(sourceUsage);
    const snapshot = deriveLatestContextWindowSnapshot([], usage);
    expect(snapshot?.usedTokens).toBe(513_000);
    expect(
      shouldOfferResumeCompaction({
        provider: "claudeAgent",
        usedTokens: snapshot?.usedTokens,
        updatedAt: snapshot?.updatedAt,
        promptCacheTtlMs: usage?.promptCacheTtlMs,
        now: "2026-10-19T12:06:00.000Z",
      }),
    ).toBe(true);
  });

  it("replaces inherited usage with the fork's own report", () => {
    const tokenUsage = { usedTokens: 42_000, updatedAt: "2026-10-19T12:10:00.000Z" };
    expect(latestProviderTurnTokenUsage([{ tokenUsage }], forkProjection())).toEqual(tokenUsage);
  });

  it.each([0, 42_000])(
    "prefers target provider-thread usage of %d tokens over inherited usage",
    (usedTokens) => {
      const providerThread = {
        contextUsage: {
          usedTokens,
          maxTokens: 200_000,
          cost: { amount: 0.42, currency: "USD" },
        },
        updatedAt: DateTime.makeUnsafe("2026-10-19T12:10:00.000Z"),
      };
      const usage = latestProviderTurnTokenUsage([], forkProjection(), providerThread);
      const snapshot = deriveLatestContextWindowSnapshot([], usage, providerThread);

      expect(snapshot).toMatchObject({
        usedTokens,
        maxTokens: 200_000,
        cost: { amount: 0.42, currency: "USD" },
        updatedAt: "2026-10-19T12:10:00.000Z",
      });
    },
  );

  it("keeps the fallback after a native fork is consumed", () => {
    const projection = forkProjection();
    const transfer = projection.contextTransfers[0]!;
    expect(
      latestProviderTurnTokenUsage([], {
        ...projection,
        contextTransfers: [
          {
            ...transfer,
            status: "consumed",
            resolution: {
              strategy: "native_fork",
              providerThreadRef: {
                driver: ProviderDriverKind.make("claudeAgent"),
                nativeId: "fork",
                strength: "strong",
              },
            },
          },
        ],
      }),
    ).toEqual(sourceUsage);
  });

  it("does not reuse usage for portable handoffs, different providers, or missing history", () => {
    const projection = forkProjection();
    const transfer = projection.contextTransfers[0]!;
    for (const contextTransfers of [
      [],
      [{ ...transfer, sourceTokenUsage: undefined }],
      [{ ...transfer, status: "resolved_portable" as const }],
      [{ ...transfer, sourceProviderInstanceId: ProviderInstanceId.make("other") }],
      [{ ...transfer, sourcePoint: { ...transfer.sourcePoint, runId: RunId.make("later") } }],
    ]) {
      expect(latestProviderTurnTokenUsage([], { ...projection, contextTransfers })).toBeNull();
    }
  });
});
