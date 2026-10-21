import { ProviderDriverKind } from "@t3tools/contracts";
import {
  makePackageManagedProviderMaintenanceResolver,
  makeProviderMaintenanceCapabilities,
  normalizeCommandPath,
  readProviderMaintenanceOutput,
  type ProviderMaintenanceCapabilitiesResolver,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

const provider = ProviderDriverKind.make("zcode");
const packageManaged = makePackageManagedProviderMaintenanceResolver({
  provider,
  npmPackageName: "zcode-acp-server",
  nativeUpdate: null,
});

const ManagedInstall = Schema.fromJsonString(
  Schema.Struct({
    schema: Schema.Literal(1),
    repository: Schema.Literal("KldsSeeGhosts/zcode-acp"),
    installedVersion: Schema.String,
  }),
);
const decodeManagedInstall = Schema.decodeEffect(ManagedInstall);
const RELEASE_VERSION = /^\d+\.\d+\.\d+-ksg\.\d{8}\.\d+$/;

// This owns the bridge only. Its KSG channel must never fall back to public npm.
export const zcodeMaintenance: ProviderMaintenanceCapabilitiesResolver = {
  resolve: Effect.fn("ZcodeMaintenance.resolve")(function* (context) {
    if (!context) return yield* packageManaged.resolve(context);
    const commandArgs = context.commandArgs ?? [];
    const launcher = normalizeCommandPath(commandArgs[0] ?? context.realCommandPath);
    if (
      !launcher.endsWith("/ksg-providers/zcode-acp/managed/launch.mjs") &&
      !launcher.endsWith("/ksg-providers/zcode-acp/managed/zcode-acp")
    ) {
      if (launcher.includes("/ksg-providers/zcode-acp/")) {
        return { provider, packageName: null, update: null };
      }
      return yield* packageManaged.resolve(context);
    }
    const manual = { provider, packageName: null, update: null };
    const output = yield* readProviderMaintenanceOutput({
      executable: context.resolvedCommandPath,
      args: [...commandArgs, "--ksg-maintenance"],
      env: context.env,
    });
    const install = yield* decodeManagedInstall(output ?? "").pipe(
      Effect.orElseSucceed(() => null),
    );
    if (!install || !RELEASE_VERSION.test(install.installedVersion)) return manual;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const capabilities = makeProviderMaintenanceCapabilities({
      provider,
      packageName: null,
      updateExecutable: context.resolvedCommandPath,
      updateArgs: [...commandArgs, "--ksg-update"],
      updateLockKey: `zcode-ksg:${launcher}`,
      platform: context.platform,
      env: context.env,
    });
    return {
      ...capabilities,
      installedVersion: install.installedVersion,
      update: capabilities.update && { ...capabilities.update, timeoutMs: 10 * 60_000 },
      latestVersionLookup: {
        cacheKey: `zcode-ksg:${launcher}`,
        read: readProviderMaintenanceOutput({
          executable: context.resolvedCommandPath,
          args: [...commandArgs, "--ksg-update-check"],
          env: context.env,
          timeoutMs: 15_000,
        }).pipe(
          Effect.map((latest) => {
            const version = latest?.trim();
            return version && RELEASE_VERSION.test(version) ? version : null;
          }),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
      },
    };
  }),
};
