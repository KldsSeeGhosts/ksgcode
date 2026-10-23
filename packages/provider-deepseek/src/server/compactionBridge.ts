import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { DEEPSEEK_COMPACTION_BRIDGE_SOURCE } from "./compactionBridgeSource.ts";

const quotePath = Schema.encodeSync(Schema.fromJsonString(Schema.String));

export const materializeDeepSeekCompactionBridge = Effect.fn(
  "DeepSeekCompactionBridge.materialize",
)(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(directory, { recursive: true });
  const pluginPath = path.join(directory, "native-compaction-v1.mjs");
  const patchPath = path.join(directory, "native-compaction-v1.yml");
  // A patch's name is a guard, not a rename. Retain the configured ACP row as the
  // source of model settings while replacing its transport with our wrapper.
  const patch = `- id: acp
  disabled: true
- insert:
    - id: ksg-deepseek-acp
      name: ${quotePath(pluginPath.replaceAll("\\", "/"))}
      inject: [acpAppStartup]
      config: !!js "Array.from(ctx.loader.entries()).find(entry => entry.options.id === 'acp').options.config"
`;
  for (const [file, source] of [
    [pluginPath, DEEPSEEK_COMPACTION_BRIDGE_SOURCE],
    [patchPath, patch],
  ] as const) {
    const existing = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
    if (existing !== source) {
      yield* writeFileStringAtomically({ filePath: file, contents: source });
    }
  }
  return patchPath;
});
