import { z } from 'zod';

/** Enterprise preferences are reusable choices, never supplier spending permits. */
const languageSchema = z.enum(['en', 'zh', 'es', 'fr', 'de', 'ar', 'ja', 'ko', 'vi', 'id', 'pt']);
export const contentPreferencesSchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { language, durationSeconds: _retiredDuration, ...rest } = value as Record<string, unknown>;
  return { ...rest, ...(!('languages' in rest) && language ? { languages: [language] } : {}) };
}, z.object({
  languages: z.array(languageSchema).min(1).max(11).transform(values => [...new Set(values)]).default(['en']),
  platform: z.enum(['tiktok', 'instagram', 'facebook', 'youtube', 'linkedin']).default('tiktok'),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']).default('9:16'),
  audience: z.string().trim().max(500).default('海外 B2B 品牌商与采购商'),
  market: z.string().trim().max(80).default('全球'),
  callToAction: z.string().trim().max(500).default('联系获取产品目录与报价'),
  materialPolicy: z.enum(['material_cut', 'ai_enhanced']).default('material_cut'),
}).strict());
export type ContentPreferences = z.infer<typeof contentPreferencesSchema>;
export const DEFAULT_CONTENT_PREFERENCES = contentPreferencesSchema.parse({});
export const singleContentSelectionSchema = z.object({
  productId: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(1000),
  dueAt: z.string().datetime({ offset: true }),
  usePresenter: z.boolean(),
  presenterId: z.string().trim().max(200).optional(),
  referenceId: z.string().trim().max(200).optional(),
  preferences: contentPreferencesSchema,
}).strict();
export type SingleContentSelection = z.infer<typeof singleContentSelectionSchema>;
export type SingleContentCheck = { key: string; label: string; state: 'ready' | 'warning' | 'blocked'; message: string };
export type SingleContentPreparation = {
  fingerprint: string;
  checks: SingleContentCheck[];
  canCreate: boolean;
  executionAvailable: boolean;
  budgetLimitCny: number;
};
export type ContentCreationOptions = {
  preferences: ContentPreferences;
  preferencesVersion: string;
  preferencesSaved: boolean;
  defaultPresenterId: string;
  products: Array<{ id: string; name: string }>;
  presenters: Array<{ id: string; name: string; authorized: boolean; avatarId: string; voiceId: string; presenterSource?: import('./presenterVoicePolicy').PresenterSource; voiceSelectionMode?: import('./presenterVoicePolicy').PresenterVoiceMode }>;
  references: Array<{ id: string; title: string; durationSeconds: number | null; platform: string }>;
};
