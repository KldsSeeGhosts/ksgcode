import { ProviderDriverKind } from "@t3tools/contracts";
import { AcpProviderCapabilitiesV2 } from "@t3tools/provider-acp/server/adapter";
import {
  localAcpAgentRegistrySettings,
  makeAcpAgentDriver,
  type AcpAgentDriverDefinition,
  type AcpAgentProfile,
} from "@t3tools/provider-acp-registry/server";
import { makePackageManagedProviderMaintenanceResolver } from "@t3tools/provider-core/server/maintenanceResolver";
import type { ProviderDriverCreateInput } from "@t3tools/provider-core/server/driver";
import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { DeepSeekSettings } from "../settings.ts";
import { materializeDeepSeekCompactionBridge } from "./compactionBridge.ts";

const provider = ProviderDriverKind.make("deepseek");

export const DEEPSEEK_PROFILE = {
  driverKind: provider,
  displayName: "DeepSeek Harness",
  reportsContextWindow: true,
  // Its ACP agentInfo reports the bridge's fixed 0.0.1, not the installed dsh version.
  versionSource: "cli",
  flavor: {
    supportsCompaction: true,
    // Harness persists its sandbox separately from ACP approval requests.
    // Reapply the thread's policy before prompting new and resumed sessions.
    sessionModeForPolicy: (policy) => policy.runtimeMode,
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
    supportedRuntimeModes: ["approval-required", "auto-accept-edits", "auto", "full-access"],
    showInteractionModeToggle: false,
  },
} satisfies AcpAgentProfile;

const decodeSettings = Schema.decodeSync(DeepSeekSettings);

export const deepseekRegistrySettings = (settings: DeepSeekSettings, bridgePatch?: string) => {
  const registry = localAcpAgentRegistrySettings({
    enabled: settings.enabled,
    binaryPath: settings.binaryPath,
    commandArgs: ["--profile", "acp"],
    launchArgs: settings.launchArgs,
    customModels: settings.customModels,
  });
  return bridgePatch === undefined
    ? registry
    : { ...registry, commandArgs: [...registry.commandArgs, "--patch", bridgePatch] };
};

const definition: AcpAgentDriverDefinition<DeepSeekSettings> = {
  profile: DEEPSEEK_PROFILE,
  configSchema: DeepSeekSettings,
  defaultConfig: () => decodeSettings({}),
  toRegistrySettings: deepseekRegistrySettings,
};

const driverDefinition = {
  ...definition,
  maintenance: makePackageManagedProviderMaintenanceResolver({
    provider,
    npmPackageName: "@deepseek-ai/dsh",
    nativeUpdate: null,
  }),
  metadata: { displayName: "DeepSeek Harness", supportsMultipleInstances: true },
};
const baseDriver = makeAcpAgentDriver(driverDefinition);

export const DeepSeekDriver = {
  ...baseDriver,
  create: Effect.fn("DeepSeekDriver.create")(function* (
    input: ProviderDriverCreateInput<DeepSeekSettings>,
  ) {
    if (!input.enabled) return yield* baseDriver.create(input);
    const host = yield* ProviderHost.ProviderHost;
    const path = yield* Path.Path;
    const bridgePatch = yield* materializeDeepSeekCompactionBridge(
      path.join(host.paths.baseDir, "tools", "deepseek", "acp"),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: provider,
            instanceId: input.instanceId,
            detail: "Could not prepare the native compaction bridge.",
            cause,
          }),
      ),
    );
    return yield* makeAcpAgentDriver({
      ...driverDefinition,
      toRegistrySettings: (settings: DeepSeekSettings) =>
        deepseekRegistrySettings(settings, bridgePatch),
    }).create(input);
  }),
};
