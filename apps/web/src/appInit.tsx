import type { ClientSettings } from "@t3tools/contracts/settings";
import { createBrowserHistory, createHashHistory } from "@tanstack/react-router";

import { applyAppearanceContrast } from "./appearanceContrast";
import { applyAppearanceFontVariables } from "./appearanceFonts";
import { applyAppearanceMaterial } from "./appearanceMaterial";
import { APP_BASE_NAME, APP_DISPLAY_NAME, APP_STAGE_LABEL } from "./branding";
import { resolveServerBackedAppDisplayName } from "./branding.logic";
import { isElectron } from "./env";
import { getClientSettings, subscribeClientSettings } from "./hooks/useSettings";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { prepareProviderAuthDelivery } from "./providerAuthDelivery";
import { getRouter, type AppRouter } from "./router";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { primaryServerConfigAtom } from "./state/server";

/** Writes appearance settings onto the document, touching only the groups that changed. */
function startClientAppearance(): void {
  const root = document.documentElement;
  let applied: ClientSettings | null = null;

  // The desktop shell owns the native material; the OS or browser owns reduced transparency.
  let nativeMaterial = window.desktopBridge?.getWindowMaterial?.() ?? "solid";
  const reducedTransparency = [
    window.matchMedia("(prefers-reduced-transparency: reduce)"),
    window.matchMedia("(forced-colors: active)"),
  ];
  const applyMaterial = () => {
    const settings = getClientSettings();
    applyAppearanceMaterial(root, {
      material: settings.windowMaterial,
      opacity: settings.glassOpacity,
      reducedTransparency: reducedTransparency.some((query) => query.matches),
      supportsBackdropFilter: CSS.supports("backdrop-filter", "blur(1px)"),
      desktop: isElectron,
      nativeMaterial,
    });
  };
  for (const query of reducedTransparency) query.addEventListener("change", applyMaterial);
  window.desktopBridge?.onWindowMaterialChange?.((material) => {
    nativeMaterial = material;
    applyMaterial();
  });

  const apply = () => {
    const settings = getClientSettings();
    const previous = applied;
    applied = settings;
    if (previous?.diffColorScheme !== settings.diffColorScheme) {
      root.dataset.diffColorScheme = settings.diffColorScheme;
    }
    if (previous?.chatWidth !== settings.chatWidth) {
      root.dataset.chatWidth = settings.chatWidth;
    }
    if (previous?.redesignEnabled !== settings.redesignEnabled) {
      root.toggleAttribute("data-redesign", settings.redesignEnabled);
    }
    if (previous?.appearanceContrast !== settings.appearanceContrast) {
      applyAppearanceContrast(root, settings.appearanceContrast);
    }
    if (
      previous?.glassOpacity !== settings.glassOpacity ||
      previous.windowMaterial !== settings.windowMaterial
    ) {
      applyMaterial();
    }
    if (
      previous?.fontFamilySans !== settings.fontFamilySans ||
      previous.fontFamilyCode !== settings.fontFamilyCode ||
      previous.fontFamilyComposer !== settings.fontFamilyComposer ||
      previous.fontSizeInterface !== settings.fontSizeInterface ||
      previous.fontSizePrompt !== settings.fontSizePrompt ||
      previous.fontSizeCode !== settings.fontSizeCode ||
      previous.fontSmoothing !== settings.fontSmoothing
    ) {
      applyAppearanceFontVariables(root, {
        sans: settings.fontFamilySans,
        code: settings.fontFamilyCode,
        composer: settings.fontFamilyComposer,
        sizeInterface: settings.fontSizeInterface,
        sizePrompt: settings.fontSizePrompt,
        sizeCode: settings.fontSizeCode,
        smoothing: settings.fontSmoothing,
      });
    }
  };
  subscribeClientSettings(apply);
  apply();
}

function startDocumentTitle(): void {
  appAtomRegistry.subscribe(
    primaryServerConfigAtom,
    (config) => {
      document.title = resolveServerBackedAppDisplayName({
        baseName: APP_BASE_NAME,
        fallbackDisplayName: APP_DISPLAY_NAME,
        fallbackStageLabel: APP_STAGE_LABEL,
        primaryServerVersion: config?.environment.serverVersion ?? null,
      });
    },
    { immediate: true },
  );
}

/**
 * Starts every app-lifetime service once, before the first render, and returns the router.
 * They run for the life of the page, so their disposers are dropped here.
 */
export function startAppServices(): AppRouter {
  // Ahead of the history: the provider auth code must leave the address before anything reads it.
  prepareProviderAuthDelivery();

  // Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
  const router = getRouter(isElectron ? createHashHistory() : createBrowserHistory());

  if (isElectron) {
    syncDocumentElectronPlatformClasses(navigator.platform);
    syncDocumentWindowControlsOverlayClass();
  }

  startClientAppearance();
  startDocumentTitle();

  return router;
}
