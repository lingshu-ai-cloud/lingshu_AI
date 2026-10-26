import { z } from 'zod';
import { normalizeVideoLanguage, VIDEO_LANGUAGES } from './videoLanguages';

/** Images and videos use one product language catalog; provider readiness is separate. */
export const IMAGE_LANGUAGES = VIDEO_LANGUAGES;
export type ImageLanguage = keyof typeof IMAGE_LANGUAGES;
export const imageLanguageSchema = z.enum(Object.keys(IMAGE_LANGUAGES) as [ImageLanguage, ...ImageLanguage[]]);
export const IMAGE_LANGUAGE_OPTIONS = Object.entries(IMAGE_LANGUAGES).map(([value, label]) => ({ value, label }));
export const normalizeImageLanguage = normalizeVideoLanguage;
export function imageLanguageLabel(code: string): string {
  return IMAGE_LANGUAGES[code as ImageLanguage] || code;
}
