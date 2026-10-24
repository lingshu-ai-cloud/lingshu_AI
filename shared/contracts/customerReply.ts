import { z } from 'zod';
const text = z.string().max(12000);
export const customerReplyRequestSchema = z.strictObject({
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,120}$/).optional(),
  customerId: z.string().trim().min(1).max(200), customerName: text.optional(),
  timeline: z.array(z.object({actor:z.string(), body:text, type:z.string().optional(), timestamp:z.number().optional(), time:z.string().optional()}).passthrough()).max(100),
  language: z.string().max(100).optional(), product:text.optional(), internalProduct:text.optional(), stage:text.optional(),
  intent:z.enum(['reply','opener','followup','reactivate','post_call','polish','handoff_summary']).optional(), mode:z.enum(['draft','polish']).optional(),
  instruction:text.optional(), message:text.optional(), manualRequest:z.boolean().optional(),
  bant:z.record(z.string(),z.unknown()).optional(), progressionGoal:z.record(z.string(),z.unknown()).optional(), spinGuidance:z.record(z.string(),z.unknown()).optional(),
  fallbackCount:z.number().int().min(0).max(1000).optional(), handlingReason:text.optional(), customerSummary:text.optional(), nextStep:text.optional(),
  replyId:text.optional(), nodeId:text.optional(), currentNode:text.optional(),
});
export type CustomerReplyRequest = z.infer<typeof customerReplyRequestSchema>;
export type CustomerReplyState = 'succeeded'|'degraded'|'waiting_human'|'pending'|'failed'|'blocked';
export interface CustomerReplyEnvelope {
  schemaVersion:1; requestId:string; status:CustomerReplyState; generationSource:'provider_generated'|'deterministic'|'degraded';
  enterpriseFactVersion:string|null; draft:string; messages:string[]; translatedDraft:string; translatedMessages:string[];
  verification:{status:string;issues:string[]}; decision:unknown; code:string|null; retryable:boolean;
  [key:string]:unknown;
}
export const customerReplyEnvelopeSchema = z.object({
  schemaVersion:z.literal(1),requestId:z.string().min(8).max(120),
  status:z.enum(['succeeded','degraded','waiting_human','pending','failed','blocked']),
  generationSource:z.enum(['provider_generated','deterministic','degraded']),enterpriseFactVersion:z.string().nullable(),
  draft:z.string(),messages:z.array(z.string()),translatedDraft:z.string(),translatedMessages:z.array(z.string()),
  verification:z.object({status:z.string(),issues:z.array(z.string())}),
  decision:z.object({schemaVersion:z.literal(1),execution:z.enum(['none','remind','draft','auto_send','human_required'])}).passthrough(),
  code:z.string().nullable(),retryable:z.boolean(),
}).passthrough();
