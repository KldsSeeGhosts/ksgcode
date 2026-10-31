import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  createProviderVersionAdvisory,
  invalidateLatestProviderVersion,
  resolveLatestProviderVersion,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";
import { makeClaudeMaintenanceResolver } from "./claudeMaintenance.ts";

const RELEASES = "https://downloads.claude.ai/claude-code-releases";
const NPM = "https://registry.npmjs.org/%40anthropic-ai%2Fclaude-code/latest";

function httpFixture(requests: Array<string>, response: (url: string) => Response) {
  return HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push(request.url);
      return HttpClientResponse.fromWeb(request, response(request.url));
    }),
  );
}

const resolveMaintenance = Effect.fn("test.resolveClaudeMaintenance")(function* (
  settings: object = {},
  realCommandPath = "/home/test/.local/share/claude/versions/2.1.314",
  platform: NodeJS.Platform = "linux",
  managedSettings: object = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configDir = yield* fs.makeTempDirectoryScoped();
  yield* fs.writeFileString(path.join(configDir, "settings.json"), JSON.stringify(settings));
  const resolver = yield* makeClaudeMaintenanceResolver(configDir).pipe(
    Effect.provideService(FileSystem.FileSystem, {
      ...fs,
      readFileString: (filePath, encoding) =>
        filePath.endsWith("managed-settings.json")
          ? Effect.succeed(JSON.stringify(managedSettings))
          : fs.readFileString(filePath, encoding),
    }),
  );
  return yield* resolver
    .resolve({
      binaryPath: "claude",
      resolvedCommandPath: realCommandPath,
      realCommandPath,
      platform,
      env: {},
    })
    .pipe(Effect.provideService(HostProcess.Platform, platform));
});

