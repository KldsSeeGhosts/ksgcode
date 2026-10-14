/**
 * ZCode runs its ACP server through the shared ACP Registry machinery for
 * discovery, sign-in, and live commands, under its own driver kind so it can
 * add what the registry's spec-only path cannot: native compaction and the
 * context meter.
 *
 * @module provider-zcode/server/driver
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

import { ZcodeSettings } from "../settings.ts";

export const ZCODE_PROVIDER = ProviderDriverKind.make("zcode");

const ZCODE_PROFILE: AcpAgentProfile = {
  driverKind: ZCODE_PROVIDER,
  displayName: "ZCode",
  flavor: {
    supportsCompaction: true,
  },
  reportsContextWindow: true,
};

const decodeZcodeSettings = Schema.decodeSync(ZcodeSettings);

/** The ACP command line for an instance's settings. */
export const zcodeRegistrySettings = (settings: ZcodeSettings) =>
  localAcpAgentRegistrySettings({
    enabled: settings.enabled,
    binaryPath: settings.binaryPath,
    commandArgs: [],
    launchArgs: settings.launchArgs,
    customModels: settings.customModels,
  });

const definition: AcpAgentDriverDefinition<ZcodeSettings> = {
  profile: ZCODE_PROFILE,
  configSchema: ZcodeSettings,
  defaultConfig: () => decodeZcodeSettings({}),
  toRegistrySettings: zcodeRegistrySettings,
};

export const ZcodeDriver = makeAcpAgentDriver({
  ...definition,
  metadata: { displayName: "ZCode", supportsMultipleInstances: true },
});

export const ZcodeAdapterV2Driver = makeAcpAgentAdapterV2Driver(definition);
