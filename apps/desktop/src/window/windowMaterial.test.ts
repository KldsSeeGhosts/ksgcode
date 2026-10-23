import { describe, expect, it } from "vite-plus/test";

import { resolveWindowMaterial, supportsWindowMaterial } from "./windowMaterial.ts";

describe("native window materials", () => {
  it("supports macOS and only Windows versions with native backdrop support", () => {
    expect(supportsWindowMaterial("darwin", "25.0.0")).toBe(true);
    expect(supportsWindowMaterial("win32", "10.0.22621")).toBe(true);
    expect(supportsWindowMaterial("win32", "10.0.26100")).toBe(true);
    expect(supportsWindowMaterial("win32", "10.0.22000")).toBe(false);
    expect(supportsWindowMaterial("win32", "10.0.19045")).toBe(false);
    expect(supportsWindowMaterial("win32", "unknown")).toBe(false);
    expect(supportsWindowMaterial("linux", "6.12.0")).toBe(false);
  });

  it("restores solid materials for accessibility, full opacity, and unsupported hosts", () => {
    const settings = { windowMaterial: "liquid", glassOpacity: 80 } as const;
    expect(resolveWindowMaterial(settings, "darwin", "25.0.0", false)).toBe("liquid");
    expect(resolveWindowMaterial(settings, "darwin", "25.0.0", true)).toBe("solid");
    expect(
      resolveWindowMaterial({ ...settings, glassOpacity: 100 }, "darwin", "25.0.0", false),
    ).toBe("solid");
    expect(resolveWindowMaterial(settings, "win32", "10.0.19045", false)).toBe("solid");
    expect(resolveWindowMaterial(settings, "linux", "6.12.0", false)).toBe("solid");
    expect(
      resolveWindowMaterial({ ...settings, windowMaterial: "solid" }, "darwin", "25.0.0", false),
    ).toBe("solid");
  });
});
