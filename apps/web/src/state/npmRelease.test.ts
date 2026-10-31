import { AtomRegistry } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { cliReleasePublishedAtom, cliTrackReleaseAtom } from "./npmRelease";

const version = "0.0.46-nightly.20261012.3021";
// FetchHttpClient reads globalThis.fetch once and keeps it, so every test shares this mock.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

async function settledCheck<A, E>(
  atom: import("effect/reactivity").Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) {
  const registry = AtomRegistry.make();
  const unmount = registry.mount(atom);
  try {
    await vi.waitFor(() => {
      const result = registry.get(atom);
      expect(AsyncResult.isInitial(result) || result.waiting).toBe(false);
    });
    return registry.get(atom);
  } finally {
    unmount();
    registry.dispose();
  }
}

describe("cliReleasePublishedAtom", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("checks the fork release without tracing headers, so the browser skips the CORS preflight", async () => {
    fetchMock.mockImplementation(async () => Response.json({ tag_name: `v${version}` }));

    const result = await settledCheck(cliReleasePublishedAtom(version));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = new Request(fetchMock.mock.calls[0]?.[0] ?? "", fetchMock.mock.calls[0]?.[1]);
    expect(request.url).toBe(
      `https://api.github.com/repos/KldsSeeGhosts/ksgcode/releases/tags/v${version}`,
    );
    expect(request.headers.get("traceparent")).toBeNull();
    expect(request.headers.get("b3")).toBeNull();
    expect(AsyncResult.getOrElse(result, () => false)).toBe(true);
  });

  it("reports a missing or draft release as unpublished", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));

    const result = await settledCheck(cliReleasePublishedAtom(version));

    expect(AsyncResult.isSuccess(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => true)).toBe(false);
  });

  // regression: #18709 update-everything skipped npm-installed servers
  it("leaves a failed first check unknown, which callers read as unpublished", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await settledCheck(cliReleasePublishedAtom(version));

    expect(AsyncResult.isFailure(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => false)).toBe(false);
  });

  it("selects tracks from published fork releases and never uses upstream npm metadata", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json([
        { tag_name: "v0.1.5-nightly.20261029.387702", draft: true },
        { tag_name: "v0.1.5-nightly.20261029.387701", draft: false },
        { tag_name: "v0.1.4", draft: false },
      ]),
    );

    const nightly = await settledCheck(cliTrackReleaseAtom("nightly"));
    const stable = await settledCheck(cliTrackReleaseAtom("latest"));

    expect(AsyncResult.getOrElse(nightly, () => null)).toEqual({
      version: "0.1.5-nightly.20261029.387701",
      databaseMigration: undefined,
    });
    expect(AsyncResult.getOrElse(stable, () => null)).toEqual({
      version: "0.1.4",
      databaseMigration: undefined,
    });
    for (const [input, init] of fetchMock.mock.calls) {
      expect(new Request(input, init).url).toBe(
        "https://api.github.com/repos/KldsSeeGhosts/ksgcode/releases?per_page=100&page=1",
      );
    }
  });
});
