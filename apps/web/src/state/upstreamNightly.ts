import { newestUpstreamNightly, T3_UPSTREAM_REPOSITORY } from "@t3tools/shared/forkUpstream";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { Atom } from "effect/reactivity";

const Releases = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.Boolean,
    published_at: Schema.NullOr(Schema.String),
  }),
);

class UpstreamNightlyCheckError extends Schema.TaggedError<UpstreamNightlyCheckError>()(
  "UpstreamNightlyCheckError",
  { message: Schema.String },
) {}

/** Only public upstream metadata is read. No tokens, installs, or git mutations. */
export const upstreamNightlyAtom = Atom.make(
  Effect.gen(function* () {
    // Usually one page. Bound the search if upstream has no published nightlies.
    for (let page = 1; page <= 5; page++) {
      const response = yield* HttpClient.get(
        `https://api.github.com/repos/${T3_UPSTREAM_REPOSITORY}/releases?per_page=100&page=${page}`,
      );
      if (response.status === 403 || response.status === 429) {
        return yield* new UpstreamNightlyCheckError({
          message: "GitHub limited the upstream check. Try again later.",
        });
      }
      const releases = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Releases)),
      );
      const latest = newestUpstreamNightly(releases);
      if (latest !== null) return { ...latest, checkedAt: yield* Clock.currentTimeMillis };
      if (!response.headers.link?.includes('rel="next"')) break;
    }
    return yield* new UpstreamNightlyCheckError({
      message: "No published upstream nightly was found.",
    });
  }).pipe(
    Effect.timeout("15 seconds"),
    // Avoid tracing headers and their cross-origin preflight, as for fork release checks.
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.provide(FetchHttpClient.layer),
  ),
).pipe(Atom.withRefresh("1 hour"), Atom.withLabel("upstream-nightly"));
