import { describe, expect, it } from "vite-plus/test";

import { MacosWindowBlurError, parseMacosWindowNumber } from "./MacosWindowBlur.ts";

describe("parseMacosWindowNumber", () => {
  it("reads the WindowServer window number from an Electron media source id", () => {
    expect(parseMacosWindowNumber("window:16676:0")).toBe(16676);
  });

  it("rejects ids that do not name a window", () => {
    for (const id of ["screen:1:0", "window::0", "window:0:0", ""]) {
      expect(() => parseMacosWindowNumber(id)).toThrow(MacosWindowBlurError);
    }
  });
});
