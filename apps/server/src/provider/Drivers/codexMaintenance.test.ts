import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  createProviderVersionAdvisory,
  invalidateLatestProviderVersion,
  resolveLatestProviderVersion,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { HttpClient, HttpClientResponse } from "effect/http";
import { makeCodexMaintenanceResolver } from "./codexMaintenance.ts";

const RELEASES = "https://releases.openai.com/codex";
const GITHUB = "https://api.github.com/repos/openai/codex/releases";
const NPM = "https://registry.npmjs.org/%40openai%2Fcodex/latest";
const sharedHome = "/home/test/.codex";

const resolveMaintenance = Effect.fn("test.resolveMaintenance")(function* (
  env: NodeJS.ProcessEnv = {},
  realCommandPath = `${sharedHome}/packages/standalone/current/bin/codex`,
) {
  const resolver = yield* makeCodexMaintenanceResolver(sharedHome);
  return yield* resolver
    .resolve({
      binaryPath: "codex",
      resolvedCommandPath: "/home/test/.local/bin/codex",
      realCommandPath,
      platform: "linux",
      env,
    })
    .pipe(Effect.provideService(HostProcess.Platform, "linux"));
});

function httpFixture(requests: Array<string>, response: (url: string) => Response) {
  return HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push(request.url);
      return HttpClientResponse.fromWeb(request, response(request.url));
    }),
  );
}

