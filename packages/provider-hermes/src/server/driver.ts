/**
 * Hermes runs its ACP server through the shared ACP Registry machinery for
 * discovery, sign-in, and live commands, under its own driver kind so it can
 * add what the registry's spec-only path cannot: native compaction and the
 * context meter.
 *
 * @module provider-hermes/server/driver
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

import { HermesSettings } from "../settings.ts";
import { hermesMaintenance } from "./maintenance.ts";

export const HERMES_PROVIDER = ProviderDriverKind.make("hermes");

export const HERMES_PROFILE: AcpAgentProfile = {
  driverKind: HERMES_PROVIDER,
  displayName: "Hermes",
  flavor: {
    supportsCompaction: true,
    compactionPrompt: "/compress",
    // Hermes persists edit-approval mode in the native session. Reapply T3's
    // policy on both new and resumed sessions instead of inheriting that mode.
    sessionModeForPolicy: (policy) =>
      policy.runtimeMode === "full-access"
        ? "dont_ask"
        : policy.runtimeMode === "auto-accept-edits"
          ? "accept_edits"
          : "default",
  },
  reportsContextWindow: true,
};

const decodeHermesSettings = Schema.decodeSync(HermesSettings);

/** The ACP command line for an instance's settings. */
export const hermesRegistrySettings = (settings: HermesSettings) =>
  localAcpAgentRegistrySettings({
    enabled: settings.enabled,
    binaryPath: settings.binaryPath,
    commandArgs: ["acp"],
    launchArgs: settings.launchArgs,
    customModels: settings.customModels,
  });

const definition: AcpAgentDriverDefinition<HermesSettings> = {
  profile: HERMES_PROFILE,
  configSchema: HermesSettings,
  defaultConfig: () => decodeHermesSettings({}),
  toRegistrySettings: hermesRegistrySettings,
};

export const HermesDriver = makeAcpAgentDriver({
  ...definition,
  maintenance: hermesMaintenance,
  metadata: { displayName: "Hermes", supportsMultipleInstances: true },
});

export const HermesAdapterV2Driver = makeAcpAgentAdapterV2Driver(definition);
