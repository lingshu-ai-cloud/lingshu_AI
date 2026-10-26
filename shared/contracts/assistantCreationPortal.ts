import { z } from 'zod';
import { imageLanguageSchema } from './imageLanguages';

/** Navigation draft only. This is never a task receipt, product identity or execution grant. */
export const assistantCreationPortalSchema = z.object({
  kind: z.literal('content_creation'),
  id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9:_-]+$/),
  title: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(1).max(1000),
  requestedOutputCount: z.number().int().min(1).max(100).nullable(),
  outputType: z.enum(['video', 'content', 'image']),
  platforms: z.array(z.enum(['tiktok', 'instagram', 'facebook', 'youtube', 'linkedin'])).max(5),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']).nullable(),
  targetDurationSeconds: z.number().int().min(6).max(60).nullable(),
  imageReplication: z.object({
    intake: z.object({
      step: z.number().int().min(0).max(2),
      productId: z.string().max(200),
      objective: z.string().max(1000),
      audience: z.string().max(500),
      callToAction: z.string().max(500),
      platform: z.enum(['facebook', 'instagram', 'linkedin']),
      aspectRatio: z.enum(['1:1', '4:5', '9:16', '16:9']),
      language: imageLanguageSchema,
      submitted: z.boolean(),
      imageTaskId: z.string().min(1).max(200).optional(),
    }).strict().optional(),
    reference: z.object({
      materialId: z.string().min(1).max(200).optional(),
      sourceRecordId: z.string().min(1).max(200).optional(),
      name: z.string().min(1).max(200),
    }).strict().refine(value => Boolean(value.materialId) !== Boolean(value.sourceRecordId), '需要唯一参考来源').optional(),
  }).strict().optional(),
}).strict().refine(value => (value.outputType === 'image') === Boolean(value.imageReplication), {
  message: '图片入口必须声明图文复刻模式',
});
export type AssistantCreationPortal = z.infer<typeof assistantCreationPortalSchema>;
