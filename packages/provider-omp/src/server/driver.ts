/**
 * OMP runs its ACP server through the shared ACP Registry machinery for
 * discovery, sign-in, and live commands, under its own driver kind so it can
 * add what the registry's spec-only path cannot: native compaction, approval
 * flags, terminal-output normalization, and the context meter.
 *
 * @module provider-omp/server/driver
 */
import { ProviderDriverKind } from "@t3tools/contracts";
import {
  localAcpAgentRegistrySettings,
  makeAcpAgentAdapterV2Driver,
  makeAcpAgentDriver,
  type AcpAgentDriverDefinition,
  type AcpAgentProfile,
} from "@t3tools/provider-acp-registry/server";
import * as Schema from "effect/Schema";
import * as NodeUtil from "node:util";

import { OmpSettings } from "../settings.ts";
import { ompApprovalArgs } from "./approvalMode.ts";
import { mapOmpElicitationForm } from "./elicitation.ts";
import { ompMaintenance } from "./maintenance.ts";

export const OMP_PROVIDER = ProviderDriverKind.make("omp");

export const OMP_PROFILE = {
  driverKind: OMP_PROVIDER,
  displayName: "OMP",
  flavor: {
    activeSteering: { interruptsTools: true },
    supportsCompaction: true,
    mapElicitationForm: mapOmpElicitationForm,
    // Built-in commands such as /context emit a complete terminal-formatted
    // message. Keep terminal controls out of chat without changing tool output.
    normalizeSessionUpdate: (notification) => {
      const { update } = notification;
      if (
        (update.sessionUpdate !== "agent_message_chunk" &&
          update.sessionUpdate !== "agent_thought_chunk") ||
        update.content.type !== "text"
      ) {
        return notification;
      }
      const text = NodeUtil.stripVTControlCharacters(update.content.text);
      if (text === update.content.text) return notification;
      return {
        ...notification,
        update: {
          ...update,
          content: { ...update.content, text },
        },
      };
    },
  },
  prepareSpawn: (spawn, policy) => ({
    ...spawn,
    args: ompApprovalArgs(spawn.args ?? [], policy.runtimeMode),
  }),
  reportsContextWindow: true,
} satisfies AcpAgentProfile;

const decodeOmpSettings = Schema.decodeSync(OmpSettings);

/** The ACP command line for an instance's settings. */
export const ompRegistrySettings = (settings: OmpSettings) =>
  localAcpAgentRegistrySettings({
    enabled: settings.enabled,
    binaryPath: settings.binaryPath,
    commandArgs: ["acp"],
    launchArgs: settings.launchArgs,
    customModels: settings.customModels,
  });

const definition: AcpAgentDriverDefinition<OmpSettings> = {
  profile: OMP_PROFILE,
  configSchema: OmpSettings,
  defaultConfig: () => decodeOmpSettings({}),
  toRegistrySettings: ompRegistrySettings,
};

export const OmpDriver = makeAcpAgentDriver({
  ...definition,
  maintenance: ompMaintenance,
  metadata: { displayName: "OMP", supportsMultipleInstances: true },
});

export const OmpAdapterV2Driver = makeAcpAgentAdapterV2Driver(definition);
