import { z } from 'zod';

export const assistantSourcePortalSchema = z.object({
  title: z.string().trim().min(1).max(500),
  uri: z.string().max(2048).url().refine(value => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  }),
}).strict();
export type AssistantSourcePortal = z.infer<typeof assistantSourcePortalSchema>;
