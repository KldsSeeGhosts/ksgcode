import { describe, expect, it } from "@effect/vitest";

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
      customModels: ["glm-5.3", "kimi-k3"],
    });
  });
});
