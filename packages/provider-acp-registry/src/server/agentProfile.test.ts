import { describe, expect, it } from "@effect/vitest";
import { createModelCapabilities } from "@t3tools/shared/model";

import { localAcpAgentRegistrySettings } from "./agentProfile.ts";

describe("localAcpAgentRegistrySettings", () => {
  it("runs the agent binary with its fixed arguments before the user's launch arguments", () => {
    const settings = localAcpAgentRegistrySettings({
      enabled: true,
      binaryPath: "/opt/hermes/bin/hermes",
      commandArgs: ["acp"],
      launchArgs: `--profile "work tree" --accept-hooks`,
      customModels: ["glm-5.3", { slug: "glm-5.3" }, { slug: "kimi-k3", name: "Kimi" }],
    });

    expect(settings).toMatchObject({
      source: "local",
      agentId: "",
      enabled: true,
      commandPath: "/opt/hermes/bin/hermes",
      commandArgs: ["acp", "--profile", "work tree", "--accept-hooks"],
      customModels: ["glm-5.3", { slug: "kimi-k3", name: "Kimi" }],
    });
  });

  it("preserves custom reasoning options for dedicated ACP providers", () => {
    const capabilities = createModelCapabilities({
      optionDescriptors: [
        {
          id: "reasoning_effort",
          label: "Reasoning",
          type: "select",
          options: [{ id: "max", label: "Max" }],
        },
      ],
    });
    const model = { slug: "custom/model", name: "Custom model", capabilities };
    const settings = localAcpAgentRegistrySettings({
      enabled: true,
      binaryPath: "hermes",
      commandArgs: ["acp"],
      launchArgs: "",
      customModels: [model],
    });

    expect(settings.customModels).toEqual([model]);
  });
});
