import { customerReplyRequestSchema, customerReplyEnvelopeSchema } from './customerReply.js';
import { z } from 'zod';

const values = z.array(z.string().trim().min(1).max(200)).max(100);
const days = z.number().finite().min(0).max(36500);
export const customerPurposes = ['followup', 'reactivate', 'new_inquiry', 'repurchase', 'screen'] as const;
export const customerCriteriaSchema = z.strictObject({
  match: z.enum(['all', 'any']).optional(),
  stages: values.optional(), excludeStages: values.optional(), handlingModes: values.optional(), bantLevels: values.optional(),
  minIntentScore: z.number().min(0).max(100).optional(), maxIntentScore: z.number().min(0).max(100).optional(),
  sources: values.optional(), tags: values.optional(), tagsAll: values.optional(), tagsAny: values.optional(), tagsNone: values.optional(),
  activeWithinDays: z.number().min(1).max(3650).optional(), inactiveDaysMin: days.optional(), inactiveDaysMax: days.optional(),
  includeCustomerIds: values.max(1000).optional(), excludeCustomerIds: values.max(1000).optional(),
  countries: values.optional(), languages: values.optional(), productIds: values.optional(),
  relationships: z.array(z.enum(['new_inquiry', 'existing_contact', 'unknown'])).max(3).optional(),
  purchase: z.enum(['recorded_paid', 'none_verified', 'unknown']).optional(),
  waitingFor: z.array(z.enum(['seller', 'customer', 'quote_review', 'knowledge_review', 'unknown'])).max(5).optional(),
  purpose: z.enum(customerPurposes).optional(), managementAction:z.enum(['screen','draft']).optional(),
});
export type CustomerSegmentCriteria = z.infer<typeof customerCriteriaSchema>;
export class CustomerCriteriaError extends Error {
  readonly code = 'customer_criteria_invalid';
  readonly status = 400;
  constructor(readonly issues: unknown) { super('customer_criteria_invalid'); }
}
export function parseCustomerCriteria(value: unknown): CustomerSegmentCriteria {
  const result = customerCriteriaSchema.safeParse(value ?? {});
  if (!result.success) throw new CustomerCriteriaError(result.error.issues);
  const c = result.data;
  if (c.minIntentScore !== undefined && c.maxIntentScore !== undefined && c.minIntentScore > c.maxIntentScore
    || c.inactiveDaysMin !== undefined && c.inactiveDaysMax !== undefined && c.inactiveDaysMin > c.inactiveDaysMax) {
    throw new CustomerCriteriaError([{ message: 'range_min_exceeds_max' }]);
  }
  return c;
}
export const customerBatchPresets: Record<string, CustomerSegmentCriteria> = {
  new_inquiry: { purpose: 'new_inquiry', match: 'all', relationships: ['new_inquiry'] },
  reactivate: { purpose: 'reactivate', match: 'all', relationships: ['existing_contact'] },
  repurchase: { purpose: 'repurchase', match: 'all', purchase: 'recorded_paid' },
  screen: { purpose: 'screen', match: 'all' },
};
export const customerBatchCapabilities = {
  schemaVersion: 1, criteriaSchema:z.toJSONSchema(customerCriteriaSchema), criteriaFields: Object.keys(customerCriteriaSchema.shape),
  tagSemantics: { tags: 'any', tagsAll: 'all', tagsAny: 'any', tagsNone: 'exclude' },
  reply:{requestSchema:z.toJSONSchema(customerReplyRequestSchema),responseSchema:z.toJSONSchema(customerReplyEnvelopeSchema),create:'POST /api/overseas/agents/conversion/draft',read:'GET /api/overseas/agents/conversion/draft/:requestId'},
  states:['succeeded','blocked','pending','degraded','waiting_human','no_data','failed'],
  actions: ['confirm_new_inquiry','preview', 'freeze_segment', 'screen', 'draft', 'approve', 'dispatch', 'classify', 'review_profile'],
  unsupportedActions: ['bulk_assign_owner', 'bulk_overwrite_tags'],
  presets: customerBatchPresets,
  prerequisites: ['authenticated_tenant', 'owned_run', 'verified_channel_customers'],
  unknownPolicy: 'missing_evidence_is_unknown',
  inbound: { whatsapp: 'persist_and_qualify_only', messenger: 'persist_and_classify', instagram: 'persist_and_classify' },
  endpoints: { preview: 'POST /api/overseas/customer-batches/runs/:runId/preview', freeze: 'POST /api/overseas/customer-batches/runs/:runId/segments',classify:'POST /api/overseas/customer-batches/runs/:runId/classify',reviewProfile:'POST /api/overseas/customer-batches/runs/:runId/customers/:customerId/profile',confirmNewInquiry:'POST /api/overseas/customer-batches/runs/:runId/customers/:customerId/confirm-new-inquiry' },
} as const;
