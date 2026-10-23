import { parseTimestampedVoiceover, stripVoiceoverTimestamps, isBadTranslatedLine, isNonSpeechSfx, normalizeTranslatedVoiceover } from './studioVoiceoverRules';
import { normalizeScriptTimestamps } from './studioLanguageRules';


export function resolveTranslatedVoiceover(base: string, translated: string, target: string): string {
  const raw = normalizeScriptTimestamps(String(translated || '')).trim();
  if (!raw) return '';
  const aligned = normalizeTranslatedVoiceover(base, raw, target);
  if (aligned.trim()) return aligned;

  // The model can return a valid localized script whose line structure is not
  // identical to the extracted source (for example after omitting an SFX or
  // merging a very short cue). Do not discard the whole translation merely
  // because the stricter index-based aligner could not rebuild every line.
  const spoken = stripVoiceoverTimestamps(raw).trim();
  if (!spoken || isBadTranslatedLine(spoken, target)) return '';
  const sourceCueCount = parseTimestampedVoiceover(base).filter(item => !isNonSpeechSfx(item.text)).length;
  const translatedCueCount = parseTimestampedVoiceover(raw).filter(item => !isNonSpeechSfx(item.text)).length;
  if (sourceCueCount > 0 && translatedCueCount !== sourceCueCount) return '';
  return raw;
}

export const VOICE_TRANSLATION_BATCH_TIMEOUT_MS = 100_000;

export const VOICE_TRANSLATION_SINGLE_TIMEOUT_MS = 70_000;

export async function runVoiceTranslationWithTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (parentSignal.aborted) controller.abort();
  else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await request(controller.signal);
  } catch (error) {
    if (timedOut && !parentSignal.aborted) {
      throw new Error(`翻译请求超过 ${Math.round(timeoutMs / 1000)} 秒，已自动停止等待`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    parentSignal.removeEventListener('abort', abortFromParent);
  }
}
