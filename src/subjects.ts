export const QUESTION_SUBJECTS = ["all", "biology", "physics", "history", "geography", "psychology", "physiology", "chemistry", "astronomy", "literature", "economics"] as const;
export type QuestionSubject = typeof QUESTION_SUBJECTS[number];
export type QuestionCandidate = { id: string; tier: number; trait_tag: string };

export function parseQuestionSubject(value: unknown): QuestionSubject | null {
  return typeof value === "string" && (QUESTION_SUBJECTS as readonly string[]).includes(value) ? value as QuestionSubject : null;
}

export function pickQuestion<T extends QuestionCandidate>(questions: readonly T[], tier: number, subject: QuestionSubject, seen: ReadonlySet<string>, random: () => number = Math.random): T | null {
  const available = questions.filter(question => !seen.has(question.id) && (subject === "all" || question.trait_tag === subject));
  if (available.length === 0) return null;
  const preferred = available.filter(question => question.tier === tier);
  const pool = preferred.length > 0 ? preferred : available;
  const index = Math.min(pool.length - 1, Math.floor(Math.max(0, random()) * pool.length));
  return pool[index] ?? null;
}
