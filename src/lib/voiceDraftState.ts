export function voiceDraftLanguagesNeedingTranslation(
  languages: string[],
  sourceLanguage: string,
  drafts: Record<string, string>,
  staleLanguages: string[],
  failedLanguages: string[],
): string[] {
  const stale = new Set(staleLanguages);
  const failed = new Set(failedLanguages);
  return [...new Set(languages)]
    .filter(code => code !== sourceLanguage)
    .filter(code => !String(drafts[code] || '').trim() || stale.has(code) || failed.has(code));
}

/**
 * Async translation may finish after the operator edits the same language.
 * Only replace the value that was present when the request started; otherwise
 * the newer manual value wins.
 */
export function mergeGeneratedVoiceDraft(
  current: Record<string, string>,
  requestSnapshot: Record<string, string>,
  language: string,
  generated: string,
): Record<string, string> {
  if (String(current[language] || '') !== String(requestSnapshot[language] || '')) return current;
  if (!String(generated || '').trim()) return current;
  return { ...current, [language]: generated };
}

export function requestedVoiceDraftsReady(
  languages: string[],
  drafts: Record<string, string>,
  staleLanguages: string[],
  pendingLanguages: string[],
): boolean {
  const stale = new Set(staleLanguages);
  const pending = new Set(pendingLanguages);
  return languages.length > 0 && languages.every(code => Boolean(String(drafts[code] || '').trim())
    && !stale.has(code)
    && !pending.has(code));
}

/**
 * Keep the language detected from the immutable storyboard script first.
 * The active/output language is a viewing preference and must never silently
 * become the translation or TTS source just because the operator switched tabs.
 */
export function orderedVoiceLanguages(
  sourceLanguage: string,
  savedLanguages: string[],
  outputLanguage = '',
): string[] {
  return [...new Set([sourceLanguage, ...savedLanguages, outputLanguage].map(code => String(code || '').trim()).filter(Boolean))];
}

/** Resolve the TTS source independently of the currently selected language. */
export function primaryVoiceDraft(
  sourceLanguage: string,
  sourceText: string,
  drafts: Record<string, string>,
): string {
  return String(drafts[sourceLanguage] || sourceText || '').trim();
}

/**
 * Resolve the project-wide set of usable voiceovers after one TTS request.
 * Requested audio is invalidated before synthesis; only a newly generated
 * replacement makes that language valid again. Unrequested, non-stale audio
 * remains valid and must still be included in the success summary.
 */
export function validProjectVoiceoverLanguages(
  projectLanguages: string[],
  audios: Record<string, { url?: string } | undefined>,
  staleLanguages: string[],
  invalidatedLanguages: string[] = [],
  generatedLanguages: string[] = [],
): string[] {
  const generated = new Set(generatedLanguages);
  const invalid = new Set([...staleLanguages, ...invalidatedLanguages].filter(code => !generated.has(code)));
  return [...new Set(projectLanguages.map(code => String(code || '').trim()).filter(Boolean))]
    .filter(code => Boolean(audios[code]?.url) && !invalid.has(code));
}