it.layer(NodeServices.layer)("Claude maintenance release channel", (it) => {
  it.effect.each([
    { settings: {}, channel: "latest", latest: "2.1.314", status: "current" },
    {
      settings: { autoUpdatesChannel: "stable" },
      channel: "stable",
      latest: "2.1.308",
      status: "current",
    },
    { settings: {}, channel: "latest", latest: "2.1.315", status: "behind_latest" },
  ] as const)("checks native $channel instead of npm ($status)", (fixture) => {
    const requests: Array<string> = [];
    return Effect.gen(function* () {
      const capabilities = yield* resolveMaintenance(fixture.settings);
      const latestVersion = yield* resolveLatestProviderVersion(capabilities);
      const advisory = createProviderVersionAdvisory({
        driver: capabilities.provider,
        currentVersion: fixture.channel === "stable" ? "2.1.308" : "2.1.314",
        latestVersion,
        maintenanceCapabilities: capabilities,
      });
      expect(advisory.status).toBe(fixture.status);
      expect(advisory.latestVersion).toBe(fixture.latest);
      expect(requests).toEqual([`${RELEASES}/${fixture.channel}`]);
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      expect(
        JSON.parse(
          yield* fs.readFileString(
            path.join(capabilities.update!.env!.CLAUDE_CONFIG_DIR!, "settings.json"),
          ),
        ),
      ).toEqual(fixture.settings);
    }).pipe(
      Effect.scoped,
      Effect.provide(ProviderLatestVersions.layer),
      Effect.provideService(
        HttpClient.HttpClient,
        httpFixture(requests, (url) =>
          url === NPM ? Response.json({ version: "2.1.316" }) : new Response(`${fixture.latest}\n`),
        ),
      ),
    );
  });

  it.effect.each([
    { platform: "darwin", commandPath: "/Users/test/.local/bin/claude" },
    { platform: "win32", commandPath: "C:\\Users\\test\\.local\\bin\\claude.exe" },
  ] as const)("recognizes native installs on $platform", (fixture) => {
    const requests: Array<string> = [];
    return Effect.gen(function* () {
      const capabilities = yield* resolveMaintenance({}, fixture.commandPath, fixture.platform);
      expect(yield* resolveLatestProviderVersion(capabilities)).toBe("2.1.314");
      expect(requests).toEqual([`${RELEASES}/latest`]);
    }).pipe(
      Effect.scoped,
      Effect.provide(ProviderLatestVersions.layer),
      Effect.provideService(
        HttpClient.HttpClient,
        httpFixture(requests, () => new Response("2.1.314")),
      ),
    );
  });

  it.effect("gives the managed release channel precedence over the user channel", () => {
    const requests: Array<string> = [];
    return Effect.gen(function* () {
      const capabilities = yield* resolveMaintenance(
        { autoUpdatesChannel: "latest" },
        undefined,
        "linux",
        { autoUpdatesChannel: "stable" },
      );
      expect(yield* resolveLatestProviderVersion(capabilities)).toBe("2.1.308");
      expect(requests).toEqual([`${RELEASES}/stable`]);
    }).pipe(
      Effect.scoped,
      Effect.provide(ProviderLatestVersions.layer),
      Effect.provideService(
        HttpClient.HttpClient,
        httpFixture(requests, () => new Response("2.1.308")),
      ),
    );
  });

  it.effect.each([
    { name: "unavailable", response: () => new Response(null, { status: 503 }) },
    { name: "invalid", response: () => new Response("<html>Unavailable</html>") },
    { name: "empty", response: () => new Response("") },
  ])("keeps $name native metadata unknown instead of falling back to npm", (fixture) => {
    const requests: Array<string> = [];
    return Effect.gen(function* () {
      const capabilities = yield* resolveMaintenance();
      expect(yield* resolveLatestProviderVersion(capabilities)).toBeNull();
      expect(requests).toEqual([`${RELEASES}/latest`]);
    }).pipe(
      Effect.scoped,
      Effect.provide(ProviderLatestVersions.layer),
      Effect.provideService(
        HttpClient.HttpClient,
        httpFixture(requests, (url) =>
          url === NPM ? Response.json({ version: "2.1.316" }) : fixture.response(),
        ),
      ),
    );
  });

  it.effect("keeps npm-managed installs on npm", () => {
    const requests: Array<string> = [];
    return Effect.gen(function* () {
      const capabilities = yield* resolveMaintenance(
        {},
        "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
      );
      expect(capabilities.latestVersionLookup).toBeUndefined();
      expect(yield* resolveLatestProviderVersion(capabilities)).toBe("2.1.316");
      expect(requests).toEqual([NPM]);
      expect(capabilities.update?.executable).toBe("npm");
    }).pipe(
      Effect.scoped,
      Effect.provide(ProviderLatestVersions.layer),
      Effect.provideService(
        HttpClient.HttpClient,
        httpFixture(requests, () => Response.json({ version: "2.1.316" })),
      ),
    );
  });

  it.effect("separates native homes from npm and invalidates native metadata after updates", () => {
    const requests: Array<string> = [];
    return Effect.gen(function* () {
      const capabilities = yield* resolveMaintenance();
      const stable = yield* resolveMaintenance({ autoUpdatesChannel: "stable" });
      const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
      yield* latestVersions.cached("@anthropic-ai/claude-code", Effect.succeed("2.1.316"));
      expect(yield* resolveLatestProviderVersion(capabilities)).toBe("2.1.314");
      expect(yield* resolveLatestProviderVersion(capabilities)).toBe("2.1.314");
      expect(yield* resolveLatestProviderVersion(stable)).toBe("2.1.308");
      yield* invalidateLatestProviderVersion(capabilities);
      expect(yield* resolveLatestProviderVersion(capabilities)).toBe("2.1.315");
      expect(requests).toEqual([`${RELEASES}/latest`, `${RELEASES}/stable`, `${RELEASES}/latest`]);
    }).pipe(
      Effect.scoped,
      Effect.provide(ProviderLatestVersions.layer),
      Effect.provideService(
        HttpClient.HttpClient,
        httpFixture(
          requests,
          (url) =>
            new Response(
              url.endsWith("/stable") ? "2.1.308" : requests.length === 1 ? "2.1.314" : "2.1.315",
            ),
        ),
      ),
    );
  });
});
