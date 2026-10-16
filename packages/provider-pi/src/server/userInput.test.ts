import { assert, describe, it } from "@effect/vitest";
import { piQuestionnaireSelect } from "./userInput.ts";

const question = {
  header: "New extension",
  question: "Which new extension did you mean?",
  options: [
    { label: "pi-fff", description: "Install the file finder." },
    { label: "Computer-use extension", description: "Check platform support." },
  ],
};
const title = `[${question.header}] ${question.question}`;
const values = [
  "1. pi-fff — Install the file finder.",
  "2. Computer-use extension — Check platform support.",
  "3. Type something.",
];
const params = { questions: [question] };

describe("Pi questionnaire presentation", () => {
  it("recovers short headings and separate descriptions without changing wire values", () => {
    assert.deepEqual(piQuestionnaireSelect("id", title, values, [params]), {
      id: "id",
      header: question.header,
      question: question.question,
      options: question.options.map((option, index) => ({ ...option, value: values[index] })),
    });
  });

  it("matches later questions and retains preview content", () => {
    const preview = "x".repeat(700);
    const next = {
      ...question,
      header: "",
      question: "Choose a preview",
      options: [{ label: "Preview", description: "See example", preview }],
    };
    const previewBlock = `--- 1. Preview preview ---\n${preview.slice(0, 600)}`;
    const result = piQuestionnaireSelect(
      "id",
      `${next.question}\n\n${previewBlock}`,
      ["1. Preview — See example", "2. Type something."],
      [{ questions: [question, next] }],
    );
    assert.equal(result?.header, "Select an option");
    assert.equal(result?.question, `${next.question}\n\n${previewBlock}`);
    assert.equal(result?.options.length, 1);
  });

  it("does not reinterpret unrelated, malformed, or multi-select dialogs", () => {
    for (const [dialogTitle, dialogValues, input] of [
      [title, values, {}],
      [title, values, { questions: [{ ...question, options: [null] }] }],
      [title, values, { questions: [{ ...question, multiSelect: true }] }],
      [title, [values[0]!, "Different option", values[2]!], params],
      ["Different title", values, params],
      [title, values.slice(0, 2), params],
    ] as const) {
      assert.isUndefined(piQuestionnaireSelect("id", dialogTitle, dialogValues, [input]));
    }
  });

  it("preserves a localized custom-answer sentinel as an exact selectable value", () => {
    const result = piQuestionnaireSelect(
      "id",
      title,
      [...values.slice(0, 2), "3. Escribe algo."],
      [params],
    );
    assert.deepEqual(result?.options[2], {
      label: "3. Escribe algo.",
      description: "",
      value: "3. Escribe algo.",
    });
  });
});
