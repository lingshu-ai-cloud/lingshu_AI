import { z } from 'zod';
import { guidedSelectionSchema, guidedReplySchema, GUIDED_QUESTIONS } from './guidedCreation';
import type { DigitalHumanRequirements } from './digitalHumanRequirements';

const id = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9:_-]+$/);
export const creationSelectionSchema = z.object({
  guided: guidedSelectionSchema.optional(),
  productionDraft: z.object({ projectId: id.optional(), voiceChoice: z.enum(['defer', 'none']).optional(), subtitleChoice: z.enum(['draft', 'off']).optional(), subtitleDraft: z.string().trim().min(1).max(1500).optional(), materialChoice: z.enum(['candidate', 'skip']).optional(), narrationDraft: z.string().trim().min(1).max(1500).optional() }).strict().optional(),
  referenceId: id,
  referenceLabel: z.string().max(200).optional(),
  referenceThumbnail: z.string().max(2048).regex(/^(https?:\/\/|\/api\/)/).optional(),
  productIds: z.array(id).max(12).refine(values => new Set(values).size === values.length).default([]),
  shotIds: z.array(id).max(12).refine(values => new Set(values).size === values.length).default([]),
  narrationId: z.enum(['visual', 'question', 'direct']).optional(),
  avatar: z.boolean().optional(),
  evidenceVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type CreationSelection = z.infer<typeof creationSelectionSchema>;
export const creationTurnSchema = z.object({
  action: z.enum(['guided_preview', 'guided_products', 'guided_structure', 'guided_production', 'guided_review', 'start', 'products', 'shots', 'narration', 'avatar', 'production_storyboard', 'production_match', 'production_edit', 'production_review', 'production_voice', 'production_subtitles', 'production_preview', 'production_finish']),
  selection: creationSelectionSchema,
  instruction: z.string().trim().min(1).max(4000),
}).strict();
export type CreationTurn = z.infer<typeof creationTurnSchema>;
export const creationShotSchema = z.object({
  id, sourceId: id, segmentId: id.optional(), title: z.string().max(200), description: z.string().max(700),
  kind: z.enum(['hook', 'factory', 'product']), start: z.number().nonnegative(), end: z.number().positive(),
  previewUrl: z.string().max(2048).regex(/^(https?:\/\/|\/(?:api|media|studio-media)\/)/).optional(),
  evidence: z.string().max(300),
});
export type CreationShot = z.infer<typeof creationShotSchema>;
const digitalHumanDraftSchema = z.object({
  workflow: z.literal('material_processing'), method: z.literal('talking'), preferredProvider: z.literal('auto'),
  contentConfirmed: z.literal(false), presenterSelected: z.literal(false),
  action: z.string(), scene: z.string(), preserve: z.string(),
}) satisfies z.ZodType<DigitalHumanRequirements>;
const plannedShotSchema = z.object({
  id, sourceShotId: id.nullable(), kind: z.enum(['hook', 'factory', 'product', 'digital_presenter']),
  digitalHuman: digitalHumanDraftSchema.optional(),
});
export const creationReplySchema = z.object({
  guided: guidedReplySchema.optional(),
  stage: z.enum(['guided_products', 'guided_structure', 'guided_production', 'guided_review', 'products', 'shots', 'narration', 'avatar', 'review', 'production_shots', 'production_materials', 'production_narration', 'production_review', 'production_voice', 'production_subtitles', 'production_preview', 'production_finish']),
  selection: creationSelectionSchema,
  referenceTitle: z.string().max(200),
  products: z.array(z.object({ id, name: z.string().max(200) })).max(100),
  shots: z.array(creationShotSchema).max(40),
  narrations: z.array(z.object({ id: z.enum(['visual', 'question', 'direct']), title: z.string().max(80), text: z.string().max(1500), seconds: z.number().min(15).max(30) })).max(3),
  gaps: z.array(z.string().max(300)).max(30),
  production: z.object({ finishing: z.object({ binding: z.enum(['unbound', 'bound', 'mismatch']), code: z.string(), projectId: id.optional(), audioRecords: z.number().int().nonnegative(), subtitleRecords: z.number().int().nonnegative(), renderRecords: z.number().int().nonnegative(), note: z.string(), subtitleText: z.string().max(1500) }).optional(), narration: z.string().max(1500), seconds: z.number().nonnegative(), materialChoice: z.enum(['candidate', 'skip']).optional(), shots: z.array(z.object({ id, title: z.string(), description: z.string(), sourceId: id.optional(), start: z.number().optional(), end: z.number().optional(), status: z.enum(['reference_only', 'candidate', 'missing', 'skipped']) })).max(14) }).optional(),
  plannedShots: z.array(plannedShotSchema).max(13).optional(),
  avatarPlacement: z.enum(['none', 'first', 'second', 'pending']).optional(),
  presenterIds: z.array(id).max(20).default([]),
});
export type CreationReply = z.infer<typeof creationReplySchema>;
export const CREATION_QUESTIONS: Record<CreationReply['stage'], string> = {
  ...GUIDED_QUESTIONS,
  production_voice: '接下来检查配音。当前只保留需求或选择暂不配音，不合成声音；你想怎样继续？',
  production_subtitles: '字幕先保留为可编辑文字草稿，还是暂不加字幕？没有真实音频时不编造字幕时间轴。',
  production_preview: '现在检查成片预览证据。没有当前方案的真实渲染产物，就保持待补，不用参考视频代替成片。',
  production_finish: '配音、字幕和预览检查选择已保留。以下仍是未接通项，没有启动生成或导出。',
  production_shots: '分镜先按下面的顺序安排，可以吗？缺失画面仍保留待补，不用参考视频替代产品实拍。',
  production_materials: '工厂片段目前仅是候选，使用权和企业归属未核验。要保留候选，还是暂不使用？',
  production_narration: '这版口播需要怎么修改？可以直接编辑后确认；这里只保存文字草稿，不合成语音。',
  production_review: '分镜、素材候选和口播编辑已保留。下面列出仍未接通的证据，尚未生成或提交生产任务。',
  products: '你想在视频中选题什么产品？',
  shots: '为你推荐以下分镜。',
  narration: '根据选择的几个分镜，为你推荐口播。',
  avatar: '是否加入数字人视频？',
  review: '已整理待创作方案，请核验素材与人物证据后进入原创作流程。',
};
