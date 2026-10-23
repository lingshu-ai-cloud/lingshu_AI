import { z } from 'zod';
import type { DigitalHumanRequirements } from './digitalHumanRequirements';

const id = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9:_-]+$/);
export const creationSelectionSchema = z.object({
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
  action: z.enum(['start', 'products', 'shots', 'narration', 'avatar']),
  selection: creationSelectionSchema,
  instruction: z.string().trim().min(1).max(4000),
}).strict();
export type CreationTurn = z.infer<typeof creationTurnSchema>;
export const creationShotSchema = z.object({
  id, sourceId: id, title: z.string().max(200), description: z.string().max(700),
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
  stage: z.enum(['products', 'shots', 'narration', 'avatar', 'review']),
  selection: creationSelectionSchema,
  referenceTitle: z.string().max(200),
  products: z.array(z.object({ id, name: z.string().max(200) })).max(100),
  shots: z.array(creationShotSchema).max(40),
  narrations: z.array(z.object({ id: z.enum(['visual', 'question', 'direct']), title: z.string().max(80), text: z.string().max(1500), seconds: z.number().min(15).max(30) })).max(3),
  gaps: z.array(z.string().max(300)).max(30),
  plannedShots: z.array(plannedShotSchema).max(13).optional(),
  avatarPlacement: z.enum(['none', 'first', 'second', 'pending']).optional(),
  presenterIds: z.array(id).max(20).default([]),
});
export type CreationReply = z.infer<typeof creationReplySchema>;
export const CREATION_QUESTIONS: Record<CreationReply['stage'], string> = {
  products: '你想在视频中选题什么产品？',
  shots: '为你推荐以下分镜。',
  narration: '根据选择的几个分镜，为你推荐口播。',
  avatar: '是否加入数字人视频？',
  review: '已整理待创作方案，请核验素材与人物证据后进入原创作流程。',
};
