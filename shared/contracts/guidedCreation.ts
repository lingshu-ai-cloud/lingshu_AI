import { z } from 'zod';
import { assistantScenePlanSchema } from './assistantScenePlan';
import { VIDEO_LANGUAGES } from './videoLanguages';
const id = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9:_-]+$/);
export const guideMaterialType = z.enum(['talking_head', 'factory', 'product', 'consumer_demo', 'general']);
export const guideNodeSchema = z.object({ id, type: guideMaterialType, sourceShotId: id.optional(), sourceShotIds: z.array(id).max(200).optional() }).strict();
export const guidedSelectionSchema = z.object({
  scene: assistantScenePlanSchema.optional(),
  languages: z.array(z.string().refine(value => Object.hasOwn(VIDEO_LANGUAGES, value))).max(10).refine(values => new Set(values).size === values.length).default([]),
  structureId: id.optional(),
  customNodes: z.array(guideNodeSchema).max(24).default([]),
  productionMode: z.enum(['manual', 'auto']).optional(),
  presenterMode: z.enum(['digital', 'shoot', 'none']).optional(),
  assignments: z.array(z.object({ nodeId: id, intent: z.enum(['match', 'generate']), candidateId: id.optional() }).strict()).max(64).refine(values => new Set(values.map(value => value.nodeId)).size === values.length).default([]),
  taskId: id.optional(),
}).strict();
export type GuidedSelection = z.infer<typeof guidedSelectionSchema>;
export const guideStructureSchema = z.object({
  id, referenceId: id, title: z.string(), source: z.enum(['reference', 'recommended', 'custom']),
  crawledAt: z.string().optional(), views: z.number().nonnegative().optional(), reason: z.string(),
  nodes: z.array(guideNodeSchema).max(64), available: z.boolean(),
});
export const guidedReplySchema = z.object({
  candidates: z.array(z.object({ id, sourceId: id, segmentId: id, title: z.string(), description: z.string(), type: guideMaterialType, start: z.number().nonnegative(), end: z.number().positive(), previewUrl: z.string().max(4096).regex(/^(https?:\/\/|\/(?:api|media|studio-media)\/)/).optional(), productionEligible: z.boolean() })).max(256).default([]),
  structures: z.array(guideStructureSchema).max(3),
  nodes: z.array(guideNodeSchema.extend({ description: z.string(), duration: z.number().positive(), candidates: z.array(id).max(4), selectedCandidateId: id.optional(), status: z.enum(['matched', 'candidate', 'needs_material', 'generate', 'shooting']) })).max(64),
  narration: z.object({ sourceReferenceId: id, sourceTitle: z.string(), lines: z.array(z.object({ lineId: id, sourceText: z.string(), text: z.string() })).optional(), text: z.string(), status: z.enum(['ready', 'needs_evidence']), note: z.string() }),
  blockers: z.array(z.object({ code: z.string(), message: z.string(), nodeId: id.optional() })).max(160),
  notices: z.array(z.string()).max(30),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type GuidedReply = z.infer<typeof guidedReplySchema>;
export type GuideNode = z.infer<typeof guideNodeSchema>;
export const GUIDED_QUESTIONS = {
  guided_products: '请选择要创作的产品和视频语言。',
  guided_structure: '你想用以下哪种爆款结构来创作？',
  guided_production: '分镜想逐个选择，还是交给我智能一键匹配？请选择出镜方式。',
  guided_review: '创作方案已整理，确认后提交制作；字幕、配乐和音色由后台按既有规则处理。',
} as const;
