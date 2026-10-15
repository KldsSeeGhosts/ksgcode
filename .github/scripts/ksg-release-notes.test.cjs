const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { generateReleaseNotes } = require("./ksg-release-notes.cjs");

const upstream1 = "v0.0.46-nightly.20261014.9";
const upstream2 = "v0.0.46-nightly.20261014.10";
const fork1 = "v0.0.46-nightly.20261014.901";
const fork2 = "v0.0.46-nightly.20261014.902";
const nextFork = "v0.0.46-nightly.20261014.1001";

function published(tag, overrides = {}) {
  return {
    tag_name: tag,
    name: `KSG Code ${tag.slice(1)}`,
    draft: false,
    published_at: "2026-10-15T00:00:00Z",
    ...overrides,
  };
}

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "ksg-release-notes-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    }).trim();
  git("init", "--initial-branch=upstream");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  const commit = (subject) => {
    git("commit", "--allow-empty", "-m", subject);
    return git("rev-parse", "HEAD");
  };
  commit("feat: existing upstream feature");
  git("tag", `upstream/${upstream1}`);
  git("switch", "-c", "ksg/dev");
  commit("feat: existing KSG feature");
  git("tag", fork1);
  const notes = (overrides = {}) =>
    generateReleaseNotes({
      releases: [published(fork1)],
      repository: "example/ksgcode",
      tag: fork2,
      upstreamTag: upstream1,
      cwd,
      ...overrides,
    });
  return { cwd, git, commit, notes };
}

