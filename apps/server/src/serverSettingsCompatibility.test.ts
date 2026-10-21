import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  UsageLimitSourceConfig,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { projectServerSettingsForClient } from "./serverSettings.ts";

const upstreamSettings = Schema.Struct({
  usageLimitSources: Schema.Record(
    UsageLimitSourceId,
    Schema.Struct({ ...UsageLimitSourceConfig.fields, kind: Schema.Literal("cliproxy") }),
  ),
});
const proxyId = UsageLimitSourceId.make("proxy");
const managerId = UsageLimitSourceId.make("manager");
const settings = {
  ...DEFAULT_SERVER_SETTINGS,
  usageLimitSources: {
    [proxyId]: {
      kind: "cliproxy" as const,
      url: "https://proxy.example.test",
      managementKey: "proxy-secret",
      enabled: true,
    },
    [managerId]: {
      kind: "cpa-manager" as const,
      url: "https://manager.example.test",
      managementKey: "manager-secret",
      enabled: true,
    },
  },
};

it("keeps upstream mobile settings decodable without changing stored CPA sources", () => {
  assert.throws(() =>
    Schema.decodeUnknownSync(upstreamSettings)(projectServerSettingsForClient(settings, true)),
  );
  const projected = projectServerSettingsForClient(settings, false);
  const decoded = Schema.decodeUnknownSync(upstreamSettings)(projected);
  assert.deepEqual(Object.keys(decoded.usageLimitSources), [proxyId]);
  assert.notInclude(JSON.stringify(projected), "proxy-secret");
  assert.propertyVal(settings.usageLimitSources[managerId], "kind", "cpa-manager");
  assert.propertyVal(settings.usageLimitSources[managerId], "managementKey", "manager-secret");
});

it("keeps CPA Manager settings available to clients that advertise support", () => {
  const projected = projectServerSettingsForClient(settings, true);
  assert.propertyVal(projected.usageLimitSources[managerId], "kind", "cpa-manager");
  assert.notInclude(JSON.stringify(projected), "manager-secret");
});
