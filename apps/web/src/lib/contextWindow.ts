import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2ProviderTurnTokenUsage,
  OrchestrationV2ProviderThread,
  OrchestrationV2TurnItem,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly updatedAt: string;
};

/** Newest usage report across a thread's provider turns. Snapshots order turns
    by provider thread, not time, so pick by timestamp. A report without a
    breakdown, such as Claude's mid-turn update, borrows the newest breakdown
    any turn carried, so the card does not flicker back to its short form. */
export function latestProviderTurnTokenUsage(
  turns: ReadonlyArray<Pick<OrchestrationV2ProviderTurn, "tokenUsage">>,
): OrchestrationV2ProviderTurnTokenUsage | null {
  let latest: OrchestrationV2ProviderTurnTokenUsage | null = null;
  let latestWithBreakdown: OrchestrationV2ProviderTurnTokenUsage | null = null;
  for (const { tokenUsage } of turns) {
    if (tokenUsage === undefined) continue;
    // Ties go to the later entry, since live upserts append.
    if (latest === null || Date.parse(tokenUsage.updatedAt) >= Date.parse(latest.updatedAt)) {
      latest = tokenUsage;
    }
    if (
      tokenUsage.breakdown !== undefined &&
      (latestWithBreakdown === null ||
        Date.parse(tokenUsage.updatedAt) >= Date.parse(latestWithBreakdown.updatedAt))
    ) {
      latestWithBreakdown = tokenUsage;
    }
  }
  if (latest !== null && latest.breakdown === undefined && latestWithBreakdown !== null) {
    return { ...latest, breakdown: latestWithBreakdown.breakdown };
  }
  return latest;
}

export function deriveLatestContextWindowSnapshot(
  entries: ReadonlyArray<{
    readonly item: OrchestrationV2TurnItem;
  }>,
  liveUsage?: OrchestrationV2ProviderTurnTokenUsage | null,
  providerThread?: Pick<OrchestrationV2ProviderThread, "contextUsage" | "updatedAt"> | null,
): ContextWindowSnapshot | null {
  if (liveUsage != null) {
    const usedTokens = Math.max(0, liveUsage.usedTokens);
    const maxTokens = liveUsage.maxTokens ?? null;
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;
    return {
      usedTokens,
      totalProcessedTokens: null,
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      breakdown: liveUsage.breakdown ?? null,
      inputTokens: liveUsage.inputTokens ?? null,
      cachedInputTokens: liveUsage.cachedInputTokens ?? null,
      outputTokens: liveUsage.outputTokens ?? null,
      reasoningOutputTokens: liveUsage.reasoningOutputTokens ?? null,
      lastUsedTokens: null,
      lastInputTokens: null,
      lastCachedInputTokens: null,
      lastOutputTokens: null,
      lastReasoningOutputTokens: null,
      toolUses: null,
      durationMs: null,
      compactsAutomatically: true,
      autoCompactThreshold: null,
      cost: null,
      updatedAt: liveUsage.updatedAt,
    };
  }
  const providerUsage = providerThread?.contextUsage;
  const providerUsageUpdatedAt = providerThread?.updatedAt;
  if (
    providerUsage !== null &&
    providerUsage !== undefined &&
    providerUsageUpdatedAt !== undefined
  ) {
    const maxTokens = asFiniteNumber(providerUsage.maxTokens);
    const usedTokens = providerUsage.usedTokens;
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    return {
      usedTokens,
      totalProcessedTokens: asFiniteNumber(providerUsage.totalProcessedTokens),
      maxTokens,
      remainingTokens: maxTokens === null ? null : Math.max(0, Math.round(maxTokens - usedTokens)),
      usedPercentage,
      remainingPercentage: usedPercentage === null ? null : Math.max(0, 100 - usedPercentage),
      breakdown: providerUsage.breakdown ?? null,
      inputTokens: asFiniteNumber(providerUsage.inputTokens),
      cachedInputTokens: asFiniteNumber(providerUsage.cachedInputTokens),
      outputTokens: asFiniteNumber(providerUsage.outputTokens),
      reasoningOutputTokens: asFiniteNumber(providerUsage.reasoningOutputTokens),
      lastUsedTokens: asFiniteNumber(providerUsage.lastUsedTokens),
      lastInputTokens: asFiniteNumber(providerUsage.lastInputTokens),
      lastCachedInputTokens: asFiniteNumber(providerUsage.lastCachedInputTokens),
      lastOutputTokens: asFiniteNumber(providerUsage.lastOutputTokens),
      lastReasoningOutputTokens: asFiniteNumber(providerUsage.lastReasoningOutputTokens),
      toolUses: asFiniteNumber(providerUsage.toolUses),
      durationMs: asFiniteNumber(providerUsage.durationMs),
      compactsAutomatically: providerUsage.compactsAutomatically ?? null,
      cost: providerUsage.cost ?? null,
      autoCompactThreshold: providerUsage.autoCompactThreshold ?? null,
      updatedAt: DateTime.formatIso(providerUsageUpdatedAt),
    };
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.item.type !== "compaction") {
      continue;
    }
    const payload = entry.item;
    const usedTokens = asFiniteNumber(payload.afterTokenCount);
    if (usedTokens === null || usedTokens < 0) {
      continue;
    }

    const maxTokens = null;
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

    return {
      usedTokens,
      totalProcessedTokens: asFiniteNumber(payload.beforeTokenCount),
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      breakdown: null,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
      lastUsedTokens: null,
      lastInputTokens: null,
      lastCachedInputTokens: null,
      lastOutputTokens: null,
      lastReasoningOutputTokens: null,
      toolUses: null,
      durationMs: null,
      compactsAutomatically: true,
      autoCompactThreshold: null,
      cost: null,
      updatedAt: DateTime.formatIso(payload.startedAt ?? payload.updatedAt),
    };
  }

  return null;
}

