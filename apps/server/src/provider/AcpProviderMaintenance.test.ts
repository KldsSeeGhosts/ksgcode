import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type {
  ProviderMaintenanceCapabilitiesResolver,
  ProviderMaintenanceResolutionContext,
} from "@t3tools/provider-core/server/maintenanceResolver";

import { ompMaintenance } from "../../../../packages/provider-omp/src/server/maintenance.ts";
import { hermesMaintenance } from "../../../../packages/provider-hermes/src/server/maintenance.ts";
import { zcodeMaintenance } from "../../../../packages/provider-zcode/src/server/maintenance.ts";

const context: ProviderMaintenanceResolutionContext = {
  binaryPath: "omp",
  resolvedCommandPath: "/tools/bin/omp",
  realCommandPath: "/tools/bin/omp",
  env: { PATH: "/other/bin", HOME: "/users/test", HERMES_HOME: "/profiles/work" },
  platform: "darwin",
};

function runResolver(
  resolver: ProviderMaintenanceCapabilitiesResolver,
  target: ProviderMaintenanceResolutionContext | null,
  output: (args: ReadonlyArray<string>) => { readonly stdout: string; readonly code?: number },
  managed = false,
) {
  const spawner = ChildProcessSpawner.make((command) => {
    const { args } = command as unknown as { readonly args: ReadonlyArray<string> };
    const result = output(args);
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.encodeText(Stream.make(result.stdout)),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  });
  return resolver.resolve(target).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        exists: () => Effect.succeed(managed),
      }),
    ),
    Effect.provideService(HostProcess.Platform, "darwin"),
  );
}