test("lists direct KSG commits since the last release without upstream or old KSG changes", (t) => {
  const { commit, notes } = fixture(t);
  const sha = commit("feat(settings): add upstream nightly checks");
  commit("fix(providers): preserve custom model options");
  const body = notes();
  assert.match(body, /Feature: settings: add upstream nightly checks/);
  assert.match(body, /Fix: providers: preserve custom model options/);
  assert.ok(body.includes(`https://github.com/example/ksgcode/commit/${sha}`));
  assert.ok(body.includes(`/compare/${fork1}...${fork2}`));
  assert.doesNotMatch(body, /existing (KSG|upstream) feature|### Upstream/);
});

test("includes feature-branch commits merged locally, not generic merge plumbing", (t) => {
  const { git, commit, notes } = fixture(t);
  git("switch", "-c", "ksg/feature");
  commit("feat(web): add theme artwork");
  commit("fix(web): align theme artwork");
  git("switch", "ksg/dev");
  git("merge", "--no-ff", "-m", "Merge feature work", "ksg/feature");
  const body = notes();
  assert.match(body, /add theme artwork/);
  assert.match(body, /align theme artwork/);
  assert.doesNotMatch(body, /Merge feature work/);
});

test("separates newly included upstream changes from KSG changes", (t) => {
  const { git, commit, notes } = fixture(t);
  git("switch", "upstream");
  const upstreamSha = commit("fix(server): reconnect remote sessions");
  git("tag", `upstream/${upstream2}`);
  git("switch", "ksg/dev");
  git("merge", "--no-ff", "-m", "Sync upstream nightly", "upstream");
  const forkSha = commit("feat(web): add KSG artwork");
  const body = notes({ tag: nextFork, upstreamTag: upstream2 });
  const [upstreamSection, forkSection] = body.split("### KSG Code");
  assert.match(upstreamSection, /### Upstream T3 Code/);
  assert.match(upstreamSection, /Fix: server: reconnect remote sessions/);
  assert.ok(upstreamSection.includes(`pingdotgg/t3code/commit/${upstreamSha}`));
  assert.ok(upstreamSection.includes(`/compare/${upstream1}...${upstream2}`));
  assert.doesNotMatch(upstreamSection, /add KSG artwork/);
  assert.match(forkSection, /Feature: web: add KSG artwork/);
  assert.ok(forkSection.includes(`example/ksgcode/commit/${forkSha}`));
  assert.doesNotMatch(forkSection, /reconnect remote sessions|Sync upstream nightly/);
  assert.doesNotMatch(body, /existing (KSG|upstream) feature/);
});

test("uses only published KSG releases, not drafts, upstream releases, or unshipped tags", (t) => {
  const { git, commit, notes } = fixture(t);
  commit("feat: unpublished feature");
  git("tag", fork2);
  commit("fix: unpublished fix");
  const body = notes({
    tag: "v0.0.46-nightly.20261014.904",
    releases: [
      published(fork2, { draft: true }),
      published("v0.0.46-nightly.20261014.903", { published_at: null }),
      published(upstream1, { name: upstream1 }),
      published("v0.0.46-preview.20261014.902"),
      published(fork1),
    ],
  });
  assert.match(body, /unpublished feature/);
  assert.match(body, /unpublished fix/);
  assert.ok(body.includes(`/compare/${fork1}...`));
});

test("skips a newer release from a divergent branch", (t) => {
  const { git, commit, notes } = fixture(t);
  git("switch", "-c", "other-release");
  commit("feat: unrelated branch");
  git("tag", fork2);
  git("switch", "ksg/dev");
  commit("fix: current branch");
  const body = notes({
    tag: "v0.0.46-nightly.20261014.903",
    releases: [published(fork2), published(fork1)],
  });
  assert.match(body, /current branch/);
  assert.doesNotMatch(body, /unrelated branch/);
  assert.ok(body.includes(`/compare/${fork1}...`));
});

test("orders release versions numerically, not by API order or publication time", (t) => {
  const { git, commit, notes } = fixture(t);
  git("tag", "v0.0.46-nightly.20261014.909");
  commit("feat: already shipped in counter ten");
  const previous = "v0.0.46-nightly.20261014.910";
  git("tag", previous);
  commit("fix: not shipped yet");
  const body = notes({
    tag: "v0.0.46-nightly.20261014.911",
    releases: [
      published("v0.0.46-nightly.20261014.909"),
      published(previous, { published_at: "2026-10-14T00:00:00Z" }),
      published(fork1),
    ],
  });
  assert.match(body, /not shipped yet/);
  assert.doesNotMatch(body, /already shipped/);
  assert.ok(body.includes(`/compare/${previous}...`));
});

test("the first release includes fork history but not all upstream history", (t) => {
  const { notes } = fixture(t);
  const body = notes({ releases: [] });
  assert.match(body, /existing KSG feature/);
  assert.match(body, /Includes upstream T3 Code/);
  assert.doesNotMatch(body, /existing upstream feature|Full Changelog/);
});

test("rebuilds report no new KSG changes instead of a comparison-only changelog", (t) => {
  const { notes } = fixture(t);
  const body = notes();
  assert.match(body, /Rebuilt KSG Code; no new application changes/);
  assert.doesNotMatch(body, /existing KSG feature|### Upstream/);
});

test("omits docs and tests, preserves maintenance and nonconventional summaries, and escapes Markdown", (t) => {
  const { commit, notes } = fixture(t);
  commit("docs: update guide");
  commit("test: cover themes");
  commit("chore(release): preserve signing compatibility");
  commit("Improve remote connection recovery");
  commit("fix(web): escape [links](https://example.com) and <html>");
  const body = notes();
  assert.doesNotMatch(body, /update guide|cover themes/);
  assert.match(body, /release: preserve signing compatibility/);
  assert.match(body, /Improve remote connection recovery/);
  assert.ok(body.includes("escape \\[links\\](https://example.com) and \\<html\\>"));
});

test("docs-only releases have an honest fallback", (t) => {
  const { commit, notes } = fixture(t);
  commit("docs: consolidate instructions");
  assert.match(notes(), /Documentation, test, or formatting changes only/);
});

test("fails on missing published release history rather than silently dropping changes", (t) => {
  const { notes } = fixture(t);
  assert.throws(
    () => notes({ releases: [published("v0.0.46-nightly.20261014.899")] }),
    /Cannot resolve release ancestry/,
  );
});

test("keeps breaking-change markers in the generated summary", (t) => {
  const { commit, notes } = fixture(t);
  commit("feat(providers)!: require the new launcher");
  assert.match(notes(), /Breaking change: providers: require the new launcher/);
});

test("generated notes display real changes in the desktop popover, prioritizing KSG", async (t) => {
  const { normalizeDesktopUpdateReleaseNotes } =
    await import("../../apps/desktop/src/updates/releaseNotes.ts");
  const { git, commit, notes } = fixture(t);
  git("switch", "upstream");
  for (let index = 0; index < 10; index += 1) {
    commit(`fix(server): upstream fix ${index}`);
  }
  git("tag", `upstream/${upstream2}`);
  git("switch", "ksg/dev");
  git("merge", "--no-ff", "-m", "Sync upstream nightly", "upstream");
  commit("feat(settings): add upstream nightly checks");
  const body = notes({ tag: nextFork, upstreamTag: upstream2 });
  const normalized = normalizeDesktopUpdateReleaseNotes(body, nextFork.slice(1), "nightly");
  const [group] = normalized.releaseNotes;
  assert.equal(group.totalItems, 12);
  assert.equal(group.items.length, 8);
  assert.match(group.items[0], /Feature: settings: add upstream nightly checks/);
  assert.doesNotMatch(group.items.join("\n"), /Compare:|Full Changelog|###|### KSG Code/);
});

test("rejects inconsistent version metadata and an upstream tag not merged into the release", (t) => {
  const { git, commit, notes } = fixture(t);
  assert.throws(() => notes({ upstreamTag: upstream2 }), /does not match/);
  git("switch", "upstream");
  commit("feat: future upstream feature");
  git("tag", `upstream/${upstream2}`);
  git("switch", "ksg/dev");
  assert.throws(
    () => notes({ tag: nextFork, upstreamTag: upstream2 }),
    /not contained in the release commit/,
  );
});
