import type { OrchestrationV2UserInputQuestion } from "@t3tools/contracts";
import { piRecordField, piRecordString } from "./rpc.ts";

/**
 * RPIV's RPC fallback flattens its questionnaire into select/input strings. Recover
 * presentation only when both the title and every option match the active tool
 * input. Select replies use the original strings; multi-select replies use numbers.
 */
export function piQuestionnaireQuestion(
  id: string,
  method: "select" | "input",
  title: string,
  values: readonly string[],
  questionnaires: Iterable<unknown>,
): OrchestrationV2UserInputQuestion | undefined {
  for (const params of questionnaires) {
    const questions = piRecordField(params, "questions");
    if (!Array.isArray(questions)) continue;
    for (const question of questions) {
      const multiSelect = piRecordField(question, "multiSelect") === true;
      if (multiSelect !== (method === "input")) continue;
      const text = piRecordString(question, "question");
      const header = piRecordString(question, "header") ?? "";
      const options = piRecordField(question, "options");
      if (text === undefined || !Array.isArray(options) || options.length === 0) continue;
      const previews: string[] = [];
      const lines: string[] = [];
      const choices: OrchestrationV2UserInputQuestion["options"][number][] = [];
      for (const [index, option] of options.entries()) {
        const label = piRecordString(option, "label");
        const description = piRecordString(option, "description");
        if (label === undefined || description === undefined) break;
        // oxlint-disable-next-line t3code/no-em-dash-copy -- Matches Pi's native option serialization, not product copy.
        const value = `${index + 1}. ${label} — ${description}`;
        if (!multiSelect && values[index] !== value) break;
        lines.push(value);
        choices.push({ label, description, value: multiSelect ? String(index + 1) : value });
        const preview = piRecordString(option, "preview");
        if (preview) {
          previews.push(`--- ${index + 1}. ${label} preview ---\n${preview.slice(0, 600)}`);
        }
      }
      if (choices.length !== options.length) continue;
      const heading = `${header ? `[${header}] ` : ""}${text}`;
      if (multiSelect) {
        const expectedTitle =
          `${heading}\n\n${lines.join("\n")}\n\n` +
          'Enter the numbers of all that apply, comma-separated (e.g. "1,3"). Add "; custom answer" to include your own text, or type only custom text.';
        if (title !== expectedTitle) continue;
        return {
          id,
          header: header || "Select options",
          question: text,
          multiSelect: true,
          options: choices,
        };
      }
      const expectedTitle = heading + (previews.length > 0 ? `\n\n${previews.join("\n\n")}` : "");
      if (title !== expectedTitle || values.length !== choices.length + 1) {
        continue;
      }
      // Keep localized/custom sentinel rows functional. The English RPIV row
      // is redundant because T3 already offers a free-text answer.
      const sentinel = values[choices.length]!;
      if (sentinel !== `${choices.length + 1}. Type something.`) {
        choices.push({ label: sentinel, description: "", value: sentinel });
      }
      return {
        id,
        header: header || "Select an option",
        question: text + (previews.length > 0 ? `\n\n${previews.join("\n\n")}` : ""),
        options: choices,
      };
    }
  }
  return undefined;
}
