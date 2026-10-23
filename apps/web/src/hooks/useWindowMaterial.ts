import { useSyncExternalStore } from "react";
import type { WindowMaterial } from "@t3tools/contracts/settings";

// The initial read is synchronous IPC; render snapshots must not repeat that round trip.
let nativeMaterialSnapshot: WindowMaterial | null = null;

function readNativeMaterial(): WindowMaterial {
  nativeMaterialSnapshot ??= window.desktopBridge?.getWindowMaterial?.() ?? "solid";
  return nativeMaterialSnapshot;
}

function subscribeNativeMaterial(onChange: () => void): () => void {
  const bridge = window.desktopBridge;
  const unsubscribe = bridge?.onWindowMaterialChange?.((material) => {
    nativeMaterialSnapshot = material;
    onChange();
  });
  nativeMaterialSnapshot = bridge?.getWindowMaterial?.() ?? "solid";
  return () => {
    unsubscribe?.();
    nativeMaterialSnapshot = null;
  };
}

function readReducedTransparency(): boolean {
  return (
    window.matchMedia("(prefers-reduced-transparency: reduce)").matches ||
    window.matchMedia("(forced-colors: active)").matches
  );
}

function subscribeReducedTransparency(onChange: () => void): () => void {
  const transparency = window.matchMedia("(prefers-reduced-transparency: reduce)");
  const forcedColors = window.matchMedia("(forced-colors: active)");
  transparency.addEventListener("change", onChange);
  forcedColors.addEventListener("change", onChange);
  return () => {
    transparency.removeEventListener("change", onChange);
    forcedColors.removeEventListener("change", onChange);
  };
}

export function useWindowMaterial() {
  return {
    nativeMaterial: useSyncExternalStore(subscribeNativeMaterial, readNativeMaterial),
    reducedTransparency: useSyncExternalStore(
      subscribeReducedTransparency,
      readReducedTransparency,
    ),
  };
}
