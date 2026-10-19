import {
  collectCpaAccountGroups,
  formatResetsIn,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";

function Group({
  group,
  now,
}: {
  readonly group: ReturnType<typeof collectCpaAccountGroups>[number];
  readonly now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3 rounded-xl border border-border-subtle p-4">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="min-h-11 justify-center gap-1"
        onPress={() => setExpanded(!expanded)}
      >
        <Text className="text-base font-t3-medium text-foreground">{group.label}</Text>
        <Text className="text-xs text-foreground-muted">
          {group.source.accounts.length} CPA accounts ·{" "}
          {expanded ? "Hide accounts" : "Show accounts"}
        </Text>
      </Pressable>
      {expanded
        ? group.source.accounts.map((account) => (
            <View key={account.id} className="gap-2 border-t border-border-subtle pt-3">
              <Text selectable className="text-sm font-t3-medium text-foreground">
                {account.label ?? account.email ?? account.id}
              </Text>
              {account.fileName && account.fileName !== account.label ? (
                <Text selectable className="text-xs text-foreground-muted">
                  {account.fileName}
                </Text>
              ) : null}
              <Text className="text-xs text-foreground-muted">
                {account.providerLabel ?? account.driver}
                {account.plan ? ` · ${account.plan}` : ""}
                {account.disabled ? " · Disabled" : ""}
                {account.synthetic ? " · Dashboard account" : ""}
              </Text>
              {account.usageLimits.windows.map((window) => (
                <Text key={window.id} className="text-xs tabular-nums text-foreground">
                  {window.label}
                  {window.estimated ? " (estimated)" : ""}: {remainingPercent(window)}% left
                  {window.resetsAt ? ` · ${formatResetsIn(window, now)}` : ""}
                </Text>
              ))}
              {account.usageLimits.unavailable ? (
                <Text className="text-xs text-foreground-muted">
                  {account.usageLimits.unavailable.message ?? "Quota unavailable."}
                </Text>
              ) : null}
              {account.notice ? (
                <Text className="text-xs text-foreground-muted">{account.notice}</Text>
              ) : null}
            </View>
          ))
        : null}
    </View>
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
