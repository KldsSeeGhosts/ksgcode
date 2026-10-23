import { ProviderDriverKind } from "@t3tools/contracts";
import { AcpProviderCapabilitiesV2 } from "@t3tools/provider-acp/server/adapter";
import {
  localAcpAgentRegistrySettings,
  makeAcpAgentDriver,
  type AcpAgentDriverDefinition,
  type AcpAgentProfile,
} from "@t3tools/provider-acp-registry/server";
import { makePackageManagedProviderMaintenanceResolver } from "@t3tools/provider-core/server/maintenanceResolver";
import * as Schema from "effect/Schema";

import { DeepSeekSettings } from "../settings.ts";

const provider = ProviderDriverKind.make("deepseek");

export const DEEPSEEK_PROFILE = {
  driverKind: provider,
  displayName: "DeepSeek Harness",
  reportsContextWindow: true,
  // Its ACP agentInfo reports the bridge's fixed 0.0.1, not the installed dsh version.
  versionSource: "cli",
  flavor: {
    capabilities: {
      ...AcpProviderCapabilitiesV2,
      planning: {
        ...AcpProviderCapabilitiesV2.planning,
        emitsPlanUpdated: false,
        emitsTodoList: false,
        supportsStructuredQuestions: false,
      },
    },
  },
  presentation: {
    supportedRuntimeModes: ["approval-required"],
    showInteractionModeToggle: false,
  },
} satisfies AcpAgentProfile;

const decodeSettings = Schema.decodeSync(DeepSeekSettings);

export const deepseekRegistrySettings = (settings: DeepSeekSettings) =>
  localAcpAgentRegistrySettings({
    enabled: settings.enabled,
    binaryPath: settings.binaryPath,
    commandArgs: ["--profile", "acp"],
    launchArgs: settings.launchArgs,
    customModels: settings.customModels,
  });

const definition: AcpAgentDriverDefinition<DeepSeekSettings> = {
  profile: DEEPSEEK_PROFILE,
  configSchema: DeepSeekSettings,
  defaultConfig: () => decodeSettings({}),
  toRegistrySettings: deepseekRegistrySettings,
};

export const DeepSeekDriver = makeAcpAgentDriver({
  ...definition,
  maintenance: makePackageManagedProviderMaintenanceResolver({
    provider,
    npmPackageName: "@deepseek-ai/dsh",
    nativeUpdate: null,
  }),
  metadata: { displayName: "DeepSeek Harness", supportsMultipleInstances: true },
});
