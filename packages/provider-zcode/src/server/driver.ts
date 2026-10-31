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
import { mapZcodeElicitationForm } from "./elicitation.ts";
import { zcodeMaintenance } from "./maintenance.ts";
import { zcodeUsageReader } from "./usage.ts";

export const ZCODE_PROVIDER = ProviderDriverKind.make("zcode");

export const ZCODE_PROFILE = {
  driverKind: ZCODE_PROVIDER,
  displayName: "ZCode",
  managedModeOptionIds: ["mode"],
  flavor: {
    activeSteering: { interruptsTools: false },
    supportsCompaction: true,
    mapElicitationForm: mapZcodeElicitationForm,
    // The bridge defaults to yolo independently of T3. Select the native mode
    // before a prompt, including after loading a previously permissive session.
    sessionModeForPolicy: (policy) => {
      switch (policy.runtimeMode) {
        case "full-access":
          return "yolo";
        case "auto-accept-edits":
          return "edit";
        case "auto":
          return "auto";
        default:
          return "build";
      }
    },
  },
  reportsContextWindow: true,
} satisfies AcpAgentProfile;

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

export const ZcodeDriver = {
  ...makeAcpAgentDriver({
    ...definition,
    maintenance: zcodeMaintenance,
    metadata: { displayName: "ZCode", supportsMultipleInstances: true },
  }),
  usage: zcodeUsageReader,
};

export const ZcodeAdapterV2Driver = makeAcpAgentAdapterV2Driver(definition);
