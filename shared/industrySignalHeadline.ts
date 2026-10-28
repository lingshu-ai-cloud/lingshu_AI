/** Reuse a verified Chinese fact rather than asking the model to invent another headline. */
export function industrySignalHeadline(fact: string, originalTitle: string): string {
  const chinese = /\p{Script=Han}/u;
  const verified = fact.trim().split(/[。！？\n]/u)[0]?.trim() ?? '';
  if (chinese.test(verified)) return verified.length > 80 ? `${verified.slice(0, 80)}…` : verified;
  return chinese.test(originalTitle) ? originalTitle : '已核验行业动态';
}
