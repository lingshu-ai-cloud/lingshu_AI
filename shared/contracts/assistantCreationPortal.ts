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
  scenario: z.enum(['viral_replication', 'hook_first', 'campaign', 'weekly_calendar', 'content_task']).optional(),
  sceneStep: z.enum(['source', 'brief', 'summary']).optional(),
  hook: z.object({ materialId: z.string().min(1).max(200), name: z.string().min(1).max(160),
    startSeconds: z.number().min(0), endSeconds: z.number().positive(), duration: z.number().positive(),
    usage: z.enum(['editable', 'reference_only']) }).strict().optional(),
  direction: z.string().max(1000).optional(),
  campaign: z.object({ name: z.string().max(120), type: z.string().max(40), objective: z.string().max(500),
    startsAt: z.string().max(40), endsAt: z.string().max(40),
    items: z.array(z.object({ id: z.string().min(1).max(80), title: z.string().max(120),
      phase: z.enum(['warmup', 'launch', 'followup']), publishAt: z.string().max(40) }).strict()).max(10) }).strict().optional(),
  submissionLocked: z.boolean().optional(),
  createdTasks: z.array(z.object({ itemId: z.string().max(80), taskId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/), title: z.string().max(120), sourceAttached: z.boolean().optional(), startRequested: z.boolean().optional() }).strict()).max(10).optional(),
  calendarDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  calendarGoalId: z.string().max(180).optional(),
  replicationStep: z.enum(['reference', 'product', 'schedule', 'summary']).optional(),
  confirmedTaskId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  selectedProducts: z.array(z.object({ id: z.string().min(1).max(180), name: z.string().min(1).max(300) }).strict()).max(100).optional(),
  selectedProductId: z.string().max(180).optional(),
  selectedProductName: z.string().max(300).optional(),
  plannedPublishAt: z.string().max(40).optional(),
  referencePage: z.number().int().min(1).optional(),
  selectedReferenceSourceUrl: z.string().max(2000).optional(),
  selectedReferenceId: z.string().min(1).max(180).optional(),
  selectedTaskId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/).optional(),
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
