/** Deterministic review hints, not a grammar certificate or a rewrite of
 * measured source speech. Never mutate frozen words/timings or paid inputs. */
export interface SpokenCopyIssue {
  sceneId: string;
  code: 'repeated_function_word' | 'repeated_preposition';
  excerpt: string;
  reason: string;
  suggestedText: string;
}
/** Only repairs two mechanically identifiable ASR duplications. Original
 * reference speech remains in the source evidence; callers freeze a revision. */
export function correctRepeatedSpokenWords(value: string): string {
  return value
    .replace(/\b(on|in|with|at|by|from|for|to)\s+(only|just|solely)\s+\1\b/gi, (_whole, preposition: string, adverb: string) => `${adverb} ${preposition}`)
    .replace(/\b(the|a|an|of|to|for|on|in|with|at|by|from)\s+\1\b/gi, '$1');
}
export function reviewSpokenCopy(scenes: Array<{ sceneId: string; text: string }>): SpokenCopyIssue[] {
  const issues: SpokenCopyIssue[] = [];
  for (const scene of scenes) {
    const rules = [
      { code: 'repeated_function_word' as const, pattern: /\b(the|a|an|of|to|for|on|in|with|at|by|from)\s+\1\b/gi },
      { code: 'repeated_preposition' as const, pattern: /\b(on|in|with|at|by|from|for|to)\s+(?:only|just|solely)\s+\1\b/gi },
    ];
    for (const rule of rules) for (const match of scene.text.matchAll(rule.pattern)) {
      issues.push({ sceneId: scene.sceneId, code: rule.code, excerpt: match[0], suggestedText: correctRepeatedSpokenWords(scene.text),
        reason: `口播疑似重复用词「${match[0]}」，请结合完整句子校对；原始转写保留，不自动改写。` });
    }
  }
  return issues;
}

export function spokenCopyReviewNotice(scenes: Array<{ sceneId: string; text: string }>): string {
  const issues = reviewSpokenCopy(scenes);
  return issues.length ? `口播待校对：${[...new Set(issues.map(issue => issue.excerpt))].slice(0, 3).join('；')}。` : '';
}
