import { ProviderDriverKind } from "@t3tools/contracts";
import {
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  type ProviderMaintenanceCapabilitiesResolver,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

const RELEASES_URL = "https://downloads.claude.ai/claude-code-releases";
const ReleaseVersion = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/));
const UpdateSettings = Schema.fromJsonString(
  Schema.Struct({
    autoUpdatesChannel: Schema.optional(Schema.Literals(["latest", "stable"])),
  }),
);
const decodeReleaseVersion = Schema.decodeEffect(ReleaseVersion);
const decodeUpdateSettings = Schema.decodeEffect(UpdateSettings);

export const makeClaudeMaintenanceResolver = Effect.fn("makeClaudeMaintenanceResolver")(function* (
  configDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const client = yield* HttpClient.HttpClient;
  const readChannel = Effect.fn("ClaudeMaintenance.readChannel")(function* (settingsPath: string) {
    return yield* fs.readFileString(settingsPath).pipe(
      Effect.flatMap(decodeUpdateSettings),
      Effect.map((settings) => settings.autoUpdatesChannel ?? null),
      Effect.orElseSucceed(() => null),
    );
  });
  const resolver = makePackageManagedProviderMaintenanceResolver({
    provider: ProviderDriverKind.make("claudeAgent"),
    npmPackageName: "@anthropic-ai/claude-code",
    nativeUpdate: {
      args: ["update"],
      isCommandPath: (commandPath) => {
        const normalized = normalizeCommandPath(commandPath);
        return (
          normalized.endsWith("/.local/bin/claude") ||
          normalized.endsWith("/.local/bin/claude.exe") ||
          normalized.includes("/.local/share/claude/")
        );
      },
    },
  });
  return {
    resolve: (context) =>
      resolver.resolve(context).pipe(
        Effect.map((capabilities) => {
          const update = capabilities.update;
          if (!context || update?.lockKey !== "claudeAgent-native") return capabilities;
          const managedSettingsPath =
            context.platform === "darwin"
              ? "/Library/Application Support/ClaudeCode/managed-settings.json"
              : context.platform === "win32"
                ? "C:\\Program Files\\ClaudeCode\\managed-settings.json"
                : "/etc/claude-code/managed-settings.json";
          return {
            ...capabilities,
            update: { ...update, env: { ...update.env, CLAUDE_CONFIG_DIR: configDir } },
            // Native releases can lag npm and follow a different release channel.
            latestVersionLookup: {
              cacheKey: `claude-native:${context.platform}:${configDir}`,
              read: Effect.gen(function* () {
                const channel =
                  (yield* readChannel(managedSettingsPath)) ??
                  (yield* readChannel(path.join(configDir, "settings.json"))) ??
                  "latest";
                const response = yield* client.execute(
                  HttpClientRequest.get(`${RELEASES_URL}/${channel}`),
                );
                if (response.status < 200 || response.status >= 300) return null;
                const text = yield* response.text;
                return yield* decodeReleaseVersion(text.trim());
              }).pipe(
                Effect.timeoutOption(4_000),
                Effect.map(Option.getOrNull),
                Effect.orElseSucceed(() => null),
              ),
            },
          };
        }),
      ),
  } satisfies ProviderMaintenanceCapabilitiesResolver;
});
