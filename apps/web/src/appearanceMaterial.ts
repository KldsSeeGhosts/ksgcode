import type { WindowMaterial } from "@t3tools/contracts/settings";

export function resolveAppearanceMaterial(input: {
  material: WindowMaterial;
  opacity: number;
  reducedTransparency: boolean;
  supportsBackdropFilter: boolean;
  desktop: boolean;
  nativeMaterial: WindowMaterial;
}) {
  const opacity = input.reducedTransparency ? 100 : input.opacity;
  const material =
    opacity === 100 ||
    !input.supportsBackdropFilter ||
    (input.desktop && input.nativeMaterial === "solid")
      ? "solid"
      : input.material;
  const liquid = material === "liquid";
  const glass = material !== "solid";
  return {
    material,
    native: input.desktop && glass,
    opacity,
    glassOpacity: liquid ? Math.max(50, 100 - (100 - opacity) * 1.4) : opacity,
    chromeOpacity: glass
      ? Math.max(liquid ? 24 : 42, 100 - (100 - opacity) * (liquid ? 3.3 : 2.5))
      : 100,
    readingOpacity: glass ? Math.max(82, 100 - (100 - opacity) * (liquid ? 0.8 : 0.4)) : 100,
    blur: opacity === 100 ? "0px" : liquid ? "28px" : glass ? "20px" : null,
    saturation: liquid ? "1.6" : glass ? "1.2" : null,
  };
}

export function applyAppearanceMaterial(
  root: HTMLElement,
  input: Parameters<typeof resolveAppearanceMaterial>[0],
): void {
  const appearance = resolveAppearanceMaterial(input);
  if (appearance.material === "solid") delete root.dataset.windowMaterial;
  else root.dataset.windowMaterial = appearance.material;
  if (appearance.native) root.dataset.nativeWindowMaterial = "true";
  else delete root.dataset.nativeWindowMaterial;
  root.style.setProperty("--glass-opacity", `${appearance.glassOpacity}%`);
  root.style.setProperty("--window-chrome-opacity", `${appearance.chromeOpacity}%`);
  root.style.setProperty("--window-reading-opacity", `${appearance.readingOpacity}%`);
  const filterProperties = [
    ["--glass-blur", appearance.blur],
    ["--glass-saturation", appearance.saturation],
  ] as const;
  for (const [property, value] of filterProperties) {
    if (value === null) root.style.removeProperty(property);
    else root.style.setProperty(property, value);
  }
}
