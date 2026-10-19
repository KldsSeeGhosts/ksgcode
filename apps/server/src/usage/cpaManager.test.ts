import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import { UsageLimitSourceSnapshot, UsageLimitSourceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";

import { makeCliproxyApi } from "./cliproxyApi.ts";

const encodeSnapshot = Schema.encodeEffect(UsageLimitSourceSnapshot);
const config = {
  kind: "cpa-manager",
  url: "https://manager.test/prefix",
  managementKey: "manager-admin-secret",
  enabled: true,
} as const;
const refreshedAt = "2026-10-19T12:00:00Z";
const window = {
  id: "five-hour",
  label: "5-hour",
  usedPercent: 25,
  remainingPercent: 75,
  resetAt: "2026-10-19T16:00:00Z",
};
const account = {
  id: "acct_7c2e3251b4671d70",
  label: "fi********m",
  plan: "pro",
  status: "ok",
  error: null,
  windows: [window],
};
const summary = {
  schemaVersion: 1,
  refreshedAt,
  status: "ok",
  error: null,
  providers: [{ id: "codex", label: "Codex", accounts: [account] }],
};
const file = {
  id: "runtime-first",
  name: "codex-first.json",
  auth_index: "a",
  provider: "codex",
  email: "first@example.com",
  access_token: "provider-access-secret",
  refresh_token: "provider-refresh-secret",
  id_token: { chatgpt_account_id: "workspace-first", token: "id-token-secret" },
};

function fixture(
  options: {
    summary?: unknown;
    files?: unknown[];
    summaryStatus?: number;
    inventoryStatus?: number;
  } = {},
) {
  const requests: Array<{ method: string; url: string }> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({ method: request.method, url: request.url });
      expect(request.headers.authorization).toBe("Bearer manager-admin-secret");
      const inventory = request.url.endsWith("/auth-files");
      return HttpClientResponse.fromWeb(
        request,
        Response.json(
          inventory ? { files: options.files ?? [file] } : (options.summary ?? summary),
          { status: inventory ? (options.inventoryStatus ?? 200) : (options.summaryStatus ?? 200) },
        ),
      );
    }),
  );
  return {
    requests,
    api: makeCliproxyApi.pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provide(NodeCrypto.layer),
    ),
  };
}

