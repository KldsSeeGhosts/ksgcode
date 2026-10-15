import { describe, expect, it } from "@effect/vitest";

import { makeAcpElicitationForm, type AcpFormElicitation } from "./elicitation.ts";

function form(properties: NonNullable<AcpFormElicitation["requestedSchema"]["properties"]>) {
  return makeAcpElicitationForm({
    sessionId: "session-1",
    mode: "form",
    message: "Answer these questions",
    requestedSchema: { type: "object", properties },
  });
}

describe("ACP question form conversion", () => {
  it("does not repeat the overall prompt for every untitled-description field", () => {
    const result = form({
      branch: { type: "string", title: "Which branch?" },
      scope: { type: "string", title: "Which scope?" },
    });
    expect(result.questions.map((question) => question.question)).toEqual([
      "Which branch?",
      "Which scope?",
    ]);
  });

  it("preserves genuinely separate fields with identical question text", () => {
    const result = form({
      first: { type: "string", title: "Which scope?" },
      second: { type: "string", title: "Which scope?" },
      first__other: { type: "string", title: "Other (specify)" },
    });
    expect(result.questions.map((question) => question.id)).toEqual([
      "first",
      "second",
      "first__other",
    ]);
  });

  it("keeps a single confirmation's message and field explanation", () => {
    const result = makeAcpElicitationForm({
      requestId: "confirmation",
      mode: "form",
      message: "Allow changing files outside the workspace?",
      requestedSchema: {
        type: "object",
        properties: {
          approved: {
            type: "boolean",
            title: "Approved",
            description: "This affects /opt/project",
          },
        },
        required: ["approved"],
      },
    });
    expect(result.questions[0]).toMatchObject({
      question: "Allow changing files outside the workspace?\n\nThis affects /opt/project",
      required: true,
      allowCustomAnswer: false,
    });
    expect(result.content({ approved: ["false"] })).toEqual({ approved: false });
  });

  it("preserves choice labels, wire values, descriptions, and multi-select behavior", () => {
    const result = form({
      single: {
        type: "string",
        oneOf: [{ const: "workspace", title: "Workspace", description: "Current project" }],
      },
      multiple: {
        type: "array",
        items: { anyOf: [{ const: "api", title: "API", description: "Server" }] },
      },
      plain: { type: "array", items: { type: "string", enum: ["first", "second"] } },
    });
    expect(result.questions[0]?.options).toEqual([
      { label: "Workspace", value: "workspace", description: "Current project" },
    ]);
    expect(result.questions[1]).toMatchObject({
      multiSelect: true,
      allowCustomAnswer: false,
      options: [{ label: "API", value: "api", description: "Server" }],
    });
    expect(result.questions[2]?.options.map((option) => option.value)).toEqual(["first", "second"]);
    expect(
      result.content({ single: ["workspace"], multiple: ["api"], plain: ["first", "second"] }),
    ).toEqual({ single: "workspace", multiple: ["api"], plain: ["first", "second"] });
  });

  it("converts scalar client answers to the declared ACP types", () => {
    const result = form({
      approved: { type: "boolean" },
      quantity: { type: "integer" },
      ratio: { type: "number" },
      target: { type: "string", enum: ["workspace"] },
    });
    expect(
      result.content({ approved: "true", quantity: ["3"], ratio: "0.25", target: ["workspace"] }),
    ).toEqual({ approved: true, quantity: 3, ratio: 0.25, target: "workspace" });
    expect(result.content({ approved: false, quantity: 0, ratio: 2.5 })).toEqual({
      approved: false,
      quantity: 0,
      ratio: 2.5,
    });
  });

  it("does not fabricate scalar answers from invalid or multiple values", () => {
    const result = form({
      approved: { type: "boolean" },
      quantity: { type: "integer" },
      ratio: { type: "number" },
      target: { type: "string" },
    });
    expect(
      result.content({ approved: "maybe", quantity: "1.5", ratio: "Infinity", target: ["a", "b"] }),
    ).toEqual({});
  });

  it("preserves blank and whitespace-sensitive text while dropping undeclared answers", () => {
    const result = form({
      text: { type: "string", default: "  initial\n" },
      empty: { type: "string" },
    });
    expect(result.questions[0]).toMatchObject({
      allowCustomAnswer: true,
      initialAnswer: "  initial\n",
    });
    expect(
      result.content({ text: "  result\n", empty: "", unexpected: "not part of the form" }),
    ).toEqual({
      text: "  result\n",
      empty: "",
    });
  });
});
