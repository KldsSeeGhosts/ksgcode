import {
  AcpRegistryOperationError,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { AcpRegistrySettings } from "../settings.ts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ACP_SESSION_MODE_OPTION_ID } from "@t3tools/provider-acp/server/sessionConfig";

import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";
import {
  acpRegistrySnapshotReadiness,
  applyAcpRegistryAvailableCommands,
  applyAcpRegistryLiveConfiguration,
  buildCheckedAcpRegistrySnapshot,
  checkAcpRegistryProviderReadiness,
  checkAcpRegistryProviderStatus,
  checkAcpAgentCliVersion,
} from "./driver.ts";

const decodeSettings = Schema.decodeSync(AcpRegistrySettings);
const identity = {
  instanceId: ProviderInstanceId.make("acpRegistry_test"),
  displayName: "Test ACP",
  accentColor: undefined,
  continuationKey: "acpRegistry:instance:acpRegistry_test",
};
const noSessionManagement = {
  canList: false,
  canLoad: false,
  canResume: false,
  canLogout: false,
  canDelete: false,
  canConfigureProviders: false,
} as const;

it.effect(
  "reads the provider banner without mistaking Hermes's Python or SDK versions for it",
  () =>
    Effect.gen(function* () {
      const snapshot = buildCheckedAcpRegistrySnapshot({
        ...identity,
        settings: decodeSettings({ source: "local", commandPath: "hermes" }),
        checkedAt: "2026-10-15T00:00:00.000Z",
        inspection: { status: "ready", agentId: "", version: null, distribution: "local" },
      });
      for (const [stdout, expected] of [
        ["Hermes Agent v0.24.1+3.abcdef\nPython: 3.14.2\nOpenAI SDK: 2.0.0", "0.24.1+3.abcdef"],
        ["Hermes Agent unknown\nPython: 3.14.2", null],
        ["\u001b[36momp/18.1.0-canary.2\u001b[0m\n", "18.1.0-canary.2"],
        ["0.65.1\n", "0.65.1"],
      ] as const) {
        const result = yield* checkAcpAgentCliVersion({
          snapshot,
          commandPath: "/tools/provider",
          environment: {},
        }).pipe(
          Effect.provideService(HostProcess.Platform, "darwin"),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.make(() =>
              Effect.succeed(
                ChildProcessSpawner.makeHandle({
                  pid: ChildProcessSpawner.ProcessId(1),
                  exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
                  isRunning: Effect.succeed(false),
                  kill: () => Effect.void,
                  unref: Effect.succeed(Effect.void),
                  stdin: Sink.drain,
                  stdout: Stream.encodeText(Stream.make(stdout)),
                  stderr: Stream.empty,
                  all: Stream.empty,
                  getInputFd: () => Sink.drain,
                  getOutputFd: () => Stream.empty,
                }),
              ),
            ),
          ),
        );
        expect(result.version).toBe(expected);
      }
    }),
);

function catalogWithInspection(
  inspection: AcpRegistrySupport.AcpRegistryInspection,
): AcpRegistrySupport.AcpRegistryCatalog["Service"] {
  return {
    search: () => Effect.die("unused search"),
    prepare: () => Effect.die("unused prepare"),
    inspect: () => Effect.succeed(inspection),
    resolve: () => Effect.die("unused resolve"),
    uninstallManagedBinary: () => Effect.die("unused uninstall"),
  };
}

