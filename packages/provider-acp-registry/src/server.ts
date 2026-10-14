/**
 * ACP Registry's server entry: the driver and adapter driver the server
 * registers, the factories dedicated ACP agent drivers build on, the catalog
 * layer it provides once, and the managed-binary directories the terminal
 * manager keeps off agent PATHs.
 *
 * The catalog and runtime coordinator are services; import them from
 * `./server/AcpRegistrySupport` and `./server/AcpRegistryRuntimeCoordinator`.
 *
 * @module provider-acp-registry/server
 */
export {
  AcpRegistryDriver,
  makeAcpAgentDriver,
  type AcpRegistryDriverEnv,
} from "./server/driver.ts";
export {
  AcpRegistryAdapterV2Driver,
  makeAcpAgentAdapterV2Driver,
  type AcpAgentDriverDefinition,
  type AcpRegistryAdapterV2DriverEnv,
} from "./server/adapter.ts";
export { localAcpAgentRegistrySettings, type AcpAgentProfile } from "./server/agentProfile.ts";
export { acpRegistryManagedBinaryDirectories } from "./server/AcpRegistrySupport.ts";
