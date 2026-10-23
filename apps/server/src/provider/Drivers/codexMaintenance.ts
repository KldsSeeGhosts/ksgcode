import { ProviderDriverKind } from "@t3tools/contracts";
import {
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  type ProviderMaintenanceCapabilitiesResolver,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

const RELEASES_URL = "https://releases.openai.com/codex";
const GITHUB_URL = "https://api.github.com/repos/openai/codex/releases";
// Match scripts/install/install.sh, including its accepted pinned prereleases.
const releaseVersion = /^\d+\.\d+\.\d+(-alpha(\.\d+){0,2}|-beta(\.\d+)?)?$/;
const ReleaseMetadata = Schema.Struct({
  tag_name: Schema.String.check(
    Schema.isPattern(/^rust-v\d+\.\d+\.\d+(-alpha(\.\d+){0,2}|-beta(\.\d+)?)?$/),
  ),
});

const fetchReleaseVersion = Effect.fn("CodexMaintenance.fetchReleaseVersion")(function* (
  url: string,
) {
  const client = yield* HttpClient.HttpClient;
  return yield* Effect.gen(function* () {
    const response = yield* client.execute(
      HttpClientRequest.get(url).pipe(HttpClientRequest.setHeader("accept", "application/json")),
    );
    if (response.status < 200 || response.status >= 300) return null;
    const metadata = yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ReleaseMetadata)),
    );
    return metadata.tag_name.slice("rust-v".length);
  }).pipe(
    Effect.timeoutOption(4_000),
    Effect.map(Option.getOrNull),
    Effect.orElseSucceed(() => null),
  );
});

function standaloneReleaseLookup(env: NodeJS.ProcessEnv) {
  const release = (env.CODEX_RELEASE || "latest").replace(/^(rust-v|v)/, "");
  const preferReleases = /^(1|true|yes)$/i.test(
    env.CODEX_INSTALLER_USE_RELEASES_OPENAI_COM || "true",
  );
  const validRelease = release === "latest" || releaseVersion.test(release);
  const primaryUrl =
    release === "latest"
      ? `${RELEASES_URL}/channels/latest`
      : `${RELEASES_URL}/releases/${release}/release.json`;
  const fallbackUrl =
    release === "latest" ? `${GITHUB_URL}/latest` : `${GITHUB_URL}/tags/rust-v${release}`;
  return {
    cacheKey: `codex-standalone:${preferReleases ? "releases" : "github"}:${release}`,
    read: Effect.gen(function* () {
      if (!validRelease) return null;
      if (preferReleases) {
        const primary = yield* fetchReleaseVersion(primaryUrl);
        if (primary !== null && (release === "latest" || primary === release)) return primary;
      }
      const fallback = yield* fetchReleaseVersion(fallbackUrl);
      return release === "latest" || fallback === release ? fallback : null;
    }),
  };
}

/**
 * The standalone tree lives in the shared home even when the instance uses an
 * auth-overlay shadow home. The updater must replace that shared tree.
 */
export const makeCodexMaintenanceResolver = Effect.fn("makeCodexMaintenanceResolver")(function* (
  sharedHomePath: string,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const resolver = makePackageManagedProviderMaintenanceResolver({
    provider: ProviderDriverKind.make("codex"),
    npmPackageName: "@openai/codex",
    nativeUpdate: {
      args: ["update"],
      isCommandPath: (commandPath) =>
        normalizeCommandPath(commandPath).includes("/packages/standalone/"),
      requiresCommandPath: true,
      env: { CODEX_HOME: sharedHomePath },
    },
  });
  return {
    resolve: (context) =>
      resolver.resolve(context).pipe(
        Effect.map((capabilities) => {
          const update = capabilities.update;
          if (!context || update?.lockKey !== "codex-native") return capabilities;
          // Instance overrides must reach both the metadata lookup and the
          // installer, which otherwise inherits only the server's environment.
          const channelEnv = Object.fromEntries(
            ["CODEX_RELEASE", "CODEX_INSTALLER_USE_RELEASES_OPENAI_COM"].flatMap((key) =>
              context.env[key] === undefined ? [] : [[key, context.env[key]]],
            ),
          );
          const lookup = standaloneReleaseLookup(channelEnv);
          return {
            ...capabilities,
            update: { ...update, env: { ...channelEnv, CODEX_HOME: sharedHomePath } },
            latestVersionLookup: {
              cacheKey: lookup.cacheKey,
              read: lookup.read.pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
            },
          };
        }),
      ),
  } satisfies ProviderMaintenanceCapabilitiesResolver;
});
