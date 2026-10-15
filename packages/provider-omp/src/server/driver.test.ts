import { describe, expect, it } from "@effect/vitest";

import { OMP_PROFILE } from "./driver.ts";

describe("OMP command output", () => {
  it.each(["agent_message_chunk", "agent_thought_chunk"] as const)(
    "removes terminal formatting from %s without changing message identity",
    (sessionUpdate) => {
      const notification = {
        sessionId: "omp-session",
        update: {
          sessionUpdate,
          content: {
            type: "text" as const,
            text: "\u001b[38;2;107;114;128mContext\u001b[0m\n\u001b[32m██\u001b[0m 25%",
          },
          messageId: "omp-command-output",
          _meta: { source: "command" },
        },
      };
      expect(OMP_PROFILE.flavor.normalizeSessionUpdate(notification)).toEqual({
        ...notification,
        update: {
          ...notification.update,
          content: { type: "text", text: "Context\n██ 25%" },
        },
      });
      expect(notification.update.content.text).toContain("\u001b[");
    },
  );

  it("keeps link text and markdown when removing OSC hyperlinks", () => {
    const notification = {
      sessionId: "omp-session",
      update: {
        sessionUpdate: "agent_message_chunk" as const,
        content: {
          type: "text" as const,
          text: "**Docs:** \u001b]8;;https://example.test\u0007Read more\u001b]8;;\u0007",
        },
      },
    };
    const result = OMP_PROFILE.flavor.normalizeSessionUpdate(notification);
    expect(result.update).toMatchObject({
      content: { type: "text", text: "**Docs:** Read more" },
    });
  });

  it("does not rewrite tool output or non-text content", () => {
    const tool = {
      sessionId: "omp-session",
      update: {
        sessionUpdate: "tool_call_update" as const,
        toolCallId: "tool-1",
        rawOutput: "\u001b[31mraw terminal output\u001b[0m",
      },
    };
    const image = {
      sessionId: "omp-session",
      update: {
        sessionUpdate: "agent_message_chunk" as const,
        content: { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" },
      },
    };
    expect(OMP_PROFILE.flavor.normalizeSessionUpdate(tool)).toBe(tool);
    expect(OMP_PROFILE.flavor.normalizeSessionUpdate(image)).toBe(image);
  });

  it("preserves ordinary markdown and literal escape notation", () => {
    const notification = {
      sessionId: "omp-session",
      update: {
        sessionUpdate: "agent_message_chunk" as const,
        content: { type: "text" as const, text: "Use `\\x1b[31m` for red, not [31m." },
      },
    };
    expect(OMP_PROFILE.flavor.normalizeSessionUpdate(notification)).toBe(notification);
  });
});
