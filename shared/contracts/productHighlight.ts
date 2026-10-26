import { z } from 'zod';

export const productHighlightRequestSchema = z.object({
  productId: z.string().trim().min(1).max(200),
  factVersion: z.string().trim().min(1).max(200),
}).strict();
export const productHighlightDraftSchema = z.object({
  productId: z.string().min(1).max(200), productName: z.string().min(1).max(200),
  factVersion: z.string().min(1).max(200), previousHighlight: z.string().max(10000),
  highlight: z.string().trim().min(1).max(300),
}).strict();
export type ProductHighlightDraft = z.infer<typeof productHighlightDraftSchema>;
