import { useState } from "react";

import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";

import {
  buildContextLegend,
  type ContextLegendItem,
  type ContextLegendKind,
  formatContextWindowTokens,
} from "~/lib/contextWindow";

const SEGMENT_COLORS = [
  "var(--info)",
  "var(--success)",
  "var(--warning)",
  "var(--update)",
  "color-mix(in oklab, var(--info) 50%, var(--warning))",
] as const;
// Dotted marks the remainder T3 inferred, hatching the compaction reserve.
const INFERRED_FILL =
  "radial-gradient(circle, color-mix(in oklab, var(--muted-foreground) 75%, transparent) 0.9px, transparent 1.2px) 0 0 / 4px 4px, color-mix(in oklab, var(--muted-foreground) 16%, transparent)";
const BUFFER_FILL =
  "repeating-linear-gradient(135deg, color-mix(in oklab, var(--muted-foreground) 40%, transparent) 0 3px, transparent 3px 6px)";

function legendFill(kind: ContextLegendKind, colorIndex: number): string {
  switch (kind) {
    case "inferred":
      return INFERRED_FILL;
    case "buffer":
      return BUFFER_FILL;
    case "other":
      return "color-mix(in oklab, var(--muted-foreground) 50%, transparent)";
    case "free":
      return "color-mix(in oklab, var(--muted-foreground) 14%, transparent)";
    case "used":
    case "estimated":
      return SEGMENT_COLORS[colorIndex % SEGMENT_COLORS.length]!;
  }
}

/** The segmented bar and its two-column legend. Hovering a row isolates its segment. */
function ContextWindowBreakdownLegend(props: {
  legend: ReadonlyArray<ContextLegendItem>;
  approximate: boolean;
}) {
  const { legend, approximate } = props;
  const [hovered, setHovered] = useState<number | null>(null);
  // Palette colors go to content rows in order; the other kinds have fixed fills.
  const entries = legend.map((item, index) => ({
    item,
    index,
    fill: legendFill(
      item.kind,
      legend
        .slice(0, index)
        .filter((earlier) => earlier.kind === "used" || earlier.kind === "estimated").length,
    ),
  }));

  return (
    <>
      <div
        className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted/60"
        role="img"
        aria-label="Context window breakdown"
      >
        {entries.map(({ item, index, fill }) => (
          <div
            key={item.label}
            className="h-full min-w-0.5"
            style={{
              flexGrow: item.tokens,
              flexBasis: 0,
              background: fill,
              opacity: hovered === null || hovered === index ? 1 : 0.35,
            }}
          />
        ))}
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-0.5 p-0 text-2xs leading-4">
        {entries.map(({ item, index, fill }) => (
          <li
            key={item.label}
            className="flex min-w-0 items-center gap-1.5"
            onPointerEnter={() => setHovered(index)}
            onPointerLeave={() => setHovered(null)}
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-xs"
              style={{ background: fill }}
            />
            <span className="min-w-0 flex-1 truncate text-secondary-label">{item.label}</span>
            <span className="tabular-nums">
              {approximate && item.kind !== "free" && item.kind !== "buffer" ? "~" : ""}
              {formatContextWindowTokens(item.tokens)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** True when any row is an estimate, so the legend marks non-free values with "~". */
function contextWindowApproximate(
  usage: Pick<ContextWindowSnapshot, "breakdown">,
  legend: ReadonlyArray<ContextLegendItem>,
): boolean {
  return (
    usage.breakdown?.some((row) => row.kind === "estimated" || row.kind === "inferred") ??
    legend.some((item) => item.kind === "inferred")
  );
}

/** A segmented bar and legend of what fills the context window. */
export function ContextWindowBreakdown(props: {
  readonly usage: Pick<ContextWindowSnapshot, "breakdown" | "maxTokens" | "usedTokens">;
}) {
  const legend = buildContextLegend(props.usage);
  if (legend === null) return null;
  return (
    <ContextWindowBreakdownLegend
      legend={legend}
      approximate={contextWindowApproximate(props.usage, legend)}
    />
  );
}
