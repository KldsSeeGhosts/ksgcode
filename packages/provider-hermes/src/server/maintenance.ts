import { ProviderDriverKind } from "@t3tools/contracts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  makeProviderMaintenanceCapabilities,
  readProviderMaintenanceOutput,
  type ProviderMaintenanceCapabilitiesResolver,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as Effect from "effect/Effect";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeUtil from "node:util";

const provider = ProviderDriverKind.make("hermes");

export const hermesMaintenance: ProviderMaintenanceCapabilitiesResolver = {
  resolve: (context) =>
    Effect.gen(function* () {
      const manual = makeManualOnlyProviderMaintenanceCapabilities({ provider, packageName: null });
      if (!context) return manual;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      // Ask the configured launcher, including wrappers, about its own install.
      // A desktop, Docker, Nix or APT copy must never become a git updater.
      const output = yield* readProviderMaintenanceOutput({
        executable: context.resolvedCommandPath,
        args: ["update", "--plan"],
        env: context.env,
      });
      const plan = NodeUtil.stripVTControlCharacters(output ?? "");
      if (!/^\s*Install: git(?:\s|\()/m.test(plan) || /NOT updatable in place/i.test(plan)) {
        return manual;
      }
      const currentVersion = /^\s*Install: git \(v(\d+\.\d+\.\d+)/m.exec(plan)?.[1] ?? null;
      const native = makeProviderMaintenanceCapabilities({
        provider,
        packageName: null,
        updateExecutable: context.resolvedCommandPath,
        updateArgs: ["update", "--yes"],
        updateLockKey: "hermes-native",
        env: context.env,
        platform: context.platform,
      });
      return {
        ...native,
        update: native.update && { ...native.update, timeoutMs: 30 * 60_000 },
        latestVersionLookup: {
          cacheKey: `hermes-native:${context.realCommandPath}:${context.env.HERMES_HOME ?? context.env.HOME ?? ""}`,
          read: readProviderMaintenanceOutput({
            executable: context.resolvedCommandPath,
            args: ["update", "--check"],
            env: context.env,
          }).pipe(
            Effect.map((checkOutput) => {
              const text = NodeUtil.stripVTControlCharacters(checkOutput ?? "");
              // Source-branch checks report commit counts, not a comparable
              // release version. Leave those unknown rather than using PyPI.
              const release =
                /(?:Selected release available:|latest release \()\s*(?:[\w.-]+\s+)?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)/i.exec(
                  text,
                )?.[1];
              if (release) return release;
              return /(?:Already up to date|No newer release|Up to date with)/i.test(text)
                ? currentVersion
                : null;
            }),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          ),
        },
      };
    }),
};