describe("dedicated ACP agent profiles", () => {
  const profile = {
    driverKind: ProviderDriverKind.make("hermes"),
    displayName: "Hermes",
    flavor: { supportsCompaction: true, compactionPrompt: "/compress" },
    reportsContextWindow: true,
  };

  it("present under their own driver with the context meter and T3's compact command", () => {
    const provider = buildCheckedAcpRegistrySnapshot({
      ...identity,
      profile,
      settings: decodeSettings({ source: "local", commandPath: "hermes", commandArgs: ["acp"] }),
      checkedAt: "2026-10-14T10:00:00.000Z",
      inspection: { status: "ready", agentId: "", version: null, distribution: "local" },
      probe: {
        agentVersion: "0.24.1",
        probe: {
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [],
          models: [],
          currentModelId: null,
          configOptions: [],
          sessionManagement: noSessionManagement,
        },
        slashCommands: [{ name: "compress" }],
        skills: [],
      },
    });

    expect(provider.driver).toBe("hermes");
    expect(provider.version).toBe("0.24.1");
    expect(provider.reportsContextWindow).toBe(true);
    expect(provider.slashCommands.map((command) => command.name)).toEqual(["compact", "compress"]);

    // Live command updates from a running session keep the compact entry.
    const live = applyAcpRegistryAvailableCommands(
      provider,
      Option.some({ slashCommands: [{ name: "steer" }], skills: [] }),
      profile,
    );
    expect(live.slashCommands.map((command) => command.name)).toEqual(["compact", "steer"]);
  });

  it("name the agent when its executable is missing", () => {
    expect(
      acpRegistrySnapshotReadiness(
        { status: "missing_runner", version: null, distribution: "local" },
        profile,
      ).message,
    ).toBe("Hermes executable is not available on this environment's PATH.");
  });

  it("shows only T3's permission selector for policy-managed native modes on discovery and refresh", () => {
    const modeCapabilities = createModelCapabilities({
      optionDescriptors: [
        {
          id: ACP_SESSION_MODE_OPTION_ID,
          label: "Native mode",
          type: "select",
          options: [{ id: "yolo", label: "Yolo" }],
        },
        {
          id: "mode",
          label: "Permission mode",
          type: "select",
          options: [{ id: "yolo", label: "Yolo" }],
        },
        {
          id: "thought",
          label: "Thinking",
          type: "select",
          options: [{ id: "max", label: "Max" }],
        },
      ],
    });
    const managedProfile = {
      ...profile,
      managedModeOptionIds: ["mode"],
      flavor: { ...profile.flavor, sessionModeForPolicy: () => "build" },
    };
    const settings = decodeSettings({
      source: "local",
      commandPath: "fixture",
      customModels: [{ slug: "custom", capabilities: modeCapabilities }],
    });
    const configuration = {
      models: [{ id: "discovered", name: "Agent model", description: null }],
      currentModelId: "discovered",
      configOptions: modeCapabilities.optionDescriptors ?? [],
    };
    const provider = buildCheckedAcpRegistrySnapshot({
      ...identity,
      profile: managedProfile,
      settings,
      checkedAt: "2026-10-15T10:00:00.000Z",
      inspection: { status: "ready", agentId: "", version: null, distribution: "local" },
      probe: {
        probe: {
          ...configuration,
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [],
          sessionManagement: noSessionManagement,
        },
        slashCommands: [],
        skills: [],
      },
    });
    const refreshed = applyAcpRegistryLiveConfiguration(
      provider,
      configuration,
      settings.customModels,
      managedProfile,
    );
    for (const snapshot of [provider, refreshed]) {
      expect(snapshot.models.map((model) => model.slug)).toEqual(["discovered", "custom"]);
      for (const model of snapshot.models) {
        expect(model.capabilities?.optionDescriptors?.map((option) => option.id)).toEqual([
          "thought",
        ]);
      }
    }
  });

  it("retains custom model names and options through discovery and live refresh", () => {
    const capabilities = createModelCapabilities({
      optionDescriptors: [
        {
          id: "reasoning_effort",
          label: "Reasoning",
          type: "select",
          options: [{ id: "max", label: "Max" }],
        },
      ],
    });
    const settings = decodeSettings({
      source: "local",
      commandPath: "hermes",
      customModels: [
        { slug: "discovered", name: "My discovered model" },
        { slug: "custom/model", name: "Custom model", capabilities },
      ],
    });
    const configuration = {
      models: [{ id: "discovered", name: "Agent model", description: null }],
      currentModelId: "discovered",
      configOptions: [],
    };
    const provider = buildCheckedAcpRegistrySnapshot({
      ...identity,
      profile,
      settings,
      checkedAt: "2026-10-14T10:00:00.000Z",
      inspection: { status: "ready", agentId: "", version: null, distribution: "local" },
      probe: {
        probe: {
          ...configuration,
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [],
          sessionManagement: noSessionManagement,
        },
        slashCommands: [],
        skills: [],
      },
    });
    const refreshed = applyAcpRegistryLiveConfiguration(
      provider,
      configuration,
      settings.customModels,
    );

    for (const snapshot of [provider, refreshed]) {
      expect(snapshot.models).toMatchObject([
        { slug: "discovered", name: "My discovered model", isDefault: true },
        { slug: "custom/model", name: "Custom model", isCustom: true, capabilities },
      ]);
    }
  });
});

