const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
/** Publication is the fallback. A distinct event day needs an explicit original date, never model arithmetic. */
export function companyEventDateEvidence(date: string, source: { publishedAt: string; excerpt: string }): string | undefined {
  if (!validDate(date) || !validDate(source.publishedAt)) return undefined;
  if (date === source.publishedAt) return '';
  const normalized = source.excerpt.normalize('NFKC');
  for (const match of normalized.matchAll(/(20\d{2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{1,2})/gu)) {
    if (`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` === date) return match[0];
  }
  for (const match of normalized.matchAll(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/gu)) {
    if (!match[1] && /(?:去年|前年|明年|次年|上年|翌年|上一年|两年前)\s*$/u.test(normalized.slice(Math.max(0, match.index! - 8), match.index))) continue;
    const year = match[1] ?? source.publishedAt.slice(0, 4);
    if (`${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` === date) return match[0];
  }
  return undefined;
}

export function companyEventDateSupported(date: string, source: { publishedAt: string; excerpt: string }): boolean {
  return companyEventDateEvidence(date, source) !== undefined;
}
