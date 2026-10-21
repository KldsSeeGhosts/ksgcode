import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ServerConfigStreamEvent, UsageLimitSourceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UsageLimitSources from "./UsageLimitSources.ts";

const encodeConfigEvent = Schema.encodeSync(ServerConfigStreamEvent);

it.effect("keeps malformed source URLs encodable for config subscribers", () =>
  Effect.gen(function* () {
    const sources = yield* UsageLimitSources.make;
    yield* sources.refresh;
    const snapshots = yield* sources.current;
    expect(snapshots.map((source) => source.label)).toEqual([
      "local-hub",
      "opaque-hub",
      "Named hub",
      "hub.test:8317",
      "Usage limit source",
    ]);
    expect(() =>
      encodeConfigEvent({
        version: 1,
        type: "usageLimitSourcesUpdated",
        payload: { sources: snapshots },
      }),
    ).not.toThrow();
    expect(snapshots.every((source) => source.error === "No management key configured.")).toBe(
      true,
    );
  }).pipe(
    Effect.provide([
      ServerSettings.layerTest({
        usageLimitSources: {
          [UsageLimitSourceId.make("local-hub")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("opaque-hub")]: {
            kind: "cliproxy",
            url: "file:///tmp/hub",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("named-hub")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            label: "Named hub",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("valid-hub")]: {
            kind: "cliproxy",
            url: "https://hub.test:8317",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make(" ")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            managementKey: "",
            enabled: true,
          },
        },
      }),
      Layer.mock(BackgroundPolicy.BackgroundPolicy)({
        shouldRunScopeWork: () => Effect.succeed(false),
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("Unexpected network request")),
      ),
      NodeCrypto.layer,
    ]),
    Effect.scoped,
  ),
);

it.effect(
  "publishes CPA Manager inventory through config snapshots and rejects reset mutations",
  () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const sourceId = UsageLimitSourceId.make("manager");
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push(request.method);
          return HttpClientResponse.fromWeb(
            request,
            Response.json(
              request.url.endsWith("/auth-files")
                ? {
                    files: [
                      {
                        name: "disabled.json",
                        auth_index: "first",
                        provider: "zai",
                        disabled: true,
                      },
                    ],
                  }
                : {
                    schemaVersion: 1,
                    refreshedAt: "2026-10-19T12:00:00Z",
                    status: "ok",
                    error: null,
                    providers: [],
                  },
            ),
          );
        }),
      );
      const sources = yield* UsageLimitSources.make.pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      );
      yield* sources.refresh;
      const snapshots = yield* sources.current;
      expect(snapshots[0]).toMatchObject({
        kind: "cpa-manager",
        label: "Manager",
        accounts: [{ driver: "zai", disabled: true, fileName: "disabled.json" }],
      });
      expect(() =>
        encodeConfigEvent({
          version: 1,
          type: "usageLimitSourcesUpdated",
          payload: { sources: snapshots },
        }),
      ).not.toThrow();
      const reset = yield* sources
        .consumeResetCredit({ sourceId, accountId: "first", creditId: "credit" })
        .pipe(Effect.result);
      expect(reset._tag).toBe("Failure");
      expect(requests.every((method) => method === "GET")).toBe(true);
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest({
          usageLimitSources: {
            [UsageLimitSourceId.make("manager")]: {
              kind: "cpa-manager",
              label: "Manager",
              url: "https://manager.test",
              managementKey: "test-key",
              enabled: true,
            },
          },
        }),
        Layer.mock(BackgroundPolicy.BackgroundPolicy)({
          shouldRunScopeWork: () => Effect.succeed(false),
        }),
        NodeCrypto.layer,
      ]),
      Effect.scoped,
    ),
);
