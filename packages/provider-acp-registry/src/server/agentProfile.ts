/**
 * Dedicated ACP agent drivers reuse the ACP Registry's local-command machinery
 * (discovery, authentication, live commands and configuration) under their own
 * driver kind. A profile carries everything that differs from the registry
 * itself, so agent-specific behavior stays in the agent's own package.
 *
 * @module provider-acp-registry/server/agentProfile
 */
import type {
  CustomModelSetting,
  ProviderDriverKind,
  ServerProviderSlashCommand,
} from "@t3tools/contracts";
import type { AcpAdapterV2Flavor } from "@t3tools/provider-acp/server/adapter";
import { COMPACT_SLASH_COMMAND } from "@t3tools/provider-core/server/snapshotProbe";
import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";
import { readCustomModelEntries, toCustomModelSetting } from "@t3tools/shared/model";
import * as Schema from "effect/Schema";

import { AcpRegistrySettings } from "../settings.ts";

const decodeRegistrySettings = Schema.decodeSync(AcpRegistrySettings);

export interface AcpAgentProfile {
  readonly driverKind: ProviderDriverKind;
  /** Product name used in status messages, such as "ZCode". */
  readonly displayName: string;
  readonly flavor?: Partial<
    Pick<
      AcpAdapterV2Flavor,
      "capabilities" | "supportsCompaction" | "compactionPrompt" | "supportsImagePrompts"
    >
  >;
  /** The agent reports `usage_update` with a context size, so clients show the meter. */
  readonly reportsContextWindow?: boolean;
}

/** T3's Compact action needs a `compact` command; agents may name theirs differently. */
export function acpAgentSlashCommands(
  profile: AcpAgentProfile | undefined,
  commands: ReadonlyArray<ServerProviderSlashCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  if (profile?.flavor?.supportsCompaction !== true) return commands;
  return commands.some((command) => command.name === COMPACT_SLASH_COMMAND.name)
    ? commands
    : [COMPACT_SLASH_COMMAND, ...commands];
}

/** Runs an agent's own binary as a local registry command. */
export function localAcpAgentRegistrySettings(input: {
  readonly enabled: boolean;
  readonly binaryPath: string;
  /** Arguments the agent always needs, such as `acp`. */
  readonly commandArgs: ReadonlyArray<string>;
  readonly launchArgs: string;
  readonly customModels: ReadonlyArray<CustomModelSetting>;
}): AcpRegistrySettings {
  return decodeRegistrySettings({
    source: "local",
    enabled: input.enabled,
    commandPath: input.binaryPath,
    commandArgs: [...input.commandArgs, ...tokenizeCliArgs(input.launchArgs)],
    customModels: readCustomModelEntries(input.customModels).map(toCustomModelSetting),
  });
}
