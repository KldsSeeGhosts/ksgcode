import { useAtomValue } from "@effect/atom-react";
import {
  cliReleaseByTagUrl,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
} from "@t3tools/shared/cliRelease";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

const ReleaseIndex = Schema.Array(
  Schema.Struct({ tag_name: Schema.String, draft: Schema.optional(Schema.Boolean) }),
);

export const cliTrackReleaseAtom = Atom.family((channel: "latest" | "nightly") =>
  Atom.make(
    Effect.gen(function* () {
      for (let page = 1; ; page++) {
        const response = yield* HttpClient.get(cliReleaseIndexPageUrl(page));
        const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap((ok) => ok.json),
          Effect.flatMap(Schema.decodeUnknownEffect(ReleaseIndex)),
        );
        const version = newestCliReleaseVersion(body, channel === "latest" ? "stable" : "nightly");
        if (version !== undefined) {
          // Fork releases have no npm migration manifest; crossing tracks must fail closed.
          return { version, databaseMigration: undefined };
        }
        if (body.length < 100) return null;
      }
    }).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(Atom.withRefresh("5 minutes"), Atom.withLabel(`cli-track-release:${channel}`)),
);

/**
 * Whether `v<version>` is published on the CLI release repository, whose
 * archives servers install from. A 404 is false; network and API errors stay
 * unknown. Both re-check every few minutes, so a release that lands later
 * shows up without a reload.
 */
export const cliReleasePublishedAtom = Atom.family((version: string) =>
  Atom.make(
    Effect.gen(function* () {
      const response = yield* HttpClient.get(cliReleaseByTagUrl(version));
      if (response.status === 404) return false;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
      );
      return typeof body === "object" && body !== null && "tag_name" in body
        ? body.tag_name === `v${version}`
        : false;
    }).pipe(
      // Tracing headers would make the browser send a CORS preflight for a simple GET.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(
    Atom.withRefresh("5 minutes"),
    Atom.keepAlive,
    Atom.withLabel(`cli-release-published:${version}`),
  ),
);

const NO_VERSION_ATOM = Atom.make(AsyncResult.success(false)).pipe(
  Atom.withLabel("cli-release-published:none"),
);

/** True only once the release is confirmed, so callers can hide work that
    would download it until then. */
export function useCliReleasePublished(version: string | null): boolean {
  const result = useAtomValue(version ? cliReleasePublishedAtom(version) : NO_VERSION_ATOM);
  return AsyncResult.getOrElse(result, () => false);
}
