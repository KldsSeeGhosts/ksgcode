import { ProviderDriverKind } from "@t3tools/contracts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  makePackageManagedProviderMaintenanceResolver,
  makeProviderMaintenanceCapabilities,
  normalizeCommandPath,
  readProviderMaintenanceOutput,
  type ProviderMaintenanceCapabilitiesResolver,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeUtil from "node:util";

const provider = ProviderDriverKind.make("omp");
const packageName = "@oh-my-pi/pi-coding-agent";
const ownership = makePackageManagedProviderMaintenanceResolver({
  provider,
  npmPackageName: packageName,
  nativeUpdate: { args: ["update"] },
});

export const ompMaintenance: ProviderMaintenanceCapabilitiesResolver = {
  resolve: (context) =>
    Effect.gen(function* () {
      const manual = makeManualOnlyProviderMaintenanceCapabilities({ provider, packageName: null });
      if (!context) return manual;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const real = normalizeCommandPath(context.realCommandPath);
      // App-managed binaries, source launchers, Nix and pinned mise installs
      // stay with their owners. OMP uses this same manager.json location.
      const manifest = path.join(
        path.dirname(path.dirname(context.realCommandPath)),
        "manager.json",
      );
      const unmanaged = yield* fs.exists(manifest).pipe(
        Effect.map((exists) => !exists),
        Effect.orElseSucceed(() => false),
      );
      if (
        !unmanaged ||
        real.includes("/nix/store/") ||
        real.includes("/mise/") ||
        real.includes(".app/") ||
        (!real.includes("/node_modules/") && /\.[cm]?[jt]sx?$/.test(real))
      ) {
        return manual;
      }
      // omp's updater resolves `omp` on PATH. Do not let an absolute custom
      // binary update a different installation that happens to be on PATH.
      if (path.basename(context.resolvedCommandPath).replace(/\.(?:exe|cmd)$/i, "") !== "omp") {
        return manual;
      }
      const capabilities = yield* ownership.resolve(context);
      if (!capabilities.update) return manual;
      const env = {
        ...context.env,
        PATH: [
          path.dirname(context.resolvedCommandPath),
          context.env.PATH ?? context.env.Path ?? "",
        ].join(context.platform === "win32" ? ";" : ":"),
      };
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const native = makeProviderMaintenanceCapabilities({
        provider,
        packageName: null,
        updateExecutable: context.resolvedCommandPath,
        updateArgs: ["update"],
        updateLockKey: capabilities.update.lockKey,
        env,
        platform: context.platform,
      });
      return {
        ...native,
        update: native.update && { ...native.update, timeoutMs: 20 * 60_000 },
        latestVersionLookup: {
          cacheKey: `omp-native:${context.realCommandPath}:${context.env.HOME ?? ""}:${context.env.PI_CODING_AGENT_DIR ?? ""}`,
          read: readProviderMaintenanceOutput({
            executable: context.resolvedCommandPath,
            args: ["update", "--check"],
            env,
          }).pipe(
            Effect.map((output) => {
              if (!output) return null;
              const text = NodeUtil.stripVTControlCharacters(output);
              const offered = /^New version available:\s*(\d+\.\d+\.\d+(?:-[\w.-]+)?)\s*$/m.exec(
                text,
              );
              if (offered) return offered[1]!;
              return /Already up to date/.test(text)
                ? (/^Current version:\s*(\d+\.\d+\.\d+(?:-[\w.-]+)?)\s*$/m.exec(text)?.[1] ?? null)
                : null;
            }),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          ),
        },
      };
    }),
};
