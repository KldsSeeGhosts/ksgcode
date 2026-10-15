import { describe, expect, it } from "@effect/vitest";

import { ompApprovalArgs } from "./approvalMode.ts";

describe("OMP launch-time approval policy", () => {
  it.each([
    ["approval-required", "always-ask"],
    ["auto-accept-edits", "write"],
    ["auto", "always-ask"],
    ["full-access", "yolo"],
  ] as const)("selects %s without inheriting local OMP configuration", (mode, expected) => {
    expect(ompApprovalArgs(["acp", "--config", "/tmp/work config.yml"], mode)).toEqual([
      "acp",
      "--config",
      "/tmp/work config.yml",
      `--approval-mode=${expected}`,
    ]);
  });

  it("does not let conflicting launch flags override Supervised", () => {
    expect(
      ompApprovalArgs(
        [
          "acp",
          "--auto-approve",
          "--auto-approve=true",
          "--yolo",
          "--yolo=true",
          "--approval-mode=yolo",
          "--approval-mode",
          "write",
          "--config",
          "/tmp/work.yml",
        ],
        "approval-required",
      ),
    ).toEqual(["acp", "--config", "/tmp/work.yml", "--approval-mode=always-ask"]);
  });

  it("does not retain a restrictive launch mode after switching to Full access", () => {
    expect(ompApprovalArgs(["acp", "--approval-mode", "always-ask"], "full-access")).toEqual([
      "acp",
      "--approval-mode=yolo",
    ]);
  });

  it("preserves unrelated flags after an incomplete approval-mode override", () => {
    expect(
      ompApprovalArgs(["acp", "--approval-mode", "--config", "/tmp/work.yml"], "approval-required"),
    ).toEqual(["acp", "--config", "/tmp/work.yml", "--approval-mode=always-ask"]);
  });

  it("sets policy before the option separator and preserves literal positional arguments", () => {
    expect(
      ompApprovalArgs(
        ["acp", "--yolo", "--", "--yolo", "--approval-mode=write"],
        "approval-required",
      ),
    ).toEqual(["acp", "--approval-mode=always-ask", "--", "--yolo", "--approval-mode=write"]);
  });
});
