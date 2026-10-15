import { describe, expect, it } from "vite-plus/test";

import {
  compareForkUpstream,
  newestUpstreamNightly,
  resolveForkUpstreamVersion,
  upstreamMergePrompt,
  upstreamReviewUrl,
  upstreamVersionFromFork,
} from "./forkUpstream.ts";

describe("fork upstream baseline", () => {
  it("decodes the included upstream nightly, independent of fork-only rebuilds", () => {
    expect(upstreamVersionFromFork("0.0.46-nightly.20261014.311801")).toBe(
      "0.0.46-nightly.20261014.3118",
    );
    expect(upstreamVersionFromFork("0.0.46-nightly.20261014.311899")).toBe(
      "0.0.46-nightly.20261014.3118",
    );
  });

  it.each(["0.0.45", "0.0.46-preview.20261014.311801", "dev", "0.0.46-nightly.20261014.311800"])(
    "does not invent a baseline for %s",
    (version) => expect(upstreamVersionFromFork(version)).toBeNull(),
  );

  it("prefers explicit build provenance, including for development builds", () => {
    expect(resolveForkUpstreamVersion("0.0.45", "v0.0.46-nightly.20261014.3118")).toBe(
      "0.0.46-nightly.20261014.3118",
    );
    expect(resolveForkUpstreamVersion("0.0.46-nightly.20261014.311802", "")).toBe(
      "0.0.46-nightly.20261014.3118",
    );
  });

  it("detects another nightly on the same day and clears after integrating it", () => {
    const latest = "0.0.46-nightly.20261014.3132";
    expect(
      compareForkUpstream(upstreamVersionFromFork("0.0.46-nightly.20261014.311802"), latest),
    ).toBe("behind");
    expect(
      compareForkUpstream(upstreamVersionFromFork("0.0.46-nightly.20261014.313201"), latest),
    ).toBe("current");
    expect(
      compareForkUpstream(
        upstreamVersionFromFork("0.0.46-nightly.20261014.313201"),
        "0.0.46-nightly.20261015.3140",
      ),
    ).toBe("behind");
  });

  it("keeps a newer included baseline current and an unknown baseline unknown", () => {
    expect(
      compareForkUpstream("0.0.46-nightly.20261015.3140", "0.0.46-nightly.20261014.3132"),
    ).toBe("current");
    expect(compareForkUpstream(null, "0.0.46-nightly.20261014.3132")).toBe("unknown");
  });
});

describe("published upstream nightlies", () => {
  it("selects by version rather than creation order and ignores other release trains", () => {
    const release = (
      tag_name: string,
      draft = false,
      published_at: string | null = "2026-10-15",
    ) => ({
      tag_name,
      draft,
      published_at,
    });
    expect(
      newestUpstreamNightly([
        release("v0.0.46-nightly.20261014.9"),
        release("v0.0.46-nightly.20261014.10"),
        release("v0.0.46-nightly.20261015.11", true),
        release("v0.0.46-nightly.20261015.12", false, null),
        release("v0.0.47"),
        release("v0.0.47-preview.20261015.20"),
        release("not-a-release"),
      ]),
    ).toEqual({ version: "0.0.46-nightly.20261014.10", publishedAt: "2026-10-15" });
    expect(newestUpstreamNightly([])).toBeNull();
  });

  it("reviews the exact upstream delta, never a fork-version comparison", () => {
    expect(upstreamReviewUrl("0.0.46-nightly.20261014.3118", "0.0.46-nightly.20261014.3132")).toBe(
      "https://github.com/pingdotgg/t3code/compare/v0.0.46-nightly.20261014.3118...v0.0.46-nightly.20261014.3132",
    );
    expect(upstreamReviewUrl(null, "0.0.46-nightly.20261014.3132")).toBe(
      "https://github.com/pingdotgg/t3code/releases/tag/v0.0.46-nightly.20261014.3132",
    );
    expect(upstreamReviewUrl("0.0.46-nightly.20261014.3132", "0.0.46-nightly.20261014.3132")).toBe(
      "https://github.com/pingdotgg/t3code/releases/tag/v0.0.46-nightly.20261014.3132",
    );
    expect(upstreamMergePrompt("0.0.46-nightly.20261014.3132")).toContain(
      "published upstream nightly v0.0.46-nightly.20261014.3132 from pingdotgg/t3code",
    );
    expect(upstreamMergePrompt("0.0.46-nightly.20261014.3132")).toContain(
      "Follow the KSG fork rules and upstream sync procedure in AGENTS.md.",
    );
    expect(upstreamMergePrompt("0.0.46-nightly.20261014.3132")).toContain(
      "Do not push, publish, install updates, or restart devices without my approval.",
    );
  });
});