describe("CPA Manager usage source", () => {
  it.effect(
    "joins cached quotas to inventory without requesting provider tokens or forcing a refresh",
    () =>
      Effect.gen(function* () {
        const test = fixture();
        const api = yield* test.api;
        const result = yield* api.readManager(config);
        expect(result.accounts).toMatchObject([
          {
            id: account.id,
            driver: "codex",
            label: "first@example.com",
            fileName: "codex-first.json",
            email: "first@example.com",
            plan: "pro",
            workspaceId: "workspace-first",
            usageLimits: {
              checkedAt: refreshedAt,
              windows: [{ kind: "session", usedPercent: 25, windowDurationMins: 300 }],
            },
          },
        ]);
        expect(test.requests).toEqual([
          { method: "GET", url: "https://manager.test/prefix/v0/management/quota/summary" },
          { method: "GET", url: "https://manager.test/prefix/v0/management/auth-files" },
        ]);
        const snapshot = yield* encodeSnapshot({
          id: UsageLimitSourceId.make("cpa-test"),
          kind: "cpa-manager",
          label: "CPA",
          checkedAt: refreshedAt,
          ...result,
        });
        const encoded = JSON.stringify(snapshot);
        expect(encoded).not.toContain("secret");
        expect(encoded).not.toContain("auth_index");
        expect(encoded).not.toContain("runtime-first");
      }),
  );

  it.effect("retains disabled, unsupported and failed auth files as distinct accounts", () =>
    Effect.gen(function* () {
      const test = fixture({
        files: [
          file,
          {
            name: "codex-disabled.json",
            auth_index: "b",
            provider: "codex",
            email: "second@example.com",
            disabled: true,
          },
          { name: "gemini.json", auth_index: "gemini", provider: "gemini" },
        ],
        summary: {
          ...summary,
          providers: [
            {
              ...summary.providers[0]!,
              accounts: [
                account,
                {
                  ...account,
                  id: "acct_4472428389ed8cbf",
                  windows: [],
                  status: "error",
                  error: { code: "unauthorized", message: "provider-access-secret" },
                },
              ],
            },
          ],
        },
      });
      const api = yield* test.api;
      const result = yield* api.readManager(config);
      expect(result.accounts).toHaveLength(3);
      expect(result.accounts[1]).toMatchObject({
        disabled: true,
        fileName: "codex-disabled.json",
        usageLimits: {
          unavailable: {
            reason: "probeFailed",
            message: "Account authorization needs attention in CPA.",
          },
        },
      });
      expect(result.accounts[2]).toMatchObject({
        driver: "gemini",
        fileName: "gemini.json",
        usageLimits: { windows: [], unavailable: { reason: "unsupported" } },
      });
      expect(JSON.stringify(result)).not.toContain("secret");
    }),
  );

  it.effect("keeps masked summary accounts when metadata is unavailable, with no retries", () =>
    Effect.gen(function* () {
      const test = fixture({ inventoryStatus: 401 });
      const api = yield* test.api;
      const result = yield* api.readManager(config);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0]?.label).toBe(account.label);
      expect(result.accounts[0]?.usageLimits.windows[0]?.usedPercent).toBe(25);
      expect(result.accounts[0]?.usageLimits.unavailable?.message).toContain(
        "not included in pooled limits",
      );
      expect(result.error).toContain("metadata could not be read");
      expect(test.requests).toHaveLength(2);
    }),
  );

  it.effect("does not attempt inventory or retry after manager authentication is denied", () =>
    Effect.gen(function* () {
      const test = fixture({ summaryStatus: 401 });
      const api = yield* test.api;
      const error = yield* Effect.flip(api.readManager(config));
      expect(error.detail).toContain("401");
      expect(test.requests).toHaveLength(1);
    }),
  );

  it.effect(
    "rejects incompatible summaries without exposing their payload or probing accounts",
    () =>
      Effect.gen(function* () {
        const test = fixture({
          summary: { ...summary, schemaVersion: 2, token: "provider-access-secret" },
        });
        const api = yield* test.api;
        const error = yield* Effect.flip(api.readManager(config));
        expect(error.detail).toBe("CPA Manager returned an unsupported quota summary.");
        expect(test.requests).toHaveLength(1);
      }),
  );

  it.effect("labels stale and carried-forward readings without discarding useful windows", () =>
    Effect.gen(function* () {
      const test = fixture({
        summary: {
          ...summary,
          status: "stale",
          providers: [
            {
              ...summary.providers[0]!,
              accounts: [{ ...account, error: { code: "rate_limited" } }],
            },
          ],
        },
      });
      const api = yield* test.api;
      const result = yield* api.readManager(config);
      expect(result.stale).toBe(true);
      expect(result.accounts[0]?.notice).toContain("Showing cached quota");
      expect(result.accounts[0]?.usageLimits.unavailable).toBeUndefined();
      expect(result.accounts[0]?.usageLimits.checkedAt).toBe(refreshedAt);
    }),
  );

  it.effect(
    "normalizes Claude and Cursor windows and preserves synthetic and unknown providers",
    () =>
      Effect.gen(function* () {
        const test = fixture({
          files: [],
          summary: {
            ...summary,
            providers: [
              {
                id: "claude",
                label: "Claude",
                accounts: [{ ...account, windows: [{ ...window, id: "seven-day-opus" }] }],
              },
              {
                id: "cursor",
                label: "Cursor",
                accounts: [{ ...account, windows: [{ ...window, id: "auto" }] }],
              },
              {
                id: "zai",
                label: "Z.ai",
                accounts: [
                  {
                    ...account,
                    windows: [
                      { ...window, usedPercent: null, remainingPercent: 40, resetAt: "invalid" },
                    ],
                  },
                ],
              },
              {
                id: "opencode-go",
                label: "OpenCode Go",
                accounts: [
                  { ...account, synthetic: true, windows: [{ ...window, estimated: true }] },
                ],
              },
            ],
          },
        });
        const api = yield* test.api;
        const result = yield* api.readManager(config);
        expect(result.accounts.map((item) => item.driver)).toEqual([
          "claudeAgent",
          "cursor",
          "zai",
          "opencode-go",
        ]);
        expect(result.accounts[0]?.usageLimits.windows[0]).toMatchObject({
          id: "seven_day_opus",
          kind: "weekly",
        });
        expect(result.accounts[1]?.usageLimits.windows[0]).toMatchObject({
          id: "autoPercentUsed",
          kind: "monthly",
        });
        expect(result.accounts[2]?.usageLimits.windows[0]).toMatchObject({ usedPercent: 60 });
        expect(result.accounts[2]?.usageLimits.windows[0]?.resetsAt).toBeUndefined();
        expect(result.accounts[3]).toMatchObject({
          synthetic: true,
          usageLimits: { windows: [{ estimated: true }] },
        });
      }),
  );

  it.effect("accepts null quota windows without losing inventory", () =>
    Effect.gen(function* () {
      const test = fixture({
        summary: {
          ...summary,
          providers: [
            {
              ...summary.providers[0]!,
              accounts: [
                { ...account, status: "error", error: { code: "timeout" }, windows: null },
              ],
            },
          ],
        },
      });
      const api = yield* test.api;
      const result = yield* api.readManager(config);
      expect(result.accounts[0]?.fileName).toBe(file.name);
      expect(result.accounts[0]?.usageLimits.unavailable?.message).toContain("did not answer");
    }),
  );

  it.effect("keeps inventory when the manager has not produced a quota snapshot yet", () =>
    Effect.gen(function* () {
      const test = fixture({
        summary: {
          ...summary,
          refreshedAt: "",
          status: "unavailable",
          error: { code: "setup_required" },
          providers: [],
        },
      });
      const api = yield* test.api;
      const result = yield* api.readManager(config);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0]?.usageLimits.unavailable).toMatchObject({
        reason: "probeFailed",
        message: "Quota reporting is not configured in CPA.",
      });
      expect(result.accounts[0]?.usageLimits.checkedAt).not.toBe("");
      expect(result.error).toContain("not configured");
    }),
  );
});
