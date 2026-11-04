import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  SecretProviderId,
  UsageLimitSourceConfig,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { projectServerSettingsForClient } from "./serverSettings.ts";
import { SECRET_REDACTED } from "./settingsSecrets.ts";

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
    Schema.decodeUnknownSync(upstreamSettings)(
      projectServerSettingsForClient(settings, true, { secretReferences: false }),
    ),
  );
  const projected = projectServerSettingsForClient(settings, false, { secretReferences: false });
  const decoded = Schema.decodeUnknownSync(upstreamSettings)(projected);
  assert.deepEqual(Object.keys(decoded.usageLimitSources), [proxyId]);
  assert.notInclude(JSON.stringify(projected), "proxy-secret");
  assert.propertyVal(settings.usageLimitSources[managerId], "kind", "cpa-manager");
  assert.propertyVal(settings.usageLimitSources[managerId], "managementKey", "manager-secret");
});

it.each([false, true])(
  "keeps CPA Manager settings available with secret references %s",
  (secretReferences) => {
    const reference = { provider: SecretProviderId.make("homelab"), reference: "manager#key" };
    const projected = projectServerSettingsForClient(
      {
        ...settings,
        usageLimitSources: {
          ...settings.usageLimitSources,
          [managerId]: { ...settings.usageLimitSources[managerId]!, managementKey: reference },
        },
      },
      true,
      { secretReferences },
    );
    assert.propertyVal(projected.usageLimitSources[managerId], "kind", "cpa-manager");
    assert.deepEqual(
      projected.usageLimitSources[managerId]?.managementKey,
      secretReferences ? reference : SECRET_REDACTED,
    );
  },
);
