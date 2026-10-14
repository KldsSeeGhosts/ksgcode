/**
 * ZCode's client definition: settings form, label, and glyph. Browser- and
 * React Native-safe.
 *
 * @module provider-zcode/client
 */
import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { ZcodeSettings } from "./settings.ts";

export const zcodeClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("zcode"),
  label: "ZCode",
  settingsSchema: ZcodeSettings,
  icon: {
    viewBox: "0 0 24 24",
    fill: { light: "#0F0F0F", dark: "#F5F5F5" },
    paths: [
      {
        d: "M1.55 2.65H12.55L10.61 5.4H1.55ZM14.2 2.65H23L9.8 21.35H1ZM13.39 18.6H22.45V21.35H11.45Z",
      },
    ],
  },
});
