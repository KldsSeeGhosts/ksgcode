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
  // One theme tint covers the whole window. Every pane shares it so the
  // wallpaper reads as one smoked sheet instead of a patchwork of densities.
  const shellOpacity = !glass
    ? 100
    : liquid
      ? Math.max(36, opacity - 14)
      : Math.max(48, opacity - 10);
  return {
    material,
    native: input.desktop && glass,
    opacity,
    glassOpacity: liquid ? Math.max(50, 100 - (100 - opacity) * 1.4) : opacity,
    shellOpacity,
    // Light glass needs more cover for dark text to stay crisp over busy wallpaper.
    lightShellOpacity: Math.min(glass ? 96 : 100, shellOpacity + 10),
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
  root.style.setProperty("--window-shell-opacity", `${appearance.shellOpacity}%`);
  root.style.setProperty("--window-shell-opacity-light", `${appearance.lightShellOpacity}%`);
  const filterProperties = [
    ["--glass-blur", appearance.blur],
    ["--glass-saturation", appearance.saturation],
  ] as const;
  for (const [property, value] of filterProperties) {
    if (value === null) root.style.removeProperty(property);
    else root.style.setProperty(property, value);
  }
}
