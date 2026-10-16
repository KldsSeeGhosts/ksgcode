import { useState } from "react";
import { Button } from "../ui/button";
import {
  buildContextLegend,
  type ContextLegendItem,
  type ContextLegendKind,
  type ContextWindowSnapshot,
  formatContextWindowTokens,
} from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  formatContextWindowCompactionMessage,
  formatContextWindowCost,
} from "./ContextWindowMeter.logic";
import { Minimize2Icon } from "lucide-react";
import { composerFloatingLayerProps } from "./composerEventScope";

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
function ContextWindowBreakdown(props: {
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

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  modelDisplayName?: string | null;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
}) {
  const { usage, modelDisplayName, onCompact, compactDisabled, compactDisabledReason } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedPercentage / 100);
  const totalProcessedTokens = usage.totalProcessedTokens ?? null;
  const showTotalProcessed = totalProcessedTokens !== null && totalProcessedTokens > 0;
  const legend = buildContextLegend(usage);
  const approximate =
    usage.breakdown?.some((row) => row.kind === "estimated" || row.kind === "inferred") ?? false;
  const isOverloaded = normalizedPercentage > 90;
  const usageColor = isOverloaded
    ? "var(--color-error)"
    : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={onCompact ? 150 : 0}
        render={
          <Button
            size="icon-sm"
            variant="ghost-muted"
            className="size-7"
            aria-label={
              usage.maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }
          >
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full transform-gpu mx-0!"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  className="stroke-muted-foreground/24"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke={usageColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
            </span>
          </Button>
        }
      />
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        align="end"
        padding="none"
        width={legend ? "md" : "sm"}
        className="text-left whitespace-normal"
      >
        {legend ? (
          <div className="flex flex-col gap-2 p-(--floating-content-inset)">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-muted-foreground text-xs">Context Window</div>
              {usage.maxTokens !== null && usedPercentage ? (
                <div className="text-secondary-label text-2xs tabular-nums">
                  <span>{usedPercentage}</span>
                  <span className="mx-1">·</span>
                  <span>
                    {formatContextWindowTokens(usage.usedTokens)}/
                    {formatContextWindowTokens(usage.maxTokens ?? null)}
                  </span>
                </div>
              ) : (
                <div className="text-secondary-label text-2xs tabular-nums">
                  {formatContextWindowTokens(usage.usedTokens)}
                </div>
              )}
            </div>
            <ContextWindowBreakdown legend={legend} approximate={approximate} />
            {usage.cost != null || onCompact ? (
              <div className="flex items-center justify-between gap-2 border-border/60 border-t pt-2 text-2xs leading-4">
                <span className="text-secondary-label tabular-nums">
                  {usage.cost != null ? formatContextWindowCost(usage.cost) : null}
                </span>
                {onCompact ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={compactDisabled}
                    onClick={onCompact}
                  >
                    <Minimize2Icon aria-hidden="true" />
                    Compact
                  </Button>
                ) : null}
              </div>
            ) : null}
            {onCompact && compactDisabled && compactDisabledReason ? (
              <div className="text-pretty text-secondary-label text-2xs">
                {compactDisabledReason}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-(--floating-content-inset)">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-muted-foreground text-xs">Context Window</div>
              {usage.maxTokens !== null && usedPercentage ? (
                <div className="text-secondary-label text-2xs tabular-nums">
                  <span>{usedPercentage}</span>
                  <span className="mx-1">·</span>
                  <span>
                    {formatContextWindowTokens(usage.usedTokens)}/
                    {formatContextWindowTokens(usage.maxTokens ?? null)}
                  </span>
                </div>
              ) : (
                <div className="text-secondary-label text-2xs tabular-nums">
                  {formatContextWindowTokens(usage.usedTokens)}
                </div>
              )}
            </div>
            {usage.maxTokens !== null ? (
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(normalizedPercentage)}
                aria-label="Context window usage"
              >
                <div
                  className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: `${normalizedPercentage}%`, backgroundColor: usageColor }}
                />
              </div>
            ) : null}
            {showTotalProcessed ? (
              <div className="flex items-center justify-between gap-3 text-2xs leading-4">
                <span className="text-secondary-label">Total processed</span>
                <span className="font-medium tabular-nums text-secondary-label">
                  {formatContextWindowTokens(totalProcessedTokens)}
                </span>
              </div>
            ) : null}
            {usage.cost != null ? (
              <div className="flex items-center justify-between gap-3 text-2xs leading-4">
                <span className="text-secondary-label">Cost</span>
                <span className="font-medium tabular-nums text-secondary-label">
                  {formatContextWindowCost(usage.cost)}
                </span>
              </div>
            ) : null}
            {usage.compactsAutomatically ? (
              <div className="mt-1 text-pretty text-secondary-label text-2xs font-medium">
                {formatContextWindowCompactionMessage(modelDisplayName, usage.autoCompactThreshold)}
              </div>
            ) : null}
            {onCompact ? (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  className="mt-1 w-full justify-center"
                  disabled={compactDisabled}
                  onClick={onCompact}
                >
                  <Minimize2Icon aria-hidden="true" />
                  Compact context
                </Button>
                {compactDisabled && compactDisabledReason ? (
                  <div className="text-pretty text-secondary-label text-2xs">
                    {compactDisabledReason}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

/** Holds the meter's footprint while a thread's activities are still loading. */
export function ContextWindowMeterPlaceholder() {
  return <span aria-hidden="true" className="size-7 shrink-0" />;
}
