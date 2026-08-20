export interface TranslationQualityResult {
  ok: boolean;
  text: string;
  error?: string;
}

const TIMESTAMP_RE = /^\s*(\[[^\]]*?(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?[^\]]*\])\s*(.*)$/i;

function cleanLine(value: string): string {
  return String(value || '')
    .replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '')
    .replace(/^\s*(?:voiceover|vo|口播|台词)\s*[：:]\s*/i, '')
    .replace(/^\s*[“"']|[”"']\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSoundEffect(value: string): boolean {
  const compact = cleanLine(value).replace(/[\s.,，。!！?？~～…·:：;；-]/g, '').toLowerCase();
  return /^(?:噗噗?|砰砰?|咚咚?|咯吱|咔嚓|嗖|嗡嗡?|whoosh|swoosh|pop|bang|boom|ding|beep|click|buzz|whirr)$/i.test(compact);
}

function timestampedLines(value: string) {
  return String(value || '').split(/\n+/).map(line => {
    const match = line.match(TIMESTAMP_RE);
    if (!match) return null;
    const text = cleanLine(match[4] || '');
    return {
      timestamp: match[1] || '',
      start: Number(match[2]),
      end: Number(match[3]),
      text,
    };
  }).filter((line): line is NonNullable<typeof line> => Boolean(line?.text && !isSoundEffect(line.text)));
}

function candidateLines(value: string) {
  const timed = timestampedLines(value);
  if (timed.length) return timed;
  return String(value || '').split(/\n+/)
    .map(line => cleanLine(line))
    .filter(line => Boolean(line && !isSoundEffect(line)))
    .map(text => ({ timestamp: '', start: Number.NaN, end: Number.NaN, text }));
}

function compactComparable(value: string): string {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function targetWritingSystemMatches(value: string, target: string): boolean {
  const spoken = String(value || '').replace(/\[[^\]]+\]/g, '').replace(/[\d\s\p{P}\p{S}]+/gu, '');
  if (!spoken) return false;
  if (target === 'zh') return /[\u4e00-\u9fff]/.test(spoken);
  if (target === 'ar') return /[\u0600-\u06ff]/.test(spoken);
  if (target === 'ja') return /[\u3040-\u30ff]/.test(spoken);
  if (target === 'ko') return /[\uac00-\ud7af]/.test(spoken);
  if (target === 'ru' || target === 'uk') return /[\u0400-\u04ff]/.test(spoken);
  if (target === 'hi') return /[\u0900-\u097f]/.test(spoken);
  if (target === 'th') return /[\u0e00-\u0e7f]/.test(spoken);
  if (target === 'el') return /[\u0370-\u03ff]/.test(spoken);
  if (!/[A-Za-zÀ-ž]/.test(spoken)) return false;
  if (/[\u4e00-\u9fff\u0600-\u06ff\u0400-\u04ff\u0900-\u097f\u0e00-\u0e7f]/.test(spoken)) return false;
  if (target === 'es') {
    const naturalSpanish = /(?:[áéíóúñ¿¡]|\b(?:el|la|los|las|un|una|para|con|que|de|del|y|su|este|esta|producto|muestra|pedido|envía|compradores)\b)/i;
    return naturalSpanish.test(String(value || ''));
  }
  return true;
}

export function normalizeStudioTranslationCandidate(input: {
  source: string;
  candidate: string;
  target: string;
  sourceCode?: string;
}): TranslationQualityResult {
  const sourceLines = timestampedLines(input.source);
  const translatedLines = candidateLines(input.candidate);
  if (!translatedLines.length) return { ok: false, text: '', error: 'empty translation' };

  if (!sourceLines.length) {
    const text = translatedLines.map(line => line.text).join('\n');
    if (!targetWritingSystemMatches(text, input.target)) return { ok: false, text: '', error: 'wrong target language' };
    if (input.target !== input.sourceCode && compactComparable(text) === compactComparable(input.source)) {
      return { ok: false, text: '', error: 'source text was not translated' };
    }
    return { ok: true, text };
  }

  if (translatedLines.length !== sourceLines.length) {
    return { ok: false, text: '', error: `cue count mismatch: ${translatedLines.length}/${sourceLines.length}` };
  }
  if (!targetWritingSystemMatches(translatedLines.map(line => line.text).join('\n'), input.target)) {
    return { ok: false, text: '', error: 'wrong target language' };
  }

  const uniqueSource = new Set(sourceLines.map(line => compactComparable(line.text)));
  const uniqueTranslated = new Set(translatedLines.map(line => compactComparable(line.text)));
  if (sourceLines.length > 1 && uniqueSource.size > 1 && uniqueTranslated.size === 1) {
    return { ok: false, text: '', error: 'repeated translation lines' };
  }

  const normalized: string[] = [];
  for (let index = 0; index < sourceLines.length; index += 1) {
    const source = sourceLines[index]!;
    const translated = translatedLines[index]!;
    if (translated.timestamp && (Math.abs(translated.start - source.start) > 0.01 || Math.abs(translated.end - source.end) > 0.01)) {
      return { ok: false, text: '', error: `timestamp mismatch at cue ${index + 1}` };
    }
    if (!targetWritingSystemMatches(translated.text, input.target)) {
      return { ok: false, text: '', error: `wrong target language at cue ${index + 1}` };
    }
    if (input.target !== input.sourceCode
      && compactComparable(translated.text) === compactComparable(source.text)
      && source.text.split(/\s+/).length >= 4) {
      return { ok: false, text: '', error: `cue ${index + 1} was not translated` };
    }
    normalized.push(`${source.timestamp} ${translated.text}`);
  }
  return { ok: true, text: normalized.join('\n') };
}
