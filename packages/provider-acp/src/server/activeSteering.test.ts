import { describe, expect, it } from "@effect/vitest";

import { supportsAcpActiveSteering } from "./activeSteering.ts";

describe("ACP steering negotiation", () => {
  it.each([
    undefined,
    null,
    {},
    { "t3code/steering": true },
    { "t3code/steering": { version: 1 } },
    { "t3code/steering": { version: 2, idempotent: true, holdsPrompt: true } },
    { "t3code/steering": { version: 1, idempotent: false, holdsPrompt: true } },
    { "t3code/steering": { version: 1, idempotent: true, holdsPrompt: false } },
  ])("keeps restart fallback for an unrecognized advertisement: %j", (meta) => {
    expect(supportsAcpActiveSteering(meta)).toBe(false);
  });

  it("requires identity-based admission and ownership until prompt completion", () => {
    expect(
      supportsAcpActiveSteering({
        "t3code/steering": { version: 1, idempotent: true, holdsPrompt: true },
      }),
    ).toBe(true);
  });
});
