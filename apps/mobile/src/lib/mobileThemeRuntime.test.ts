import { describe, expect, it } from "vite-plus/test";

import {
  createMobileThemeRuntimeOperations,
  type MobileThemeRuntimeState,
} from "./mobileThemeRuntime";

const initialState: MobileThemeRuntimeState = {
  baseFontSize: 16,
  themeAppearance: "light",
  themeMode: "system",
};

describe("mobileThemeRuntime", () => {
  it("hydrates text variables and clears the native appearance override", () => {
    const operations = createMobileThemeRuntimeOperations(null, initialState);
    const variableOperations = operations.filter(
      (operation) => operation.kind === "update-text-variables",
    );

    expect(variableOperations).toHaveLength(16);
    expect(variableOperations.at(-1)?.themeName).toBe("cursor-dark");
    expect(operations.at(-1)).toEqual({
      kind: "set-appearance-mode",
      appearance: "light",
      themeMode: "system",
    });
  });

  it("lets system appearance changes flow through the root ScopedTheme only", () => {
    const operations = createMobileThemeRuntimeOperations(initialState, {
      ...initialState,
      themeAppearance: "dark",
    });

    expect(operations).toEqual([]);
  });

  it("updates text variables for every theme without switching palettes", () => {
    const operations = createMobileThemeRuntimeOperations(initialState, {
      ...initialState,
      baseFontSize: 18,
    });

    expect(operations).toHaveLength(16);
    expect(operations.every((operation) => operation.kind === "update-text-variables")).toBe(true);
    expect(operations.at(-1)).toMatchObject({
      kind: "update-text-variables",
      themeName: "cursor-dark",
    });
  });
});
