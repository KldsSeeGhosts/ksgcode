import type {
  OrchestrationV2UserInputQuestion,
  ProviderUserInputAnswers,
} from "@t3tools/contracts";
import type * as AcpSchema from "effect-acp/compat";
import * as AcpWireSchema from "effect-acp/schema";
import * as Schema from "effect/Schema";

import { unknownRecord } from "./clientPolicy.ts";

export type AcpFormElicitation = Extract<AcpSchema.CreateElicitationRequest, { mode: "form" }>;

// The wire union also accepts future modes with opaque fields. Narrow the
// form payload by its schema, not merely by the presence of requestedSchema.
export const isAcpFormElicitation = Schema.is(
  Schema.Struct({
    mode: Schema.Literal("form"),
    message: Schema.String,
    requestedSchema: AcpWireSchema.ElicitationSchema,
  }),
);

export interface AcpElicitationForm {
  readonly questions: ReadonlyArray<OrchestrationV2UserInputQuestion>;
  readonly content: (
    answers: ProviderUserInputAnswers,
  ) => Record<string, AcpSchema.ElicitationContentValue>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function choices(property: Record<string, unknown>): OrchestrationV2UserInputQuestion["options"] {
  const source = property.type === "array" ? unknownRecord(property.items) : property;
  if (source === undefined) return [];
  if (Array.isArray(source.enum)) {
    return source.enum.flatMap((value) =>
      typeof value === "string"
        ? [{ label: text(value) ?? "(Empty)", value, description: text(value) ?? "(Empty)" }]
        : [],
    );
  }
  const titled = source.oneOf ?? source.anyOf;
  if (!Array.isArray(titled)) return [];
  return titled.flatMap((entry) => {
    const option = unknownRecord(entry);
    if (typeof option?.const !== "string") return [];
    const label = text(option.title) ?? text(option.const) ?? "(Empty)";
    return [{ label, value: option.const, description: text(option.description) ?? label }];
  });
}

function answerValue(
  property: Record<string, unknown>,
  answer: unknown,
): AcpSchema.ElicitationContentValue | undefined {
  if (property.type === "array") {
    if (Array.isArray(answer) && answer.every((entry) => typeof entry === "string")) return answer;
    return typeof answer === "string" ? [answer] : undefined;
  }
  // Some clients submit single selections as one-element arrays. ACP scalar
  // fields still need a scalar, particularly boolean confirmations and enums.
  const value = Array.isArray(answer) ? (answer.length === 1 ? answer[0] : undefined) : answer;
  switch (property.type) {
    case "string":
      return typeof value === "string" ? value : undefined;
    case "boolean":
      return value === true || value === "true"
        ? true
        : value === false || value === "false"
          ? false
          : undefined;
    case "number":
    case "integer": {
      const numeric =
        typeof value === "number"
          ? value
          : typeof value === "string" && value.trim().length > 0
            ? Number(value)
            : Number.NaN;
      return Number.isFinite(numeric) && (property.type !== "integer" || Number.isInteger(numeric))
        ? numeric
        : undefined;
    }
    default:
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? value
        : undefined;
  }
}

/** Projects ACP form fields and converts client answers back to their declared wire types. */
export function makeAcpElicitationForm(request: AcpFormElicitation): AcpElicitationForm {
  const properties = request.requestedSchema.properties ?? {};
  const fields = Object.entries(properties);
  const required = new Set(request.requestedSchema.required ?? []);
  return {
    questions: fields.map(([id, property], index) => {
      const record = unknownRecord(property) ?? {};
      const options =
        record.type === "boolean"
          ? [
              { label: "true", value: "true", description: "Yes" },
              { label: "false", value: "false", description: "No" },
            ]
          : choices(record);
      const title = text(record.title);
      const description = text(record.description);
      const message = text(request.message);
      // A one-field confirmation's message can carry the action being
      // authorized. Do not replace it with a generic title such as "Approved".
      const question =
        fields.length === 1 && message !== undefined
          ? [...new Set([message, description].filter((part) => part !== undefined))].join("\n\n")
          : (description ?? title ?? message ?? `Question ${index + 1}`);
      return {
        id,
        header: title ?? `Question ${index + 1}`,
        question,
        options,
        multiSelect: record.type === "array",
        allowCustomAnswer: options.length === 0,
        required: required.has(id),
        ...(typeof record.default === "string" && options.length === 0
          ? { initialAnswer: record.default }
          : {}),
      };
    }),
    content: (answers) => {
      const content: Record<string, AcpSchema.ElicitationContentValue> = {};
      for (const [id, property] of Object.entries(properties)) {
        if (!Object.hasOwn(answers, id)) continue;
        const value = answerValue(unknownRecord(property) ?? {}, answers[id]);
        if (value !== undefined) content[id] = value;
      }
      return content;
    },
  };
}
