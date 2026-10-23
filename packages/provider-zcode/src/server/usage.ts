import { TrimmedNonEmptyString } from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import {
  tokenCount,
  totalTokens,
  type ProviderUsageReader,
  type ProviderUsageScan,
  type UsageRecord,
} from "@t3tools/provider-core/server/usage";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import type { ZcodeSettings } from "../settings.ts";

const ModelUsageRow = Schema.Struct({
  id: TrimmedNonEmptyString,
  session_id: TrimmedNonEmptyString,
  provider_id: TrimmedNonEmptyString,
  model_id: TrimmedNonEmptyString,
  started_at: Schema.Finite.check(Schema.isGreaterThan(0)),
  input_tokens: Schema.Unknown,
  output_tokens: Schema.Unknown,
  reasoning_tokens: Schema.Unknown,
  cache_creation_input_tokens: Schema.Unknown,
  cache_read_input_tokens: Schema.Unknown,
});
const decodeRow = Schema.decodeUnknownOption(ModelUsageRow);
const PAGE_SIZE = 256;

const readDatabase = Effect.fn("zcodeUsageReader.readDatabase")(function* (sinceMs: number) {
  const records: UsageRecord[] = [];
  let malformed = false;
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe("PRAGMA busy_timeout = 100");
  const [range] = yield* sql.unsafe<{
    readonly first: number | null;
    readonly last: number | null;
  }>("SELECT MIN(rowid) AS first, MAX(rowid) AS last FROM model_usage");
  if (range?.first === null || range?.last === null || range === undefined) {
    return { records, malformed };
  }
  // Bound each synchronous SQLite read, including when most rows are outside
  // the window, and leave rows appended during the scan for the next refresh.
  for (let after = range.first - 1; after < range.last; after += PAGE_SIZE) {
    const rows = yield* sql
      .unsafe(
        `SELECT id, session_id, provider_id, model_id, started_at,
                input_tokens, output_tokens, reasoning_tokens,
                cache_creation_input_tokens, cache_read_input_tokens
         FROM model_usage
         WHERE rowid > ? AND rowid <= ? AND started_at >= ? AND status != 'running'
         ORDER BY rowid`,
        [after, Math.min(after + PAGE_SIZE, range.last), sinceMs],
      )
      .pipe(Effect.withTracerEnabled(false));
    for (const raw of rows) {
      const decoded = decodeRow(raw);
      if (Option.isNone(decoded)) {
        malformed = true;
        continue;
      }
      const row = decoded.value;
      const cachedInputTokens = tokenCount(row.cache_read_input_tokens);
      const cacheCreationTokens = tokenCount(row.cache_creation_input_tokens);
      const outputTokens = tokenCount(row.output_tokens);
      const totals = {
        // ZCode's input and output counters include cache and reasoning respectively.
        uncachedInputTokens: Math.max(
          0,
          tokenCount(row.input_tokens) - cachedInputTokens - cacheCreationTokens,
        ),
        cachedInputTokens,
        cacheCreationTokens,
        outputTokens,
        reasoningTokens: Math.min(outputTokens, tokenCount(row.reasoning_tokens)),
      };
      if (totalTokens(totals) === 0) continue;
      const firstParty = row.provider_id === "zai" || row.provider_id.startsWith("account:zai-");
      records.push({
        provider: "zcode",
        timestampMs: row.started_at,
        model: row.model_id,
        ...(firstParty ? { rateModel: `zai/${row.model_id.toLowerCase()}` } : {}),
        sessionId: row.session_id,
        totals,
        reportedCostUsd: null,
        speed: "standard",
        dedupeKey: `zcode:${row.id}`,
      });
    }
    yield* Effect.yieldNow;
  }
  return { records, malformed };
});

export const zcodeUsageReader: ProviderUsageReader<
  ZcodeSettings,
  FileSystem.FileSystem | Path.Path
> = {
  kind: "scan",
  provider: "zcode",
  scan: Effect.fn("zcodeUsageReader.scan")(function* ({ instances, windowStartMs }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* HostProcess.HomeDirectory;
    const roots = new Set<string>();
    for (const { environment } of instances) {
      const configured = environment.ZCODE_DATA_DIR?.split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      for (const root of configured?.length ? configured : [path.join(home, ".zcode", "cli")]) {
        const resolved = path.resolve(expandHomePath(root, home));
        roots.add(yield* fileSystem.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved)));
      }
    }
    return yield* Effect.forEach(roots, (dir) =>
      Effect.gen(function* () {
        const filename = path.join(dir, "db", "db.sqlite");
        const exists = yield* fileSystem.exists(filename);
        if (!exists) return { dir, files: null };
        const { records, malformed } = yield* readDatabase(windowStartMs).pipe(
          Effect.provide(NodeSqliteClient.layer({ filename, readonly: true })),
        );
        return {
          dir,
          files: [{ path: filename, records }],
          ...(malformed
            ? { status: "partial", message: "Some ZCode usage records could not be read." }
            : {}),
        } satisfies ProviderUsageScan;
      }).pipe(
        Effect.catchTags({
          PlatformError: () =>
            Effect.succeed({
              dir,
              files: [],
              status: "failed",
              message: "ZCode history could not be read.",
            } satisfies ProviderUsageScan),
          SqlError: () =>
            Effect.succeed({
              dir,
              files: [],
              status: "failed",
              message: "ZCode's model usage database could not be read.",
            } satisfies ProviderUsageScan),
        }),
      ),
    );
  }),
};