it.layer(NodeServices.layer)("Codex maintenance release channel", (it) => {
  it.effect.each([
    { latest: "0.163.0", status: "current" },
    { latest: "0.164.0", status: "behind_latest" },
  ] as const)("reports $status against standalone $latest", (fixture) => {
    const requests: Array<string> = [];
    return Effect.gen(function* () {
      const capabilities = yield* resolveMaintenance();
      const latestVersion = yield* resolveLatestProviderVersion(capabilities);
      const advisory = createProviderVersionAdvisory({
        driver: capabilities.provider,
        currentVersion: "0.163.0",
        latestVersion,
        maintenanceCapabilities: capabilities,
      });
      expect(advisory.status).toBe(fixture.status);
      expect(advisory.latestVersion).toBe(fixture.latest);
      expect(capabilities.update).toMatchObject({
        args: ["update"],
        env: { CODEX_HOME: sharedHome },
      });
      expect(requests).toEqual([`${RELEASES}/channels/latest`]);
    }).pipe(
      Effect.provide(ProviderLatestVersions.layer),
      Effect.provideService(
        HttpClient.HttpClient,
        httpFixture(requests, (url) =>
          Response.json(
            url === NPM ? { version: "0.164.0" } : { tag_name: `rust-v${fixture.latest}` },
          ),
        ),
      ),
    );
  });

  it.effect("keeps failed native metadata unknown even when npm advertises a newer release", () => {
    const requests: Array<string> = [];
    return Effect.gen(function* () {
      const capabilities = yield* resolveMaintenance();
      const latestVersion = yield* resolveLatestProviderVersion(capabilities);
      expect(latestVersion).toBeNull();
      expect(
        createProviderVersionAdvisory({
          driver: capabilities.provider,
          currentVersion: "0.163.0",
          latestVersion,
          maintenanceCapabilities: capabilities,
        }).status,
      ).toBe("unknown");
      expect(requests).toEqual([`${RELEASES}/channels/latest`, `${GITHUB}/latest`]);
    }).pipe(
      Effect.provide(ProviderLatestVersions.layer),
      Effect.provideService(
        HttpClient.HttpClient,
        httpFixture(requests, (url) =>
          url === NPM ? Response.json({ version: "0.164.0" }) : new Response(null, { status: 503 }),
        ),
      ),
    );
  });

  it.effect.each([
    {
      name: "falls back to GitHub when the standalone channel is unavailable",
      env: {},
      urls: [`${RELEASES}/channels/latest`, `${GITHUB}/latest`],
      primary: new Response(null, { status: 503 }),
      version: "0.164.0",
    },
    {
      name: "falls back to GitHub for malformed standalone metadata",
      env: {},
      urls: [`${RELEASES}/channels/latest`, `${GITHUB}/latest`],
      primary: Response.json({ tag_name: "not-a-codex-version" }),
      version: "0.164.0",
    },
    ...["0", "FALSE", "no"].map((value) => ({
      name: `honors the GitHub source override ${value}`,
      env: { CODEX_INSTALLER_USE_RELEASES_OPENAI_COM: value },
      urls: [`${GITHUB}/latest`],
      primary: Response.json({ tag_name: "rust-v0.163.0" }),
      version: "0.164.0",
    })),
    ...["0.164.0-beta.1", "v0.164.0-beta.1", "rust-v0.164.0-beta.1"].map((value) => ({
      name: `honors the pinned release override ${value}`,
      env: { CODEX_RELEASE: value },
      urls: [`${RELEASES}/releases/0.164.0-beta.1/release.json`],
      primary: Response.json({ tag_name: "rust-v0.164.0-beta.1" }),
      version: "0.164.0-beta.1",
    })),
    {
      name: "falls back to the same pinned GitHub release on a metadata mismatch",
      env: { CODEX_RELEASE: "v0.164.0" },
      urls: [`${RELEASES}/releases/0.164.0/release.json`, `${GITHUB}/tags/rust-v0.164.0`],
      primary: Response.json({ tag_name: "rust-v0.163.0" }),
      version: "0.164.0",
    },
  ])("$name", (fixture) => {
    const requests: Array<string> = [];
    return Effect.gen(function* () {
      const capabilities = yield* resolveMaintenance(fixture.env);
      expect(yield* resolveLatestProviderVersion(capabilities)).toBe(fixture.version);
      expect(requests).toEqual(fixture.urls);
      expect(capabilities.update?.env).toEqual({
        ...fixture.env,
        CODEX_HOME: sharedHome,
      });
    }).pipe(
      Effect.provide(ProviderLatestVersions.layer),
      Effect.provideService(
        HttpClient.HttpClient,
        httpFixture(requests, (url) =>
          url.startsWith(RELEASES)
            ? fixture.primary
            : Response.json({ tag_name: `rust-v${fixture.version}` }),
        ),
      ),
    );
  });

  it.effect("keeps npm-managed Codex on npm", () => {
    const requests: Array<string> = [];
    return Effect.gen(function* () {
      const capabilities = yield* resolveMaintenance(
        {},
        "/usr/local/lib/node_modules/@openai/codex/bin/codex.js",
      );
      expect(capabilities.latestVersionLookup).toBeUndefined();
      expect(yield* resolveLatestProviderVersion(capabilities)).toBe("0.164.0");
      expect(requests).toEqual([NPM]);
      expect(capabilities.update?.executable).toBe("npm");
    }).pipe(
      Effect.provide(ProviderLatestVersions.layer),
      Effect.provideService(
        HttpClient.HttpClient,
        httpFixture(requests, () => Response.json({ version: "0.164.0" })),
      ),
    );
  });

  it.effect("caches native metadata independently of npm and invalidates it after updates", () => {
    const requests: Array<string> = [];
    return Effect.gen(function* () {
      const capabilities = yield* resolveMaintenance();
      const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
      yield* latestVersions.cached("@openai/codex", Effect.succeed("0.164.0"));
      expect(yield* resolveLatestProviderVersion(capabilities)).toBe("0.163.0");
      expect(yield* resolveLatestProviderVersion(capabilities)).toBe("0.163.0");
      yield* invalidateLatestProviderVersion(capabilities);
      expect(yield* resolveLatestProviderVersion(capabilities)).toBe("0.164.0");
      expect(requests).toEqual([`${RELEASES}/channels/latest`, `${RELEASES}/channels/latest`]);
    }).pipe(
      Effect.provide(ProviderLatestVersions.layer),
      Effect.provideService(
        HttpClient.HttpClient,
        httpFixture(requests, () =>
          Response.json({ tag_name: requests.length === 1 ? "rust-v0.163.0" : "rust-v0.164.0" }),
        ),
      ),
    );
  });
});
