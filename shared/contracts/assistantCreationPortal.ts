import { z } from 'zod';

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
    reference: z.object({
      materialId: z.string().min(1).max(200),
      name: z.string().min(1).max(200),
    }).strict().optional(),
  }).strict().optional(),
}).strict().refine(value => (value.outputType === 'image') === Boolean(value.imageReplication), {
  message: '图片入口必须声明图文复刻模式',
});
export type AssistantCreationPortal = z.infer<typeof assistantCreationPortalSchema>;
