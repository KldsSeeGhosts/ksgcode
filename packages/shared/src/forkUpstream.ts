import { compareSemverVersions } from "./semver.ts";

export const T3_UPSTREAM_REPOSITORY = "pingdotgg/t3code";
const NIGHTLY_VERSION = /^\d+\.\d+\.\d+-nightly\.\d{8}\.[1-9]\d*$/;

/** KSG encodes the upstream run as run * 100 + a counter from 1 to 99. */
export function upstreamVersionFromFork(version: string): string | null {
  if (!NIGHTLY_VERSION.test(version)) return null;
  const separator = version.lastIndexOf(".");
  const run = Number(version.slice(separator + 1));
  if (!Number.isSafeInteger(run) || run < 101 || run % 100 === 0) return null;
  return `${version.slice(0, separator + 1)}${Math.floor(run / 100)}`;
}

export function resolveForkUpstreamVersion(
  forkVersion: string,
  upstreamTag: string | undefined,
): string | null {
  const version = upstreamTag?.replace(/^v/, "");
  return version && NIGHTLY_VERSION.test(version) ? version : upstreamVersionFromFork(forkVersion);
}

export interface UpstreamRelease {
  readonly tag_name: string;
  readonly draft: boolean;
  readonly published_at: string | null;
}

/** GitHub orders by creation, not version. Ignore drafts, stable and preview releases. */
export function newestUpstreamNightly(releases: ReadonlyArray<UpstreamRelease>) {
  let newest: { readonly version: string; readonly publishedAt: string } | null = null;
  for (const release of releases) {
    if (release.draft || !release.published_at || !release.tag_name.startsWith("v")) continue;
    const version = release.tag_name.slice(1);
    if (!NIGHTLY_VERSION.test(version)) continue;
    if (newest === null || compareSemverVersions(version, newest.version) > 0) {
      newest = { version, publishedAt: release.published_at };
    }
  }
  return newest;
}

export function compareForkUpstream(includedVersion: string | null, latestVersion: string) {
  if (includedVersion === null) return "unknown";
  return compareSemverVersions(latestVersion, includedVersion) > 0 ? "behind" : "current";
}

export function upstreamReviewUrl(includedVersion: string | null, latestVersion: string): string {
  const repositoryUrl = `https://github.com/${T3_UPSTREAM_REPOSITORY}`;
  return includedVersion !== null &&
    compareForkUpstream(includedVersion, latestVersion) === "behind"
    ? `${repositoryUrl}/compare/v${includedVersion}...v${latestVersion}`
    : `${repositoryUrl}/releases/tag/v${latestVersion}`;
}

export function upstreamMergePrompt(latestVersion: string): string {
  return `Sync KSG Code with published upstream nightly v${latestVersion} from ${T3_UPSTREAM_REPOSITORY}. Follow the KSG fork rules in AGENTS.md and the sync procedure in FORK.md. Fetch upstream tags into refs/tags/upstream/*, verify this release's tag and commit, and merge through upstream, ksg/passthrough, then ksg/dev using their existing worktrees. Preserve the fork patches and customizations, resolve conflicts, and run focused checks. Do not push, publish, install updates, or restart devices without my approval.`;
}
