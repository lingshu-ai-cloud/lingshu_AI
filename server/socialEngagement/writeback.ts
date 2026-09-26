import { createHash } from 'node:crypto';
import { store } from '../storage/index.js';

export type InteractionKind = 'comment' | 'direct_message' | 'form' | 'inquiry';
export type SourceConfidence = 'confirmed' | 'unknown';
export type QualificationStatus = 'candidate' | 'qualified' | 'disqualified';

export interface InteractionWritebackInput {
  kind: InteractionKind;
  platform: string;
  providerEventId: string;
  accountId: string;
  contentId?: string;
  body: string;
  occurredAt: string;
  actorRef?: string;
  entryRef?: string;
  ctaRef?: string;
  businessDirectionRef?: string;
  respondedAt?: string;
  qualificationFields?: Record<string, unknown>;
  raw?: unknown;
}

export interface StoredInteractionWriteback extends InteractionWritebackInput {
  id: string;
  tenant_id: string;
  event_key: string;
  source_confidence: SourceConfidence;
  qualification_status: QualificationStatus;
  created_at: string;
  updated_at: string;
}

export interface CreativeLearningInput {
  learningId?: string;
  evidenceKind: 'external_reference' | 'owned_content_result';
  scope: { platform?: string; accountId?: string; contentIds: string[]; businessDirection?: string };
  observation: string;
  evidenceRefs: string[];
  sample: { startsAt: string; endsAt: string; size: number };
  boundaries: string[];
  nextAction: string;
}

const INTERACTIONS = 'social_interaction_writebacks';
const QUALIFICATIONS = 'social_sales_qualifications';
const LEARNINGS = 'social_creative_learnings';

