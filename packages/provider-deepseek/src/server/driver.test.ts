import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { DeepSeekSettings } from "../settings.ts";
import { DEEPSEEK_PROFILE, deepseekRegistrySettings } from "./driver.ts";

const decodeSettings = Schema.decodeSync(DeepSeekSettings);

describe("DeepSeek Harness launch", () => {
  it("defaults to a disabled ACP profile without pinning a model or account", () => {
    const settings = deepseekRegistrySettings(decodeSettings({}));
    expect(settings).toMatchObject({
      source: "local",
      enabled: false,
      commandPath: "dsh",
      commandArgs: ["--profile", "acp"],
      customModels: [],
    });
  });

  it("preserves a custom binary, patch path, and opaque CPA model IDs", () => {
    const model = '["cpa","opencode-go/deepseek-v4.1-flash"]';
    const settings = deepseekRegistrySettings(
      decodeSettings({
        enabled: true,
        binaryPath: "C:\\Program Files\\DeepSeek\\dsh.cmd",
        launchArgs: '--patch "C:\\Agent Profiles\\cpa.yml"',
        customModels: [{ slug: model, name: "DeepSeek V4.1 Flash (CPA)" }],
      }),
    );
    expect(settings).toMatchObject({
      enabled: true,
      commandPath: "C:\\Program Files\\DeepSeek\\dsh.cmd",
      commandArgs: ["--profile", "acp", "--patch", "C:\\Agent Profiles\\cpa.yml"],
      customModels: [{ slug: model, name: "DeepSeek V4.1 Flash (CPA)" }],
    });
    expect(DEEPSEEK_PROFILE.presentation).toEqual({
      supportedRuntimeModes: ["approval-required", "auto-accept-edits", "auto", "full-access"],
      showInteractionModeToggle: false,
    });
  });

  it("applies the native bridge after user patches without replacing their model settings", () => {
    const settings = deepseekRegistrySettings(
      decodeSettings({ enabled: true, launchArgs: '--patch "C:\\Profiles\\cpa.yml"' }),
      "C:\\T3 Home\\tools\\deepseek\\native.yml",
    );
    expect(settings.commandArgs).toEqual([
      "--profile",
      "acp",
      "--patch",
      "C:\\Profiles\\cpa.yml",
      "--patch",
      "C:\\T3 Home\\tools\\deepseek\\native.yml",
    ]);
  });
});
