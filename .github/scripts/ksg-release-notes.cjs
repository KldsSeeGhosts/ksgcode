const { execFileSync, spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");

const UPSTREAM_REPOSITORY = "pingdotgg/t3code";
const NIGHTLY_TAG = /^v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.([1-9]\d*)$/;

function parseTag(tag) {
  const match = NIGHTLY_TAG.exec(tag);
  if (!match) throw new Error(`Invalid nightly tag: ${tag}`);
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error(`Invalid nightly tag: ${tag}`);
  return parts;
}

function upstreamTagFromFork(tag) {
  const version = parseTag(tag);
  const run = version[4];
  if (run < 101 || run % 100 === 0) throw new Error(`Invalid KSG release tag: ${tag}`);
  return tag.slice(0, tag.lastIndexOf(".") + 1) + Math.floor(run / 100);
}

function compareTags(left, right) {
  const a = parseTag(left);
  const b = parseTag(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
}

function isAncestor(tag, ref, cwd) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", tag, ref], {
    cwd,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Cannot resolve release ancestry for ${tag}: ${result.stderr.trim()}`);
}

function previousRelease(releases, tag, ref, cwd) {
  return releases
    .filter(
      (release) =>
        !release.draft &&
        release.published_at &&
        release.name?.startsWith("KSG Code ") &&
        NIGHTLY_TAG.test(release.tag_name) &&
        compareTags(release.tag_name, tag) < 0,
    )
    .toSorted((left, right) => compareTags(right.tag_name, left.tag_name))
    .find((release) => isAncestor(release.tag_name, ref, cwd));
}

function commitsSince(ref, exclusions, cwd) {
  const output = git(
    ["log", "--no-merges", "--reverse", "-z", "--format=%H%x00%s", ref, "--not", ...exclusions],
    cwd,
  );
  if (!output) return [];
  const fields = output.split("\0");
  const commits = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    commits.push({ sha: fields[index], subject: fields[index + 1] });
  }
  return commits;
}

function changeBullet(commit, repository) {
  const conventional = /^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/i.exec(commit.subject);
  const type = conventional?.[1]?.toLowerCase();
  if (type && ["docs", "test", "style"].includes(type)) return null;
  const labels = { feat: "Feature", fix: "Fix", perf: "Performance", revert: "Revert" };
  const label = conventional?.[0].includes("!:")
    ? "Breaking change"
    : Object.hasOwn(labels, type)
      ? labels[type]
      : undefined;
  const scope = conventional?.[2];
  const description = conventional
    ? `${scope ? `${scope}: ` : ""}${conventional[3]}`
    : commit.subject;
  // Commit subjects are untrusted Markdown, including subjects imported from upstream.
  const text = description.replace(/[\\`*_[\]<>]/g, "\\$&");
  return `- ${label ? `${label}: ` : ""}${text} ([${commit.sha.slice(0, 7)}](https://github.com/${repository}/commit/${commit.sha}))`;
}

function generateReleaseNotes({ releases, repository, tag, upstreamTag, ref = "HEAD", cwd }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid release repository.");
  if (upstreamTagFromFork(tag) !== upstreamTag) {
    throw new Error("KSG version does not match the included upstream nightly.");
  }
  const upstreamRef = `refs/tags/upstream/${upstreamTag}`;
  if (!isAncestor(upstreamRef, ref, cwd)) {
    throw new Error("Included upstream nightly is not contained in the release commit.");
  }
  const previous = previousRelease(releases, tag, ref, cwd);
  const previousUpstream = previous ? upstreamTagFromFork(previous.tag_name) : undefined;
  const forkCommits = commitsSince(
    ref,
    [upstreamRef, ...(previous ? [previous.tag_name] : [])],
    cwd,
  );
  const notes = ["## What's changed"];

  if (!previousUpstream || previousUpstream !== upstreamTag) {
    notes.push(
      "",
      "### Upstream T3 Code",
      "",
      `- Includes upstream T3 Code [${upstreamTag}](https://github.com/${UPSTREAM_REPOSITORY}/releases/tag/${upstreamTag}).`,
    );
    if (previousUpstream) {
      const previousUpstreamRef = `refs/tags/upstream/${previousUpstream}`;
      if (!isAncestor(previousUpstreamRef, upstreamRef, cwd)) {
        throw new Error("Upstream baseline moved backwards or diverged.");
      }
      const changes = commitsSince(upstreamRef, [previousUpstreamRef], cwd)
        .map((commit) => changeBullet(commit, UPSTREAM_REPOSITORY))
        .filter(Boolean);
      notes.push(
        ...changes,
        "",
        `[Compare: upstream changes](https://github.com/${UPSTREAM_REPOSITORY}/compare/${previousUpstream}...${upstreamTag})`,
      );
    }
  }

  // The desktop popover prioritizes the last bullets, so keep KSG's changes last.
  const forkChanges = forkCommits.map((commit) => changeBullet(commit, repository)).filter(Boolean);
  notes.push("", "### KSG Code", "", ...forkChanges);
  if (forkChanges.length === 0) {
    notes.push(
      forkCommits.length > 0
        ? "- Documentation, test, or formatting changes only; no new KSG application changes."
        : previousUpstream === upstreamTag
          ? "- Rebuilt KSG Code; no new application changes."
          : "- No additional KSG-specific changes in this upstream update.",
    );
  }
  if (previous) {
    notes.push(
      "",
      `**Full Changelog**: https://github.com/${repository}/compare/${previous.tag_name}...${tag}`,
    );
  }
  return `${notes.join("\n")}\n`;
}

if (require.main === module) {
  const [outputPath] = process.argv.slice(2);
  if (!outputPath) throw new Error("Usage: node ksg-release-notes.cjs <output-path>");
  const releases = JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        "--paginate",
        "--slurp",
        `repos/${process.env.GITHUB_REPOSITORY}/releases?per_page=100`,
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  ).flat();
  writeFileSync(
    outputPath,
    generateReleaseNotes({
      releases,
      repository: process.env.GITHUB_REPOSITORY,
      tag: process.env.TAG,
      upstreamTag: process.env.UPSTREAM_TAG,
      ref: process.env.GITHUB_SHA,
    }),
  );
}

module.exports = { generateReleaseNotes };
