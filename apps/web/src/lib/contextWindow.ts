import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";

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
  usage: Pick<ContextWindowSnapshot, "breakdown" | "maxTokens" | "usedTokens">,
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
  // A breakdown taken earlier in the turn trails the reported total; show the gap
  // so the rows add up. Gaps under 1% are estimate noise.
  const unaccounted = usage.usedTokens - content.reduce((sum, row) => sum + row.tokens, 0);
  if (unaccounted > usage.usedTokens * 0.01) {
    items.push({ label: "Uncategorized", tokens: unaccounted, kind: "inferred" });
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
