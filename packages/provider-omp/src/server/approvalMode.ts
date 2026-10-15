import type { RuntimeMode } from "@t3tools/contracts";

/**
 * OMP reads its approval policy at process launch, not from ACP session modes.
 * Explicit flags prevent Supervised from inheriting a local yolo configuration.
 * Remove conflicting launch flags first: --auto-approve overrides even a later
 * --approval-mode in OMP. OMP has no Auto classifier, so a stale Auto selection
 * falls back to asking rather than gaining Full access.
 */
export function ompApprovalArgs(
  args: ReadonlyArray<string>,
  runtimeMode: RuntimeMode,
): ReadonlyArray<string> {
  const separator = args.indexOf("--");
  const options = separator === -1 ? args : args.slice(0, separator);
  const retained: string[] = [];
  for (let index = 0; index < options.length; index += 1) {
    const arg = options[index]!;
    if (arg === "--approval-mode") {
      const value = options[index + 1];
      if (value !== undefined && !value.startsWith("-")) index += 1;
    } else if (
      arg !== "--auto-approve" &&
      !arg.startsWith("--auto-approve=") &&
      arg !== "--yolo" &&
      !arg.startsWith("--yolo=") &&
      !arg.startsWith("--approval-mode=")
    ) {
      retained.push(arg);
    }
  }
  const mode =
    runtimeMode === "full-access"
      ? "yolo"
      : runtimeMode === "auto-accept-edits"
        ? "write"
        : "always-ask";
  return [
    ...retained,
    `--approval-mode=${mode}`,
    ...(separator === -1 ? [] : args.slice(separator)),
  ];
}
