import type { UsageLimitSourceAccount } from "@t3tools/contracts";
import {
  collectCpaAccountGroups,
  formatResetsIn,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { useState } from "react";

import { Button } from "../ui/button";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";

function Account({
  account,
  now,
}: {
  readonly account: UsageLimitSourceAccount;
  readonly now: number;
}) {
  return (
    <li className="space-y-2 border-t py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="break-all text-sm font-medium">
            <RedactedSensitiveText
              value={account.label ?? account.email ?? account.id}
              ariaLabel="Reveal CPA account"
              revealTooltip="Show account"
              hideTooltip="Hide account"
            />
          </p>
          {account.fileName && account.fileName !== account.label ? (
            <p className="break-all text-xs text-muted-foreground">
              <RedactedSensitiveText
                value={account.fileName}
                ariaLabel="Reveal auth filename"
                revealTooltip="Show auth filename"
                hideTooltip="Hide auth filename"
              />
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {account.providerLabel ?? account.driver}
          {account.plan ? ` · ${account.plan}` : ""}
          {account.disabled ? " · Disabled" : ""}
          {account.synthetic ? " · Dashboard account" : ""}
        </p>
      </div>
      {account.usageLimits.windows.map((window) => (
        <p key={window.id} className="flex flex-wrap justify-between gap-2 text-xs tabular-nums">
          <span>
            {window.label}
            {window.estimated ? " (estimated)" : ""}
          </span>
          <span>
            {remainingPercent(window)}% left
            {window.resetsAt ? ` · ${formatResetsIn(window, now)}` : ""}
          </span>
        </p>
      ))}
      {account.usageLimits.unavailable ? (
        <p className="text-xs text-muted-foreground">
          {account.usageLimits.unavailable.message ?? "Quota unavailable."}
        </p>
      ) : null}
      {account.notice ? <p className="text-xs text-muted-foreground">{account.notice}</p> : null}
    </li>
  );
}

function Group({
  group,
  now,
}: {
  readonly group: ReturnType<typeof collectCpaAccountGroups>[number];
  readonly now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = group.source.accounts.length;
  return (
    <section className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">{group.label}</h2>
          <p className="text-xs text-muted-foreground">
            {count} CPA accounts · Includes disabled and unavailable auth files
          </p>
        </div>
        <Button
          variant="outline"
          size="xs"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide accounts" : "Show accounts"}
        </Button>
      </div>
      {expanded ? (
        <ul className="mt-3">
          {group.source.accounts.map((account) => (
            <Account key={account.id} account={account} now={now} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function CpaAccounts({
  groups,
  now,
}: {
  readonly groups: ReturnType<typeof collectCpaAccountGroups>;
  readonly now: number;
}) {
  return groups.map((group) => <Group key={group.key} group={group} now={now} />);
}