describe("acpRegistrySnapshotReadiness", () => {
  it("treats a live empty command advertisement as an authoritative replacement", () => {
    const provider = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ agentId: "test-agent" }),
      checkedAt: "2026-08-13T10:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "test-agent",
        version: "1.0.0",
        distribution: "npx",
        documentationUrl: "https://example.test/agent/setup",
      },
      probe: {
        probe: {
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [],
          models: [],
          currentModelId: null,
          configOptions: [],
          sessionManagement: noSessionManagement,
        },
        slashCommands: [{ name: "stale" }],
        skills: [{ name: "stale-skill", path: "stale", enabled: true }],
      },
    });

    const replaced = applyAcpRegistryAvailableCommands(
      provider,
      Option.some({ slashCommands: [], skills: [] }),
    );
    expect(replaced.slashCommands).toEqual([]);
    expect(replaced.skills).toEqual([]);
    expect(applyAcpRegistryAvailableCommands(provider, Option.none()).slashCommands).toEqual([
      { name: "stale" },
    ]);
    expect(provider.iconUrl).toBe(
      "https://cdn.agentclientprotocol.com/registry/v1/latest/test-agent.svg",
    );
    expect(provider.setup).toMatchObject({
      canAuthenticate: false,
      documentationUrl: "https://example.test/agent/setup",
    });
  });

  it("keeps authentication unknown when an agent permits a discovery session before sign-in", () => {
    const snapshot = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ agentId: "test-agent" }),
      checkedAt: "2026-08-13T10:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "test-agent",
        version: "1.0.0",
        distribution: "binary",
      },
      probe: {
        probe: {
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [{ id: "browser", name: "Browser", description: null, type: "agent" }],
          models: [],
          currentModelId: null,
          configOptions: [],
          sessionManagement: noSessionManagement,
        },
        slashCommands: [],
        skills: [],
      },
    });
    expect(snapshot.auth.status).toBe("unknown");
    expect(snapshot.setup?.canAuthenticate).toBe(true);
    expect(
      applyAcpRegistryLiveConfiguration(
        snapshot,
        { models: [], currentModelId: null, configOptions: [] },
        [],
      ).auth.status,
    ).toBe("unknown");
  });

  it("overlays live configuration without dropping probe-owned session capabilities", () => {
    const provider = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ agentId: "test-agent" }),
      checkedAt: "2026-08-13T10:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "test-agent",
        version: "1.0.0",
        distribution: "npx",
      },
      probe: {
        probe: {
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [],
          models: [{ id: "probe-model", name: "Probe model", description: null }],
          currentModelId: "probe-model",
          configOptions: [],
          sessionManagement: {
            canList: true,
            canLoad: true,
            canResume: true,
            canLogout: true,
            canDelete: true,
            canConfigureProviders: true,
          },
        },
        slashCommands: [],
        skills: [],
      },
    });

    expect(
      applyAcpRegistryLiveConfiguration(
        provider,
        {
          models: [{ id: "live-model", name: "Live model", description: null }],
          currentModelId: "live-model",
          configOptions: [],
        },
        [],
      ),
    ).toMatchObject({
      auth: { status: "unknown", canLogout: true },
      nativeSessions: { canList: true, canLoad: true, canResume: true },
      models: [{ slug: "live-model", isDefault: true }],
    });
  });

  it("maps registry inspection status to provider readiness", () => {
    expect(
      acpRegistrySnapshotReadiness({
        status: "ready",
        agentId: "gemini-cli",
        version: "1.2.3",
        distribution: "npx",
      }),
    ).toEqual({ installed: true, version: "1.2.3", status: "ready" });

    expect(
      acpRegistrySnapshotReadiness({
        status: "missing_runner",
        agentId: "gemini-cli",
        version: "1.2.3",
        distribution: "npx",
        runner: "npx",
      }),
    ).toMatchObject({ installed: false, version: "1.2.3", status: "error" });

    expect(
      acpRegistrySnapshotReadiness({
        status: "missing_runner",
        version: null,
        distribution: "local",
      }),
    ).toEqual({
      installed: false,
      version: null,
      status: "error",
      message: "Local ACP executable is not available on this environment's PATH.",
    });

    expect(
      acpRegistrySnapshotReadiness({
        status: "unprepared",
        agentId: "zed-agent",
        version: "2.0.0",
        distribution: "binary",
      }),
    ).toMatchObject({ installed: false, version: "2.0.0", status: "warning" });

    expect(
      acpRegistrySnapshotReadiness({ status: "failed", message: "Registry unavailable." }),
    ).toEqual({
      installed: false,
      version: null,
      status: "error",
      message: "Registry unavailable.",
    });
  });

  it("projects discovery without claiming authentication when no login methods are advertised", () => {
    const snapshot = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({
        agentId: "test-agent",
        customModels: [" custom-model ", "gpt-discovered"],
      }),
      checkedAt: "2026-08-13T10:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "test-agent",
        version: "1.0.0",
        distribution: "npx",
      },
      probe: {
        probe: {
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [],
          models: [{ id: "gpt-discovered", name: "GPT Discovered", description: null }],
          currentModelId: "gpt-discovered",
          configOptions: [],
          sessionManagement: noSessionManagement,
        },
        slashCommands: [{ name: "plan", description: "Create a plan", input: { hint: "topic" } }],
        skills: [{ name: "workspace-skill", path: "acp://skill/workspace-skill", enabled: true }],
      },
    });

    expect(snapshot.auth).toEqual({ status: "unknown", canLogout: false });
    expect(snapshot.supportsTextGeneration).toBe(false);
    expect(
      snapshot.models.map(({ slug, name, isCustom, isDefault }) => ({
        slug,
        name,
        isCustom,
        isDefault,
      })),
    ).toEqual([
      {
        slug: "gpt-discovered",
        name: "GPT Discovered",
        isCustom: false,
        isDefault: true,
      },
      {
        slug: "custom-model",
        name: "custom-model",
        isCustom: true,
        isDefault: undefined,
      },
    ]);
    expect(snapshot.slashCommands).toEqual([
      { name: "plan", description: "Create a plan", input: { hint: "topic" } },
    ]);
    expect(snapshot.skills).toEqual([
      { name: "workspace-skill", path: "acp://skill/workspace-skill", enabled: true },
    ]);
  });

  it("keeps a default model only when the agent advertises none", () => {
    const snapshot = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ agentId: "test-agent" }),
      checkedAt: "2026-08-13T10:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "test-agent",
        version: "1.0.0",
        distribution: "uvx",
      },
      probe: {
        probe: {
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [],
          models: [],
          currentModelId: null,
          configOptions: [],
          sessionManagement: noSessionManagement,
        },
        slashCommands: [],
        skills: [],
      },
    });

    expect(snapshot.models.map((model) => model.slug)).toEqual(["default"]);
    expect(snapshot.models[0]?.isDefault).toBe(true);
  });

  it.each(["registry", "local"] as const)(
    "reports failed authentication after successful %s inspection",
    (source) => {
      const snapshot = buildCheckedAcpRegistrySnapshot({
        ...identity,
        settings: decodeSettings({
          source,
          ...(source === "local" ? { commandPath: "test-agent" } : { agentId: "test-agent" }),
          authMethodId: "grok-login",
        }),
        checkedAt: "2026-08-13T10:00:00.000Z",
        inspection: {
          status: "ready",
          agentId: "test-agent",
          version: source === "local" ? null : "1.0.0",
          distribution: source === "local" ? "local" : "binary",
        },
        probeError: new AcpRegistryOperationError({
          reason: "authentication_failed",
          message: "Login required.",
          authMethods: [
            {
              id: "api-key",
              name: "API key",
              description: null,
              type: "env_var",
            },
            {
              id: "grok-login",
              name: "Log in with Grok",
              description: null,
              type: "agent",
            },
          ],
        }),
      });

      expect(snapshot).toMatchObject({
        installed: true,
        version: source === "local" ? null : "1.0.0",
        status: "warning",
        setup: { canAuthenticate: true },
        auth: {
          status: "unauthenticated",
          type: "agent",
          label: "Log in with Grok",
        },
        message: 'Sign in in provider settings using "Log in with Grok".',
      });
    },
  );

  it.effect("runs the disposable probe only after local inspection is ready", () =>
    Effect.gen(function* () {
      const settings = decodeSettings({ agentId: "test-agent" });
      const environment = { PATH: "/provider/bin" };
      let receivedEnvironment: NodeJS.ProcessEnv | undefined;
      const snapshot = yield* checkAcpRegistryProviderStatus(
        {
          ...identity,
          settings,
          cwd: "/workspace",
          environment,
        },
        (input) =>
          Effect.sync(() => {
            receivedEnvironment = input.environment;
            return {
              probe: {
                instanceId: identity.instanceId,
                ready: true as const,
                icon: null,
                authMethods: [],
                models: [{ id: "agent-model", name: "Agent Model", description: null }],
                currentModelId: "agent-model",
                configOptions: [],
                sessionManagement: noSessionManagement,
              },
              slashCommands: [{ name: "review" }],
              skills: [],
            };
          }),
      ).pipe(
        Effect.provideService(
          AcpRegistrySupport.AcpRegistryCatalog,
          catalogWithInspection({
            status: "ready",
            agentId: "test-agent",
            version: "1.0.0",
            distribution: "npx",
          }),
        ),
      );

      expect(receivedEnvironment).toBe(environment);
      expect(snapshot).toMatchObject({
        auth: { status: "unknown" },
        models: [{ slug: "agent-model" }],
        slashCommands: [{ name: "review" }],
        skills: [],
      });
    }),
  );

  it.effect("publishes concrete local readiness before background ACP discovery", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkAcpRegistryProviderReadiness({
        ...identity,
        settings: decodeSettings({ agentId: "test-agent" }),
        environment: { PATH: "/provider/bin" },
      }).pipe(
        Effect.provideService(
          AcpRegistrySupport.AcpRegistryCatalog,
          catalogWithInspection({
            status: "ready",
            agentId: "test-agent",
            version: "1.0.0",
            distribution: "npx",
          }),
        ),
      );

      expect(snapshot).toMatchObject({
        installed: true,
        status: "ready",
        version: "1.0.0",
        auth: { status: "unknown" },
        message: "Checking ACP authentication, models, and commands in the background...",
      });
    }),
  );
});
