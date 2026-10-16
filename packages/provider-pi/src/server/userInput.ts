import type { OrchestrationV2UserInputQuestion } from "@t3tools/contracts";
import { piRecordField, piRecordString } from "./rpc.ts";

/**
 * RPIV's RPC fallback flattens its questionnaire into select strings. Recover
 * presentation only when both the title and every option match the active tool
 * input. Values must remain the original strings for the extension's decoder.
 */
export function piQuestionnaireSelect(
  id: string,
  title: string,
  values: readonly string[],
  questionnaires: Iterable<unknown>,
): OrchestrationV2UserInputQuestion | undefined {
  for (const params of questionnaires) {
    const questions = piRecordField(params, "questions");
    if (!Array.isArray(questions)) continue;
    for (const question of questions) {
      if (piRecordField(question, "multiSelect") === true) continue;
      const text = piRecordString(question, "question");
      const header = piRecordString(question, "header") ?? "";
      const options = piRecordField(question, "options");
      if (text === undefined || !Array.isArray(options) || options.length === 0) continue;
      const previews: string[] = [];
      const choices: OrchestrationV2UserInputQuestion["options"][number][] = [];
      for (const [index, option] of options.entries()) {
        const label = piRecordString(option, "label");
        const description = piRecordString(option, "description");
        if (label === undefined || description === undefined) break;
        const value = `${index + 1}. ${label} — ${description}`;
        if (values[index] !== value) break;
        choices.push({ label, description, value });
        const preview = piRecordString(option, "preview");
        if (preview) {
          previews.push(`--- ${index + 1}. ${label} preview ---\n${preview.slice(0, 600)}`);
        }
      }
      const expectedTitle =
        `${header ? `[${header}] ` : ""}${text}` +
        (previews.length > 0 ? `\n\n${previews.join("\n\n")}` : "");
      if (
        choices.length !== options.length ||
        title !== expectedTitle ||
        values.length !== choices.length + 1
      ) {
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