export type ContextLegendKind = "used" | "estimated" | "inferred" | "other" | "buffer" | "free";

export interface ContextLegendItem {
  readonly label: string;
  readonly tokens: number;
  readonly kind: ContextLegendKind;
}

// Rows past this many fold into "Other" so the card stays small.
const VISIBLE_BREAKDOWN_ROWS = 5;

/**
 * The card's segments, in bar order: the largest rows, the rest folded into
 * "Other", the compaction buffer, then free space. Null when the provider
 * gave no breakdown, so the card keeps its plain bar.
 */
export function buildContextLegend(
  usage: Pick<ContextWindowSnapshot, "breakdown" | "maxTokens">,
): ReadonlyArray<ContextLegendItem> | null {
  const rows = usage.breakdown ?? null;
  const maxTokens = usage.maxTokens ?? null;
  if (rows === null || rows.length === 0) return null;

  const content = [...rows]
    .filter((row) => row.kind !== "buffer" && row.tokens > 0)

    .sort((a, b) => b.tokens - a.tokens);
  const buffer = rows.reduce((sum, row) => sum + (row.kind === "buffer" ? row.tokens : 0), 0);
  if (content.length === 0) return null;

  // One slot goes to "Other", so a tail of one row is shown as itself.
  const shown =
    content.length > VISIBLE_BREAKDOWN_ROWS + 1
      ? content.slice(0, VISIBLE_BREAKDOWN_ROWS)
      : content;
  const folded = content.slice(shown.length);
  const items: Array<ContextLegendItem> = shown.map((row) => ({
    label: row.label,
    tokens: row.tokens,
    kind: row.kind === "buffer" ? "used" : row.kind,
  }));
  if (folded.length > 0) {
    items.push({
      label: "Other",
      tokens: folded.reduce((sum, row) => sum + row.tokens, 0),
      kind: "other",
    });
  }
  if (buffer > 0) items.push({ label: "Buffer", tokens: buffer, kind: "buffer" });
  if (maxTokens !== null && maxTokens > 0) {
    const accounted = items.reduce((sum, item) => sum + item.tokens, 0);
    if (maxTokens > accounted) {
      items.push({ label: "Free space", tokens: maxTokens - accounted, kind: "free" });
    }
  }
  return items;
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 999_500) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
