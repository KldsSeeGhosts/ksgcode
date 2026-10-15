import type { AcpAgentProfile } from "@t3tools/provider-acp-registry/server";

type OmpElicitationMapper = NonNullable<
  NonNullable<AcpAgentProfile["flavor"]>["mapElicitationForm"]
>;

/**
 * OMP askDialog encodes each question as qN plus a qN__other text field.
 * T3 already has a custom-answer input, so present one question and route a
 * custom response back to the companion field OMP expects.
 */
export const mapOmpElicitationForm: OmpElicitationMapper = (request, form) => {
  const byId = new Map(form.questions.map((question) => [question.id, question]));
  const companions = new Map<string, string>();
  for (const question of form.questions) {
    if (!/^q\d+$/.test(question.id) || question.options.length === 0) continue;
    const otherId = `${question.id}__other`;
    if (
      byId.get(otherId)?.options.length === 0 &&
      request.requestedSchema.properties?.[otherId]?.type === "string"
    ) {
      companions.set(question.id, otherId);
    }
  }
  if (companions.size === 0) return form;
  const otherIds = new Set(companions.values());
  return {
    questions: form.questions
      .filter((question) => !otherIds.has(question.id))
      .map((question) =>
        companions.has(question.id)
          ? {
              ...question,
              // OMP puts the question in title and its short header in description.
              header:
                question.question === question.header
                  ? `Question ${Number(question.id.slice(1)) + 1}`
                  : question.question,
              question: question.header,
              allowCustomAnswer: true,
            }
          : question,
      ),
    content: (answers) => {
      const routed = { ...answers };
      for (const [id, otherId] of companions) {
        const answer = answers[id];
        const scalar = Array.isArray(answer) && answer.length === 1 ? answer[0] : answer;
        const question = byId.get(id)!;
        const selected = question.options.some(
          (option) => (option.value ?? option.label) === scalar,
        );
        if (typeof scalar === "string" && !selected) {
          routed[otherId] = scalar;
          delete routed[id];
        } else if (answer !== undefined) {
          delete routed[otherId];
        }
      }
      return form.content(routed);
    },
  };
};
