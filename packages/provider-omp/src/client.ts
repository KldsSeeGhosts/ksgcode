/**
 * OMP's client definition: settings form, label, and glyph. Browser- and
 * React Native-safe.
 *
 * @module provider-omp/client
 */
import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { OmpSettings } from "./settings.ts";

export const ompClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("omp"),
  label: "OMP",
  settingsSchema: OmpSettings,
  // The pi mark from omp.sh, in the middle stop of its brand gradient.
  icon: {
    viewBox: "0 0 24 24",
    fill: { light: "#9B4DFF", dark: "#9B4DFF" },
    paths: [{ d: "M2.1 1H21.9V5.4H16.4V23H12V5.4H8.7V17.5H4.3V5.4H2.1Z" }],
  },
});
