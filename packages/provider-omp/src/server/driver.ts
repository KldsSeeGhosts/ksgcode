/**
 * OMP runs its ACP server through the shared ACP Registry machinery for
 * discovery, sign-in, and live commands, under its own driver kind so it can
 * add what the registry's spec-only path cannot: native compaction and the
 * context meter.
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

import { OmpSettings } from "../settings.ts";

export const OMP_PROVIDER = ProviderDriverKind.make("omp");

const OMP_PROFILE: AcpAgentProfile = {
  driverKind: OMP_PROVIDER,
  displayName: "OMP",
  flavor: {
    supportsCompaction: true,
  },
  reportsContextWindow: true,
};

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
  metadata: { displayName: "OMP", supportsMultipleInstances: true },
});

export const OmpAdapterV2Driver = makeAcpAgentAdapterV2Driver(definition);