it.layer(NodeServices.layer)("dedicated ACP provider maintenance", (it) => {
  it.effect("uses OMP's native channel updater and pins PATH to the configured install", () =>
    Effect.gen(function* () {
      const calls: Array<ReadonlyArray<string>> = [];
      const result = yield* runResolver(ompMaintenance, context, (args) => {
        calls.push(args);
        return {
          stdout:
            "\u001b[36mCurrent version: 18.1.0-canary.1\nNew version available: 18.1.0-canary.2\u001b[0m\n",
        };
      });
      expect(result.update).toMatchObject({
        executable: "/tools/bin/omp",
        args: ["update"],
        env: { PATH: "/tools/bin:/other/bin" },
        timeoutMs: 20 * 60_000,
      });
      expect(result.packageName).toBeNull();
      expect(calls).toEqual([]);
      expect(yield* result.latestVersionLookup!.read).toBe("18.1.0-canary.2");
      expect(calls).toEqual([["update", "--check"]]);
    }),
  );

  it.effect("keeps Tern-owned OMP copies manual", () =>
    runResolver(
      ompMaintenance,
      context,
      () => {
        throw new Error("must not run OMP");
      },
      true,
    ).pipe(
      Effect.map((result) => {
        expect(result.update).toBeNull();
        expect(result.latestVersionLookup).toBeUndefined();
      }),
    ),
  );

  it.effect(
    "keeps OMP source, pinned, app-bundled, missing and foreign package installs manual",
    () =>
      Effect.gen(function* () {
        for (const realCommandPath of [
          "/work/omp/src/cli.ts",
          "/nix/store/hash-omp/bin/omp",
          "/users/test/.local/share/mise/installs/omp/18.1.0/bin/omp",
          "/Applications/Tern.app/Contents/Resources/omp",
          "/work/node_modules/@someone/other-agent/bin/omp",
        ]) {
          const result = yield* runResolver(ompMaintenance, { ...context, realCommandPath }, () => {
            throw new Error("must not run an unowned updater");
          });
          expect(result.update).toBeNull();
        }
        expect(
          (yield* runResolver(ompMaintenance, null, () => ({ stdout: "" }))).update,
        ).toBeNull();
      }),
  );

  it.effect("does not route an aliased OMP binary to the default PATH install", () =>
    runResolver(ompMaintenance, { ...context, resolvedCommandPath: "/tools/omp-copy" }, () => {
      throw new Error("must not run a different install");
    }).pipe(Effect.map((result) => expect(result.update).toBeNull())),
  );

  it.effect(
    "uses the OMP native updater for a proven npm install, including companion packages",
    () =>
      runResolver(
        ompMaintenance,
        {
          ...context,
          realCommandPath: "/tools/lib/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js",
        },
        () => ({ stdout: "" }),
      ).pipe(
        Effect.map((result) => {
          expect(result.update?.args).toEqual(["update"]);
          expect(result.update?.lockKey).toBe("npm-global:/tools");
        }),
      ),
  );

  it.effect("admits Hermes wrappers only after the native plan proves a source install", () =>
    Effect.gen(function* () {
      const calls: Array<ReadonlyArray<string>> = [];
      const result = yield* runResolver(
        hermesMaintenance,
        {
          ...context,
          resolvedCommandPath: "/tools/hermes-cpa",
        },
        (args) => {
          calls.push(args);
          return {
            stdout: args.includes("--plan")
              ? "Update plan:\n  Install: git (v0.24.1 @ abcdef12)\n  Profiles: default\n"
              : "→ Update channel: stable\n→ Selected release available: stable v0.25.0 (123456789abc)\n",
          };
        },
      );
      expect(result.update).toMatchObject({
        executable: "/tools/hermes-cpa",
        args: ["update", "--yes"],
        env: context.env,
        timeoutMs: 30 * 60_000,
      });
      expect(yield* result.latestVersionLookup!.read).toBe("0.25.0");
      expect(calls).toEqual([
        ["update", "--plan"],
        ["update", "--check"],
      ]);
    }),
  );

  it.effect("does not invent a Hermes release version from a source-branch commit count", () =>
    Effect.gen(function* () {
      const result = yield* runResolver(hermesMaintenance, context, (args) => ({
        stdout: args.includes("--plan")
          ? "Update plan:\n  Install: git (v0.24.1 @ abcdef12)\n"
          : "Update available: 12 commits behind origin/main.",
      }));
      expect(result.update).not.toBeNull();
      expect(yield* result.latestVersionLookup!.read).toBeNull();
    }),
  );

  it.effect("recognizes Hermes' current and forward-only release-channel answers", () =>
    Effect.gen(function* () {
      for (const checkOutput of [
        "✓ Up to date with the latest release (stable v0.24.1 (abcdef123456)).",
        "✓ No newer release: stable v0.24.0; this checkout is newer and waits for the next release.",
      ]) {
        const result = yield* runResolver(hermesMaintenance, context, (args) => ({
          stdout: args.includes("--plan")
            ? "Update plan:\n  Install: git (v0.24.1 @ abcdef12)\n"
            : checkOutput,
        }));
        expect(yield* result.latestVersionLookup!.read).toBe("0.24.1");
      }
    }),
  );

  it.effect("refuses Hermes bundled, package-managed, unrecognized and failed plan probes", () =>
    Effect.gen(function* () {
      for (const stdout of [
        "Update plan:\n  Install: bundled\n",
        "Update plan:\n  Install: docker\n",
        "Update plan:\n  Install: nix\n",
        "Update plan:\n  Install: apt\n",
        "Update plan:\n  Install: git\n  ⚠ This install is NOT updatable in place.\n",
        "usage: hermes update: unrecognized arguments: --plan",
        "",
      ]) {
        expect(
          (yield* runResolver(hermesMaintenance, context, () => ({ stdout }))).update,
        ).toBeNull();
      }
      expect(
        (yield* runResolver(hermesMaintenance, context, () => ({
          stdout: "Update plan:\n  Install: git\n",
          code: 1,
        }))).update,
      ).toBeNull();
    }),
  );

  it.effect("targets only ZCode's proven global ACP bridge, not its desktop app", () =>
    Effect.gen(function* () {
      const result = yield* runResolver(
        zcodeMaintenance,
        {
          ...context,
          resolvedCommandPath: "/opt/custom/bin/zcode-acp",
          realCommandPath: "/opt/custom/lib/node_modules/zcode-acp-server/dist/cli.js",
        },
        () => {
          throw new Error("ownership must not launch the bridge");
        },
      );
      expect(result.packageName).toBe("zcode-acp-server");
      expect(result.update?.args).toEqual([
        "install",
        "-g",
        "--prefix",
        "/opt/custom",
        "--allow-scripts=zcode-acp-server",
        "zcode-acp-server@latest",
      ]);
      expect(
        (yield* runResolver(
          zcodeMaintenance,
          {
            ...context,
            realCommandPath: "/Applications/ZCode.app/Contents/MacOS/zcode",
          },
          () => ({ stdout: "" }),
        )).update,
      ).toBeNull();
    }),
  );
});
