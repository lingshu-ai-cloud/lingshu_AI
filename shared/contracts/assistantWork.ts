import { z } from 'zod';

/** Public execution summaries only; never model reasoning or raw tool arguments. */
export const assistantWorkSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  detail: z.string().max(500),
  status: z.enum(['running', 'completed', 'failed']),
}).strict();
export type AssistantWork = z.infer<typeof assistantWorkSchema>;
export function upsertAssistantWork(events: AssistantWork[], event: AssistantWork): AssistantWork[] {
  return events.some(e => e.id === event.id) ? events.map(e => e.id === event.id ? event : e) : [...events, event].slice(-30);
}
export const assistantWorksSchema = z.array(assistantWorkSchema).max(30);
export const followupCustomerSchema = z.object({
  id: z.string(), name: z.string(), channel: z.string(), stage: z.string(),
  lastInteraction: z.string(), issue: z.string(), reason: z.string(), canFollow: z.boolean(),
});
export const dailyFollowupsSchema = z.object({
  day: z.string(), remaining: z.number().int().nonnegative(), completed: z.number().int().nonnegative(),
  customers: z.array(followupCustomerSchema).max(5),
});
export type DailyFollowups = z.infer<typeof dailyFollowupsSchema>;
