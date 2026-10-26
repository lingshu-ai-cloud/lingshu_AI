import { createHash } from 'node:crypto';
import type { GroundingSource, LLMCallOptions } from '../agents/llm.js';
import type { SearchOriginal } from './searchEvidenceAnswer.js';

type Answer = { text: string; sources: GroundingSource[] };
type Entry = { answer: Answer; originalHash: string; expires: number };
const entries = new Map<string, Entry>();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const originalHash = (originals: SearchOriginal[]) => digest(JSON.stringify(originals.map(original => ({
  uri: original.source.uri, text: original.text, published: original.published,
})).sort((a, b) => a.uri.localeCompare(b.uri))));

/** Exact public query/scope only; no private conversation or credentials are retained. */
export function newsSourceCacheKey(endpoint: string, question: string, opts: LLMCallOptions) {
  return digest(JSON.stringify([endpoint, question.trim(), opts.model ?? process.env.QWEN_TEXT_MODEL ?? 'qwen-plus',
    [...(opts.searchDomains ?? [])].sort(), opts.searchFreshnessDays ?? null]));
}
export function recallNewsSources(key: string, now = Date.now()) {
  const entry = entries.get(key);
  if (entry && entry.expires > now) return structuredClone(entry);
  entries.delete(key);
  return undefined;
}
export function sameNewsOriginals(entry: Entry, originals: SearchOriginal[]) {
  return originals.length === entry.answer.sources.length && originalHash(originals) === entry.originalHash;
}
export function rememberNewsSources(key: string, answer: Answer, originals: SearchOriginal[], now = Date.now()) {
  if (!answer.sources.length || !originals.length) return;
  // Only cited originals determine reuse; independently rejected candidates cannot become evidence.
  const cited = originals.filter(original => answer.sources.some(source => source.uri === original.source.uri));
  if (cited.length !== answer.sources.length) return;
  entries.delete(key);
  entries.set(key, { answer: structuredClone(answer), originalHash: originalHash(cited), expires: now + 600_000 });
  if (entries.size > 100) entries.delete(entries.keys().next().value!);
}
