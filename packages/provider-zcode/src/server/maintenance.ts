import { ProviderDriverKind } from "@t3tools/contracts";
import { makePackageManagedProviderMaintenanceResolver } from "@t3tools/provider-core/server/maintenanceResolver";

// This owns only the ACP bridge. The ZCode desktop app updates itself.
export const zcodeMaintenance = makePackageManagedProviderMaintenanceResolver({
  provider: ProviderDriverKind.make("zcode"),
  npmPackageName: "zcode-acp-server",
  nativeUpdate: null,
});
