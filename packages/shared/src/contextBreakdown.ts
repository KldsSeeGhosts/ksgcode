/**
 * Context window breakdown for providers that report only a total.
 *
 * Providers such as Codex and the ACP agents tell us how many tokens the
 * context holds, not what it holds. The server sizes the thread's own items
 * (messages, tool calls and output, reasoning, edits) and lets the reported
 * total decide how much is left over for the system prompt and tool schemas.
 * Sizes are character counts, so the split is an estimate, and rows built here
 * are marked `estimated` or `inferred`.
 */
import type { ContextBreakdownRow, OrchestrationV2TurnItem } from "@t3tools/contracts";

// Code and tool output tokenize denser than prose. One ratio keeps the
// estimate simple; the reported total absorbs the remaining error.
const CHARS_PER_TOKEN = 3.5;

export type ContextCategory =
  | "messages"
  | "toolCalls"
  | "toolOutput"
  | "reasoning"
  | "edits"
  | "search"
  | "subagents";

const CATEGORY_LABELS: Record<ContextCategory, string> = {
  messages: "Messages",
  toolCalls: "Tool calls",
  toolOutput: "Tool output",
  reasoning: "Reasoning",
  edits: "Edits",
  search: "Search",
  subagents: "Subagents",
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as ReadonlyArray<ContextCategory>;

export const CONTEXT_SYSTEM_LABEL = "System";

export type ContextCharTotals = Record<ContextCategory, number>;

export type ContextItemContribution = {
  /** A compaction replaces everything before it with its summary. */
  readonly reset: boolean;
  readonly chars: Partial<Record<ContextCategory, number>>;
};

function emptyTotals(): ContextCharTotals {
  return {
    messages: 0,
    toolCalls: 0,
    toolOutput: 0,
    reasoning: 0,
    edits: 0,
    search: 0,
    subagents: 0,
  };
}

function valueChars(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** What one turn item adds to the model's context, or null when it adds nothing. */
export function contextItemContribution(
  item: OrchestrationV2TurnItem,
): ContextItemContribution | null {
  switch (item.type) {
    case "user_message":
    case "assistant_message":
      return { reset: false, chars: { messages: item.text.length } };
    case "proposed_plan":
      return { reset: false, chars: { messages: item.markdown.length } };
    case "reasoning":
      return { reset: false, chars: { reasoning: item.text.length } };
    case "command_execution":
      return {
        reset: false,
        chars: { toolCalls: item.input.length, toolOutput: item.output?.length ?? 0 },
      };
    case "dynamic_tool":
      return {
        reset: false,
        chars: { toolCalls: valueChars(item.input), toolOutput: valueChars(item.output) },
      };
    case "file_change":
      return {
        reset: false,
        chars: {
          edits:
            item.fileName.length +
            (item.diffStr === undefined
              ? (item.oldStr?.length ?? 0) + (item.newStr?.length ?? 0)
              : item.diffStr.length),
        },
      };
    case "file_search":
      return {
        reset: false,
        chars: { search: (item.pattern?.length ?? 0) + valueChars(item.results) },
      };
    case "web_search":
      return {
        reset: false,
        chars: { search: valueChars(item.patterns) + valueChars(item.results) },
      };
    case "subagent":
      return {
        reset: false,
        chars: { subagents: item.prompt.length + (item.result?.length ?? 0) },
      };
    case "compaction":
      return { reset: true, chars: { messages: item.summary?.length ?? 0 } };
    default:
      return null;
  }
}

export interface ContextSizeTracker {
  /** Applies a new or updated item. Streaming items replace their earlier size. */
  readonly apply: (item: OrchestrationV2TurnItem) => void;
  readonly totals: () => Readonly<ContextCharTotals>;
}

/**
 * Running character totals for one provider thread, kept per item so an item
 * that streams in again replaces its earlier size instead of adding to it.
 */
export function makeContextSizeTracker(): ContextSizeTracker {
  const totals = emptyTotals();
  const sizes = new Map<string, Partial<Record<ContextCategory, number>>>();

  const remove = (id: string) => {
    const previous = sizes.get(id);
    if (previous === undefined) return;
    for (const category of CATEGORIES) totals[category] -= previous[category] ?? 0;
    sizes.delete(id);
  };

  return {
    apply: (item) => {
      const contribution = contextItemContribution(item);
      if (contribution === null) return;
      if (contribution.reset) {
        sizes.clear();
        Object.assign(totals, emptyTotals());
      } else {
        remove(item.id);
      }
      sizes.set(item.id, contribution.chars);
      for (const category of CATEGORIES) totals[category] += contribution.chars[category] ?? 0;
    },
    totals: () => totals,
  };
}

/**
 * Rows for a thread's reported `usedTokens`, largest first. When the sized
 * items already exceed the reported total, they are scaled down to fit it and
 * there is no remainder row. Undefined when nothing was sized.
 */
export function estimateContextBreakdown(
  totals: Readonly<ContextCharTotals>,
  usedTokens: number,
): ReadonlyArray<ContextBreakdownRow> | undefined {
  if (!Number.isFinite(usedTokens) || usedTokens <= 0) return undefined;
  const sized = CATEGORIES.map((category) => ({
    category,
    tokens: totals[category] / CHARS_PER_TOKEN,
  })).filter((entry) => entry.tokens >= 1);
  const sizedTotal = sized.reduce((sum, entry) => sum + entry.tokens, 0);
  if (sizedTotal === 0) return undefined;

  const scale = sizedTotal > usedTokens ? usedTokens / sizedTotal : 1;
  const rows: Array<ContextBreakdownRow> = sized
    .map((entry) => ({
      label: CATEGORY_LABELS[entry.category],
      tokens: Math.round(entry.tokens * scale),
      kind: "estimated" as const,
    }))
    .filter((row) => row.tokens > 0);
  const remainder = Math.round(usedTokens - rows.reduce((sum, row) => sum + row.tokens, 0));
  if (remainder > 0) {
    rows.push({ label: CONTEXT_SYSTEM_LABEL, tokens: remainder, kind: "inferred" });
  }
  return [...rows].sort((a, b) => b.tokens - a.tokens);
}
