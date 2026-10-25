import { z } from 'zod';

/** Read-only navigation to an existing content task; never an execution grant. */
export const assistantTaskPortalSchema = z.object({
  kind: z.literal('content_task'),
  taskId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().trim().min(1).max(180),
  action: z.enum(['review_plan', 'complete_brief', 'view_task']),
  phase: z.enum(['offered', 'ready']),
}).strict();
export type AssistantTaskPortal = z.infer<typeof assistantTaskPortalSchema>;

export function confirmedTaskPortal(value: unknown, reply: string): AssistantTaskPortal | null {
  const parsed = assistantTaskPortalSchema.safeParse(value);
  if (!parsed.success || parsed.data.phase !== 'offered'
    || !/^(?:是|是的|好|好的|可以|要|需要|去吧|跳转|打开|打开这条任务|去处理|确认跳转|带我去)[。！!\s]*$/u.test(reply.trim())) return null;
  return { ...parsed.data, phase: 'ready' };
}
