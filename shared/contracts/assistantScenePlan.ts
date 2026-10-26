import { z } from 'zod';
const id = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9:_-]+$/);
/** Confirmed business inputs inside the existing creation dialogue; never an execution grant. */
export const assistantScenePlanSchema = z.object({
  kind: z.enum(['campaign', 'hook_first']),
  groupId: id,
  plannedPublishAt: z.string().datetime({ offset: true }),
  deliverBy: z.string().datetime({ offset: true }),
  campaign: z.object({
    name: z.string().trim().min(1).max(120),
    offer: z.string().trim().min(1).max(500),
    sellingPoints: z.string().max(1000),
    materialIds: z.array(id).max(12).refine(values => new Set(values).size === values.length),
  }).strict().optional(),
  hook: z.object({ materialId: id, startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(), usage: z.enum(['editable', 'reference_only']), direction:z.string().trim().min(1).max(1000) }).strict().optional(),
  narrationEdits: z.array(z.object({ lineId: id, text: z.string().trim().min(1).max(1500) }).strict()).max(100).default([]),
  narrationConfirmed: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.deliverBy) > Date.parse(value.plannedPublishAt)) ctx.addIssue({ code: 'custom', message: '交付时间不能晚于发布时间' });
  if (value.kind === 'campaign' && !value.campaign) ctx.addIssue({ code: 'custom', message: '活动信息缺失' });
  if (value.kind === 'hook_first' && (!value.hook || value.hook.endSeconds <= value.hook.startSeconds)) ctx.addIssue({ code: 'custom', message: '开场片段无效' });
});
export type AssistantScenePlan = z.infer<typeof assistantScenePlanSchema>;
