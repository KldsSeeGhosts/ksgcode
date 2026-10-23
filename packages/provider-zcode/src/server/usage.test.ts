import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import { zcodeUsageReader } from "./usage.ts";

const SINCE = 1790000000000;
const usage = {
  id: "request-1",
  session_id: "session-1",
  provider_id: "account:zai-individual-coding-plan",
  model_id: "GLM-5.3-Flash",
  started_at: SINCE,
  input_tokens: 100,
  output_tokens: 20,
  reasoning_tokens: 5,
  cache_creation_input_tokens: 10,
  cache_read_input_tokens: 30,
  status: "completed",
};

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "zcode-usage-test-" });
  yield* fs.makeDirectory(path.join(dir, "db"));
  const context = yield* Layer.build(
    NodeSqliteClient.layer({ filename: path.join(dir, "db", "db.sqlite") }),
  );
  const sql = Context.get(context, SqlClient.SqlClient);
  yield* sql.unsafe("PRAGMA journal_mode = WAL");
  yield* sql.unsafe("PRAGMA wal_autocheckpoint = 0");
  yield* sql.unsafe(
    `CREATE TABLE model_usage (
       id TEXT PRIMARY KEY, session_id TEXT, provider_id TEXT, model_id TEXT,
       started_at INTEGER, input_tokens INTEGER, output_tokens INTEGER,
       reasoning_tokens INTEGER, cache_creation_input_tokens INTEGER,
       cache_read_input_tokens INTEGER, status TEXT
     )`,
  );
  const insert = (overrides: Partial<typeof usage> = {}) =>
    sql.unsafe(
      `INSERT INTO model_usage (${Object.keys(usage).join(", ")})
       VALUES (${Object.keys(usage)
         .map(() => "?")
         .join(", ")})`,
      Object.values({ ...usage, ...overrides }),
    );
  return { fs, path, dir, sql, insert };
});

const scan = (roots: readonly string[], windowStartMs = SINCE) => {
  if (zcodeUsageReader.kind !== "scan") throw new Error("Expected a database usage reader");
  return zcodeUsageReader.scan({
    instances: roots.map((root, index) => ({
      instanceId: ProviderInstanceId.make(`zcode-${index}`),
      config: undefined,
      configured: true,
      environment: { ZCODE_DATA_DIR: root },
    })),
    settings: DEFAULT_SERVER_SETTINGS,
    windowStartMs,
    retentionCutoffMs: windowStartMs,
    awaitRefresh: false,
  });
};

describe("ZCode usage", () => {
  it.effect("counts requests once with disjoint cache buckets and first-party GLM pricing", () =>
    Effect.gen(function* () {
      const { dir, insert } = yield* setup;
      yield* insert();
      yield* insert({ id: "retry-1", status: "error", input_tokens: 8, output_tokens: 3 });
      yield* insert({ id: "cancelled", status: "cancelled", provider_id: "custom" });
      yield* insert({ id: "old", started_at: SINCE - 1 });
      yield* insert({ id: "active", status: "running" });
      yield* insert({
        id: "empty",
        input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      });
      const [source] = yield* scan([dir]);
      assert.strictEqual(source?.status, undefined);
      const records = source?.files?.flatMap((file) => file.records) ?? [];
      assert.deepStrictEqual(
        records.map((record) => record.dedupeKey),
        ["zcode:request-1", "zcode:retry-1", "zcode:cancelled"],
      );
      assert.deepStrictEqual(records[0], {
        provider: "zcode",
        timestampMs: SINCE,
        model: "GLM-5.3-Flash",
        rateModel: "zai/glm-5.3-flash",
        sessionId: "session-1",
        totals: {
          uncachedInputTokens: 60,
          cachedInputTokens: 30,
          cacheCreationTokens: 10,
          outputTokens: 20,
          reasoningTokens: 5,
        },
        reportedCostUsd: null,
        speed: "standard",
        dedupeKey: "zcode:request-1",
      });
      assert.strictEqual(records[1]?.totals.uncachedInputTokens, 0);
      assert.strictEqual(records[1]?.totals.reasoningTokens, 3);
      assert.strictEqual(records[2]?.rateModel, undefined);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("sees completed requests and new WAL rows across multiple pages", () =>
    Effect.gen(function* () {
      const { fs, path, dir, sql, insert } = yield* setup;
      yield* insert({ status: "running" });
      assert.deepStrictEqual((yield* scan([dir]))[0]?.files?.[0]?.records, []);
      yield* sql.unsafe("UPDATE model_usage SET status = 'completed' WHERE id = ?", [usage.id]);
      for (let index = 0; index < 260; index++) {
        yield* insert({ id: `new-${index}`, started_at: SINCE + 1 });
      }
      const [source] = yield* scan([dir]);
      assert.strictEqual(source?.files?.[0]?.records.length, 261);
      assert.strictEqual((yield* scan([dir], SINCE + 1))[0]?.files?.[0]?.records.length, 260);
      assert.isAbove(Number((yield* fs.stat(path.join(dir, "db", "db.sqlite-wal"))).size), 0);
      assert.strictEqual(
        (yield* sql.unsafe<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM model_usage",
        ))[0]?.count,
        261,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("deduplicates aliased homes across instances and expands configured roots", () =>
    Effect.gen(function* () {
      const { fs, path, dir, insert } = yield* setup;
      yield* insert();
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "zcode-homes-test-" });
      const alias = path.join(home, "alias");
      yield* fs.symlink(dir, alias);
      const sources = yield* scan([` ${dir}, ~/alias, `, dir]).pipe(
        Effect.provideService(HostProcess.HomeDirectory, home),
      );
      assert.strictEqual(sources.length, 1);
      assert.strictEqual(sources[0]?.dir, yield* fs.realPath(dir));
      assert.strictEqual(sources[0]?.files?.[0]?.records.length, 1);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("uses the default CLI home and does not create a missing database", () =>
    Effect.gen(function* () {
      const { fs, path, dir, insert } = yield* setup;
      yield* insert();
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "zcode-default-test-" });
      yield* fs.makeDirectory(path.join(home, ".zcode"));
      yield* fs.symlink(dir, path.join(home, ".zcode", "cli"));
      const sources = yield* scan([""]).pipe(
        Effect.provideService(HostProcess.HomeDirectory, home),
      );
      assert.strictEqual(sources[0]?.files?.[0]?.records.length, 1);
      const missing = path.join(home, "missing");
      assert.strictEqual((yield* scan([missing]))[0]?.files, null);
      assert.isFalse(yield* fs.exists(missing));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports unreadable schemas and malformed rows without hiding healthy history", () =>
    Effect.gen(function* () {
      const { dir, sql, insert } = yield* setup;
      yield* insert();
      yield* insert({ id: "invalid", model_id: " " });
      const [partial] = yield* scan([dir]);
      assert.strictEqual(partial?.status, "partial");
      assert.strictEqual(partial?.files?.[0]?.records.length, 1);
      yield* sql.unsafe("DROP TABLE model_usage");
      const [failed] = yield* scan([dir]);
      assert.strictEqual(failed?.status, "failed");
      assert.deepStrictEqual(failed?.files, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