function clean(value: unknown, max: number) { return String(value || '').trim().slice(0, max); }
function unique(values: unknown, max = 100): string[] {
  return Array.isArray(values) ? [...new Set(values.map(value => clean(value, 200)).filter(Boolean))].slice(0, max) : [];
}
function eventKey(input: InteractionWritebackInput): string {
  return createHash('sha256').update(`${input.kind}\0${input.platform}\0${input.accountId}\0${input.providerEventId}`).digest('hex');
}
function iso(value: unknown): string | null {
  const parsed = new Date(String(value || ''));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function normalizeInteractionWriteback(raw: unknown): InteractionWritebackInput {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const kind = clean(value.kind, 30) as InteractionKind;
  if (!['comment', 'direct_message', 'form', 'inquiry'].includes(kind)) throw Error('invalid_interaction_kind');
  const input: InteractionWritebackInput = {
    kind,
    platform: clean(value.platform, 50).toLowerCase(),
    providerEventId: clean(value.providerEventId, 300),
    accountId: clean(value.accountId, 200),
    contentId: clean(value.contentId, 300) || undefined,
    body: clean(value.body, 10_000),
    occurredAt: iso(value.occurredAt) || '',
    actorRef: clean(value.actorRef, 300) || undefined,
    entryRef: clean(value.entryRef, 500) || undefined,
    ctaRef: clean(value.ctaRef, 300) || undefined,
    businessDirectionRef: clean(value.businessDirectionRef, 300) || undefined,
    respondedAt: value.respondedAt ? iso(value.respondedAt) || undefined : undefined,
    qualificationFields: value.qualificationFields && typeof value.qualificationFields === 'object' && !Array.isArray(value.qualificationFields)
      ? value.qualificationFields as Record<string, unknown>
      : undefined,
    raw: value.raw,
  };
  if (!input.platform || !input.providerEventId || !input.accountId || !input.body || !input.occurredAt) throw Error('interaction_fields_required');
  if (input.kind === 'comment' && !input.contentId) throw Error('comment_content_required');
  return input;
}

export async function writebackInteraction(tenantId: string, raw: unknown): Promise<{ item: StoredInteractionWriteback; repeated: boolean }> {
  const input = normalizeInteractionWriteback(raw);
  const key = eventKey(input);
  const existing = (await store.list<StoredInteractionWriteback>(INTERACTIONS, { where: { tenant_id: tenantId, event_key: key }, perPage: 1 })).items[0];
  if (existing) return { item: existing, repeated: true };
  const now = new Date().toISOString();
  const item = await store.create<StoredInteractionWriteback>(INTERACTIONS, {
    tenant_id: tenantId, event_key: key, ...input,
    source_confidence: input.contentId ? 'confirmed' : 'unknown',
    qualification_status: 'candidate', created_at: now, updated_at: now,
  });
  if (!item) throw Error('interaction_writeback_unavailable');
  return { item, repeated: false };
}

export async function listInteractionWritebacks(tenantId: string, kind?: string) {
  return (await store.list<StoredInteractionWriteback>(INTERACTIONS, {
    where: { tenant_id: tenantId, ...(kind ? { kind } : {}) }, sort: '-occurredAt', perPage: 500,
  })).items;
}

export async function listCreativeLearnings(tenantId: string) {
  return (await store.list(LEARNINGS, {
    where: { tenant_id: tenantId }, sort: '-created_at', perPage: 200,
  })).items;
}

export async function confirmSalesQualification(input: {
  tenantId: string; interactionId: string; status: 'qualified' | 'disqualified'; authority: 'sales' | 'crm'; actorId: string; reason: string; bant?: unknown;
}) {
  if (!['qualified', 'disqualified'].includes(input.status)) throw Error('qualification_status_required');
  if (!['sales', 'crm'].includes(input.authority)) throw Error('qualification_authority_required');
  const interaction = await store.getById<StoredInteractionWriteback>(INTERACTIONS, input.interactionId);
  if (!interaction || interaction.tenant_id !== input.tenantId || interaction.kind === 'comment') throw Error('inquiry_not_found');
  const now = new Date().toISOString();
  const payload = { tenant_id: input.tenantId, interaction_id: interaction.id, status: input.status, authority: input.authority, actor_id: clean(input.actorId, 200), reason: clean(input.reason, 2000), bant: input.bant, confirmed_at: now };
  if (!payload.actor_id || !payload.reason) throw Error('qualification_evidence_required');
  const decision = await store.create(QUALIFICATIONS, payload);
  if (!decision) throw Error('qualification_writeback_unavailable');
  if (!await store.update(INTERACTIONS, interaction.id, { qualification_status: input.status, updated_at: now })) throw Error('qualification_writeback_unavailable');
  return { ...decision, sourceContentId: interaction.contentId || null, sourceConfidence: interaction.source_confidence };
}

export async function createCreativeLearning(tenantId: string, actorId: string, raw: CreativeLearningInput) {
  const evidenceKind = clean(raw?.evidenceKind, 50);
  const scope = raw?.scope && typeof raw.scope === 'object' ? raw.scope : { contentIds: [] };
  const evidenceRefs = unique(raw?.evidenceRefs);
  const contentIds = unique(scope.contentIds);
  const startsAt = iso(raw?.sample?.startsAt); const endsAt = iso(raw?.sample?.endsAt);
  const size = Math.max(0, Math.floor(Number(raw?.sample?.size) || 0));
  const observation = clean(raw?.observation, 4000); const nextAction = clean(raw?.nextAction, 2000);
  if (!['external_reference', 'owned_content_result'].includes(evidenceKind)) throw Error('creative_learning_kind_required');
  if (!observation || !nextAction || !evidenceRefs.length || !startsAt || !endsAt || !size) throw Error('creative_learning_evidence_required');
  if (Date.parse(startsAt) > Date.parse(endsAt)) throw Error('creative_learning_sample_range_invalid');
  const requestedLearningId = clean(raw?.learningId, 200);
  const learningId = requestedLearningId || `cl_${createHash('sha256').update(`${tenantId}\0${evidenceKind}\0${observation}\0${startsAt}\0${endsAt}`).digest('hex').slice(0, 24)}`;
  const previous = (await store.list<any>(LEARNINGS, { where: { tenant_id: tenantId, learning_id: learningId }, sort: '-version', perPage: 1 })).items[0];
  const item = await store.create(LEARNINGS, {
    tenant_id: tenantId, learning_id: learningId, version: Number(previous?.version || 0) + 1,
    evidence_kind: evidenceKind,
    scope: { platform: clean(scope.platform, 50), accountId: clean(scope.accountId, 200), businessDirection: clean(scope.businessDirection, 200), contentIds },
    observation, evidence_refs: evidenceRefs, sample: { startsAt, endsAt, size }, boundaries: unique(raw.boundaries, 30), next_action: nextAction,
    created_by: actorId, created_at: new Date().toISOString(),
  });
  if (!item) throw Error('creative_learning_writeback_unavailable');
  return item;
}

export const interactionCollections = { interactions: INTERACTIONS, qualifications: QUALIFICATIONS, learnings: LEARNINGS };
