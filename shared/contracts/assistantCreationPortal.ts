import { z } from 'zod';

/** Navigation draft only. This is never a task receipt, product identity or execution grant. */
export const assistantCreationPortalSchema = z.object({
  kind: z.literal('content_creation'),
  id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9:_-]+$/),
  title: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(1).max(1000),
  requestedOutputCount: z.number().int().min(1).max(100).nullable(),
  outputType: z.enum(['video', 'content']),
  platforms: z.array(z.enum(['tiktok', 'instagram', 'facebook', 'youtube'])).max(4),
  aspectRatio: z.enum(['9:16', '16:9']).nullable(),
  targetDurationSeconds: z.number().int().min(6).max(60).nullable(),
}).strict();
export type AssistantCreationPortal = z.infer<typeof assistantCreationPortalSchema>;
