import { assert, describe, it } from "@effect/vitest";
import { piQuestionnaireQuestion } from "./userInput.ts";

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
    assert.deepEqual(piQuestionnaireQuestion("id", "select", title, values, [params]), {
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
    const result = piQuestionnaireQuestion(
      "id",
      "select",
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
      assert.isUndefined(
        piQuestionnaireQuestion("id", "select", dialogTitle, dialogValues, [input]),
      );
    }
  });

  it("preserves a localized custom-answer sentinel as an exact selectable value", () => {
    const result = piQuestionnaireQuestion(
      "id",
      "select",
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

  it("recovers multi-select input dialogs only when the active question and option list match", () => {
    const multi = { ...question, multiSelect: true };
    const instructions =
      'Enter the numbers of all that apply, comma-separated (e.g. "1,3"). Add "; custom answer" to include your own text, or type only custom text.';
    const inputTitle = `${title}\n\n${values.slice(0, 2).join("\n")}\n\n${instructions}`;
    assert.deepEqual(
      piQuestionnaireQuestion("id", "input", inputTitle, [], [{ questions: [question, multi] }]),
      {
        id: "id",
        header: question.header,
        question: question.question,
        multiSelect: true,
        options: question.options.map((option, index) => ({
          ...option,
          value: String(index + 1),
        })),
      },
    );
    for (const [dialogTitle, input] of [
      [inputTitle, params],
      [inputTitle, {}],
      [inputTitle, { questions: [{ ...multi, options: [null] }] }],
      [inputTitle, { questions: [{ ...multi, options: [] }] }],
      [inputTitle.replace("1. pi-fff", "1. Different"), { questions: [multi] }],
      [inputTitle.replace(question.question, "Different question"), { questions: [multi] }],
      [inputTitle.replace(instructions, "Unrelated input"), { questions: [multi] }],
    ] as const) {
      assert.isUndefined(piQuestionnaireQuestion("id", "input", dialogTitle, [], [input]));
    }
  });
});
