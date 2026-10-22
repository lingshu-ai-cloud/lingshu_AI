export const LANGS = [
  { code: 'en', label: 'English - 英语' },
  { code: 'zh', label: '简体中文 - 中文' },
  { code: 'es', label: 'Español - 西班牙语' },
  { code: 'fr', label: 'Français - 法语' },
  { code: 'de', label: 'Deutsch - 德语' },
  { code: 'pt', label: 'Português - 葡萄牙语' },
  { code: 'it', label: 'Italiano - 意大利语' },
  { code: 'ru', label: 'Русский - 俄语' },
  { code: 'ja', label: '日本語 - 日语' },
  { code: 'ko', label: '한국어 - 韩语' },
  { code: 'ar', label: 'العربية - 阿拉伯语' },
  { code: 'hi', label: 'हिन्दी - 印地语' },
  { code: 'id', label: 'Bahasa Indonesia - 印尼语' },
  { code: 'th', label: 'ภาษาไทย - 泰语' },
  { code: 'vi', label: 'Tiếng Việt - 越南语' },
  { code: 'tr', label: 'Türkçe - 土耳其语' },
  { code: 'nl', label: 'Nederlands - 荷兰语' },
  { code: 'pl', label: 'Polski - 波兰语' },
  { code: 'sv', label: 'Svenska - 瑞典语' },
  { code: 'fil', label: 'Filipino - 菲律宾语' },
  { code: 'ms', label: 'Bahasa Melayu - 马来语' },
  { code: 'uk', label: 'Українська - 乌克兰语' },
  { code: 'el', label: 'Ελληνικά - 希腊语' },
  { code: 'cs', label: 'Čeština - 捷克语' },
  { code: 'ro', label: 'Română - 罗马尼亚语' },
  { code: 'hu', label: 'Magyar - 匈牙利语' },
];

export const langZh = (code: string) => {
  const label = LANGS.find(language => language.code === code)?.label ?? '';
  return label.split(' - ')[1] ?? label;
};

export function filterRecordByLanguage<T>(record: Record<string, T>, codes: string[]): Record<string, T> {
  if (!codes.length) return {};
  return Object.fromEntries(codes
    .filter(code => Object.prototype.hasOwnProperty.call(record, code))
    .map(code => [code, record[code]!]));
}

export function detectScriptLanguageCode(value: string): string {
  const text = String(value || '').replace(/\[[^\]]+\]/g, '').trim();
  if (!text) return 'zh';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  return 'en';
}

export function detectSourceSpeechLanguageCode(value: string): string {
  const text = String(value || '').trim();
  const latinWords = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0;
  const hanCount = text.match(/[\u4e00-\u9fff]/g)?.length || 0;
  if (latinWords >= 3 && latinWords * 2 >= hanCount) return 'en';
  return detectScriptLanguageCode(text);
}

function cleanTimestampNumber(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

export function normalizeScriptTimestamps(value: string): string {
  return String(value || '').replace(
    /\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/gi,
    (_match, start, end) => `[${cleanTimestampNumber(start)}-${cleanTimestampNumber(end)}s]`,
  );
}

const LANG_ALIASES: Record<string, string> = {
  英语: 'en', english: 'en', en: 'en',
  中文: 'zh', 简体中文: 'zh', chinese: 'zh', zh: 'zh',
  西语: 'es', 西班牙语: 'es', spanish: 'es', es: 'es',
  法语: 'fr', french: 'fr', fr: 'fr',
  德语: 'de', german: 'de', de: 'de',
  葡语: 'pt', 葡萄牙语: 'pt', portuguese: 'pt', pt: 'pt',
  意大利语: 'it', italian: 'it', it: 'it',
  俄语: 'ru', russian: 'ru', ru: 'ru',
  日语: 'ja', japanese: 'ja', ja: 'ja',
  韩语: 'ko', korean: 'ko', ko: 'ko',
  阿语: 'ar', 阿拉伯语: 'ar', arabic: 'ar', ar: 'ar',
  印地语: 'hi', hindi: 'hi', hi: 'hi',
  印尼语: 'id', 印度尼西亚语: 'id', indonesian: 'id', id: 'id',
  泰语: 'th', thai: 'th', th: 'th',
  越南语: 'vi', vietnamese: 'vi', vi: 'vi',
  土耳其语: 'tr', turkish: 'tr', tr: 'tr',
  荷兰语: 'nl', dutch: 'nl', nl: 'nl',
  波兰语: 'pl', polish: 'pl', pl: 'pl',
};

export function languageTextToCode(text = '') {
  const first = text.split(/[、,，/|;；\s]+/).map(value => value.trim()).find(Boolean) ?? '';
  const normalized = first.toLowerCase();
  return LANG_ALIASES[first] ?? LANG_ALIASES[normalized] ?? 'en';
}

export function enterpriseLanguageCodes(text = ''): string[] {
  return [...new Set(text
    .split(/[、,，/|;；\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => LANG_ALIASES[item] ?? LANG_ALIASES[item.toLowerCase()] ?? '')
    .filter(code => code && LANGS.some(language => language.code === code)))];
}
