import type { ClientSettings, WindowMaterial } from "@t3tools/contracts";

export function supportsWindowMaterial(platform: NodeJS.Platform, release: string): boolean {
  if (platform === "darwin") return true;
  if (platform !== "win32") return false;
  const [major, , build] = release.split(".").map(Number);
  return major !== undefined && (major > 10 || (major === 10 && (build ?? 0) >= 22621));
}

export function resolveWindowMaterial(
  settings: Pick<ClientSettings, "windowMaterial" | "glassOpacity">,
  platform: NodeJS.Platform,
  release: string,
  shouldUseOpaqueBackgrounds: boolean,
): WindowMaterial {
  return shouldUseOpaqueBackgrounds ||
    settings.glassOpacity === 100 ||
    !supportsWindowMaterial(platform, release)
    ? "solid"
    : settings.windowMaterial;
}
