import { AtomRegistry } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { upstreamNightlyAtom } from "./upstreamNightly";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

const nightly = {
  tag_name: "v0.0.46-nightly.20261014.3132",
  draft: false,
  published_at: "2026-10-14T23:36:32Z",
};

async function checkUpstream() {
  const registry = AtomRegistry.make();
  const unmount = registry.mount(upstreamNightlyAtom);
  try {
    await vi.waitFor(() => {
      const result = registry.get(upstreamNightlyAtom);
      expect(AsyncResult.isInitial(result) || result.waiting).toBe(false);
    });
    return registry.get(upstreamNightlyAtom);
  } finally {
    unmount();
    registry.dispose();
  }
}

describe("upstream nightly checks", () => {
  afterEach(() => fetchMock.mockReset());
  afterAll(() => vi.unstubAllGlobals());

  it("reads upstream, not the fork, without auth or tracing headers", async () => {
    fetchMock.mockResolvedValue(Response.json([nightly]));
    const result = await checkUpstream();
    expect(AsyncResult.getOrElse(result, () => null)).toMatchObject({
      version: "0.0.46-nightly.20261014.3132",
      publishedAt: nightly.published_at,
      checkedAt: expect.any(Number),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = new Request(fetchMock.mock.calls[0]?.[0] ?? "", fetchMock.mock.calls[0]?.[1]);
    expect(request.url).toBe(
      "https://api.github.com/repos/pingdotgg/t3code/releases?per_page=100&page=1",
    );
    expect(request.method).toBe("GET");
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.headers.get("traceparent")).toBeNull();
  });

  it("checks a subsequent page when stable and preview releases fill the first", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json([{ ...nightly, tag_name: "v0.0.46" }], {
          headers: {
            link: '<https://api.github.com/repos/pingdotgg/t3code/releases?page=2>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(Response.json([nightly]));
    expect(AsyncResult.isSuccess(await checkUpstream())).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = new Request(fetchMock.mock.calls[1]?.[0] ?? "", fetchMock.mock.calls[1]?.[1]);
    expect(request.url).toContain("page=2");
  });

  it.each([403, 429, 500])("does not report current when GitHub returns %s", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    expect(AsyncResult.isFailure(await checkUpstream())).toBe(true);
  });

  it("treats malformed metadata as an error, not an up-to-date result", async () => {
    fetchMock.mockResolvedValue(Response.json({ message: "unexpected response" }));
    expect(AsyncResult.isFailure(await checkUpstream())).toBe(true);
  });

  it("reports missing published nightlies and stops without a next page", async () => {
    fetchMock.mockResolvedValue(Response.json([{ ...nightly, draft: true }]));
    expect(AsyncResult.isFailure(await checkUpstream())).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds pagination rather than fetching indefinitely", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json([], { headers: { link: '<https://api.github.com/>; rel="next"' } }),
    );
    expect(AsyncResult.isFailure(await checkUpstream())).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("preserves a network failure rather than claiming the fork is current", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(AsyncResult.isFailure(await checkUpstream())).toBe(true);
  });

  it("finds a subsequent nightly on refresh and does not hide a later failure", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([nightly]));
    const registry = AtomRegistry.make();
    const unmount = registry.mount(upstreamNightlyAtom);
    try {
      await vi.waitFor(() =>
        expect(AsyncResult.getOrElse(registry.get(upstreamNightlyAtom), () => null)).toMatchObject({
          version: "0.0.46-nightly.20261014.3132",
        }),
      );

      fetchMock.mockResolvedValueOnce(
        Response.json([{ ...nightly, tag_name: "v0.0.46-nightly.20261015.3140" }]),
      );
      registry.refresh(upstreamNightlyAtom);
      await vi.waitFor(() =>
        expect(AsyncResult.getOrElse(registry.get(upstreamNightlyAtom), () => null)).toMatchObject({
          version: "0.0.46-nightly.20261015.3140",
        }),
      );

      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      registry.refresh(upstreamNightlyAtom);
      await vi.waitFor(() =>
        expect(AsyncResult.isFailure(registry.get(upstreamNightlyAtom))).toBe(true),
      );
    } finally {
      unmount();
      registry.dispose();
    }
  });
});
