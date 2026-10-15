import type { AcpAgentProfile } from "@t3tools/provider-acp-registry/server";

type ZcodeElicitationMapper = NonNullable<
  NonNullable<AcpAgentProfile["flavor"]>["mapElicitationForm"]
>;

/**
 * ZCode sends q_N choices and q_N_other free text for one logical question.
 * Present T3's single question/custom-answer control, then restore the native
 * fields. Multi-select custom entries are additive in ZCode, not overrides.
 */
export const mapZcodeElicitationForm: ZcodeElicitationMapper = (request, form) => {
  const byId = new Map(form.questions.map((question) => [question.id, question]));
  const companions = new Map<string, string>();
  for (const question of form.questions) {
    if (!/^q_\d+$/.test(question.id) || question.options.length === 0) continue;
    const otherId = `${question.id}_other`;
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
              header: `Question ${Number(question.id.slice(2)) + 1}`,
              question: question.header,
              allowCustomAnswer: true,
            }
          : question,
      ),
    content: (answers) => {
      const routed = { ...answers };
      for (const [id, otherId] of companions) {
        if (!Object.hasOwn(answers, id)) continue;
        const question = byId.get(id)!;
        const allowed = new Set(question.options.map((option) => option.value ?? option.label));
        const answer = answers[id];
        const values =
          typeof answer === "string"
            ? [answer]
            : Array.isArray(answer)
              ? answer.filter((value): value is string => typeof value === "string")
              : [];
        const picked = values.filter((value) => allowed.has(value));
        const custom = values.filter((value) => !allowed.has(value));
        delete routed[id];
        delete routed[otherId];
        if (question.multiSelect) {
          if (picked.length > 0) routed[id] = picked;
          if (custom.length > 0) routed[otherId] = custom.join(", ");
        } else if (custom.length > 0) {
          routed[otherId] = custom.join(", ");
        } else if (picked.length === 1) {
          routed[id] = picked[0];
        }
      }
      return form.content(routed);
    },
  };
};
