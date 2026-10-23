import { describe, expect, it } from "vite-plus/test";
import { resolveAppearanceMaterial } from "./appearanceMaterial";

const defaults = {
  material: "liquid",
  opacity: 80,
  reducedTransparency: false,
  supportsBackdropFilter: true,
  desktop: true,
  nativeMaterial: "liquid",
  nativeMaterialTinted: false,
} as const;

describe("appearance material", () => {
  it("tints the whole window with one shell density, clearer for liquid than frosted", () => {
    const result = resolveAppearanceMaterial(defaults);
    expect(result.material).toBe("liquid");
    expect(result.native).toBe(true);
    expect(result.shellOpacity).toBe(66);
    expect(result.glassOpacity).toBe(72);
    expect(resolveAppearanceMaterial({ ...defaults, material: "frosted" }).shellOpacity).toBe(70);
    expect(resolveAppearanceMaterial({ ...defaults, opacity: 40 }).shellOpacity).toBe(36);
    expect(
      resolveAppearanceMaterial({ ...defaults, material: "frosted", opacity: 40 }).shellOpacity,
    ).toBe(48);
  });

  it("lightens the page tint where the OS material already frosts the backdrop", () => {
    const mac = resolveAppearanceMaterial({ ...defaults, nativeMaterialTinted: true });
    expect(mac.shellOpacity).toBe(46);
    expect(mac.lightShellOpacity).toBe(46);
    expect(resolveAppearanceMaterial(defaults).lightShellOpacity).toBe(76);
    expect(
      resolveAppearanceMaterial({ ...defaults, nativeMaterialTinted: true, desktop: false })
        .shellOpacity,
    ).toBe(66);
  });

  it("keeps existing glass behavior when the window material is solid", () => {
    expect(
      resolveAppearanceMaterial({ ...defaults, material: "solid", nativeMaterial: "solid" }),
    ).toMatchObject({
      material: "solid",
      native: false,
      glassOpacity: 80,
      blur: null,
      saturation: null,
    });
  });

  it("does not expose the desktop until the native shell confirms its material", () => {
    expect(resolveAppearanceMaterial({ ...defaults, nativeMaterial: "solid" })).toMatchObject({
      material: "solid",
      native: false,
    });
    expect(
      resolveAppearanceMaterial({ ...defaults, desktop: false, nativeMaterial: "solid" }),
    ).toMatchObject({ material: "liquid", native: false });
    expect(resolveAppearanceMaterial({ ...defaults, material: "frosted" })).toMatchObject({
      material: "frosted",
      native: true,
    });
  });

  it("makes every layer solid at full opacity or with reduced transparency", () => {
    for (const override of [{ opacity: 100 }, { reducedTransparency: true }]) {
      expect(resolveAppearanceMaterial({ ...defaults, ...override })).toMatchObject({
        material: "solid",
        native: false,
        glassOpacity: 100,
        shellOpacity: 100,
        blur: "0px",
      });
    }
    expect(resolveAppearanceMaterial({ ...defaults, supportsBackdropFilter: false })).toMatchObject(
      { material: "solid", native: false },
    );
  });
});
