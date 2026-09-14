import type { DataStore } from '../storage/datastore.js';
import { evidenceHash } from './canonical.js';
import { calculateQuote, normalizeQuoteRuleSet } from './engine.js';
import { QuotationError, invalidQuote } from './errors.js';
import type {
  ActorContext,
  NormalizedQuoteInquiry,
  QuoteCalculation,
  QuoteEstimate,
  QuoteInquiryInput,
  QuoteRuleSetInput,
} from './types.js';

export const QUOTATION_COLLECTIONS = Object.freeze({
  rules: 'quote_rule_sets',
  drafts: 'quote_drafts',
  exceptions: 'quote_exception_requests',
  approvals: 'quote_approval_evidence',
  externalSendEvidence: 'quote_external_send_evidence',
});

type StoredRecord = { id: string; [key: string]: unknown };
type RuleRecord = StoredRecord & {
  tenant_id: string;
  rule_set_key: string;
  version: string;
  product_id: string;
  rule_hash: string;
  rule_set: unknown;
  idempotency_key: string;
  request_hash: string;
  created_at: string;
};
type DraftRecord = StoredRecord & {
  tenant_id: string;
  inquiry_id: string;
  inquiry_version: string;
  rule_set_key: string;
  rule_set_version: string;
  rule_hash: string;
  input_hash: string;
  calculation_hash: string;
  input: unknown;
  calculation: unknown;
  exceptions: unknown;
  status: string;
  approval_valid: boolean;
  approval_evidence_id?: string;
  exception_request_id?: string;
  idempotency_key: string;
  request_hash: string;
  created_at: string;
  updated_at: string;
};
export interface CreateDraftCommand {
  ruleSetKey: string;
  ruleSetVersion: string;
  input: QuoteInquiryInput;
}

export interface DraftView {
  id: string;
  inquiryId: string;
  inquiryVersion: string;
  status: string;
  executable: boolean;
  externalEffect: 'none';
  approvalValid: boolean;
  ruleSetRef: { key: string; version: string; hash: string };
  input: NormalizedQuoteInquiry;
  inputHash: string;
  calculationHash: string;
  calculation: QuoteCalculation;
  exceptions: QuoteEstimate['exceptions'];
  exceptionRequestId?: string;
  approvalEvidenceId?: string;
  createdAt: string;
  updatedAt: string;
}

type ApprovalRecord = StoredRecord & {
  tenant_id: string;
  draft_id: string;
  input_hash: string;
  rule_hash: string;
  calculation_hash: string;
  decision: 'approved' | 'rejected';
  status: 'approved' | 'rejected';
  envelope: unknown;
  envelope_hash: string;
  idempotency_key: string;
  request_hash: string;
  recorded_at: string;
};

type ExternalSendEvidenceRecord = StoredRecord & {
  tenant_id: string;
  draft_id: string;
  artifact_hash: string;
  status: 'submitted_unverified';
  envelope: unknown;
  envelope_hash: string;
  idempotency_key: string;
  request_hash: string;
  recorded_at: string;
};

function text(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalidQuote(`${label} is invalid`);
  return value.trim();
}

function jsonValue<T>(value: unknown, label: string): T {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
    if (parsed === null || typeof parsed !== 'object') throw new TypeError();
    return parsed as T;
  } catch {
    throw new QuotationError('quotation_integrity_error', `${label} is not valid structured data`, 503);
  }
}

function nowIso(clock: () => Date): string {
  return clock().toISOString();
}

function idempotencyKey(value: unknown): string {
  const key = text(value, 'Idempotency-Key', 128);
  if (key.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    invalidQuote('Idempotency-Key must contain 8-128 safe characters');
  }
  return key;
}

function requestConflict(): never {
  throw new QuotationError('idempotency_key_reused', 'Idempotency-Key was already used for a different request', 409);
}

function unavailable(message = 'Quotation persistence is unavailable'): never {
  throw new QuotationError('quotation_persistence_unavailable', message, 503);
}

export class QuotationService {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly dataStore: DataStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const queued = prior.catch(() => {}).then(() => gate);
    this.queues.set(key, queued);
    await prior.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.queues.get(key) === queued) this.queues.delete(key);
    }
  }

  private async findUnique<T extends StoredRecord>(
    collection: string,
    where: Record<string, string | number | boolean>,
    label: string,
  ): Promise<T | null> {
    const result = await this.dataStore.list<T>(collection, { where, page: 1, perPage: 2 });
    if (result.totalItems > 1 || result.items.length > 1) {
      throw new QuotationError('quotation_integrity_error', `Duplicate ${label} records; refusing an ambiguous decision`, 503);
    }
    return result.items[0] ?? null;
  }

  private async listAll<T extends StoredRecord>(
    collection: string,
    where: Record<string, string | number | boolean>,
    label: string,
  ): Promise<T[]> {
    const output: T[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const result = await this.dataStore.list<T>(collection, { where, page, perPage: 500 });
      output.push(...result.items);
      if (page >= result.totalPages || result.items.length === 0) return output;
    }
    throw new QuotationError('quotation_integrity_error', `${label} exceeds the safe review bound`, 503);
  }

  private async latestRuleVersion(record: RuleRecord): Promise<RuleRecord> {
    const versions = await this.listAll<RuleRecord>(QUOTATION_COLLECTIONS.rules, {
      tenant_id: record.tenant_id,
      rule_set_key: record.rule_set_key,
    }, 'rule set versions');
    const latest = versions.sort((left, right) => {
      const byTime = String(left.created_at).localeCompare(String(right.created_at));
      return byTime || left.id.localeCompare(right.id);
    }).at(-1);
    if (!latest) throw new QuotationError('quotation_integrity_error', 'Rule version disappeared during validation', 503);
    return latest;
  }

  private async tenantRecord<T extends StoredRecord & { tenant_id: string }>(
    collection: string,
    id: string,
    tenantId: string,
  ): Promise<T | null> {
    const record = await this.dataStore.getById<T>(collection, id);
    return record?.tenant_id === tenantId ? record : null;
  }

  private async ruleRecord(tenantId: string, key: string, version: string): Promise<RuleRecord> {
    const record = await this.findUnique<RuleRecord>(QUOTATION_COLLECTIONS.rules, {
      tenant_id: tenantId,
      rule_set_key: key,
      version,
    }, 'rule set version');
    if (!record) throw new QuotationError('quote_rule_set_not_found', 'Confirmed quote rule set was not found', 404);
    const normalized = normalizeQuoteRuleSet(jsonValue(record.rule_set, 'stored rule set'));
    const currentHash = evidenceHash(normalized);
    if (currentHash !== record.rule_hash || normalized.ruleSetKey !== key || normalized.version !== version) {
      throw new QuotationError('quotation_integrity_error', 'Stored rule set failed its evidence hash', 503);
    }
    if ((await this.latestRuleVersion(record)).id !== record.id) {
      throw new QuotationError('quote_rule_version_superseded', 'Only the latest confirmed quote rule version may create or approve a draft', 409);
    }
    return { ...record, rule_set: normalized };
  }

  private async invalidateDraftsForLatestRule(record: RuleRecord): Promise<void> {
    if ((await this.latestRuleVersion(record)).id !== record.id) return;
    const drafts = await this.listAll<DraftRecord>(QUOTATION_COLLECTIONS.drafts, {
      tenant_id: record.tenant_id,
      rule_set_key: record.rule_set_key,
    }, 'quote drafts for a rule set');
    for (const draft of drafts) {
      if (draft.rule_hash === record.rule_hash || ['superseded', 'expired'].includes(draft.status)) continue;
      const timestamp = nowIso(this.clock);
      if (!await this.dataStore.update(QUOTATION_COLLECTIONS.drafts, draft.id, {
        status: 'superseded',
        approval_valid: false,
        invalidation_reason: 'quote_rule_version_changed',
        superseded_by_rule_version: record.version,
        invalidated_at: timestamp,
        updated_at: timestamp,
      })) unavailable('Could not invalidate a draft bound to a superseded rule version');
    }
  }

  private async createOrRecover<T extends StoredRecord & { request_hash: string }>(
    collection: string,
    data: Record<string, unknown>,
    tenantId: string,
    key: string,
    requestHash: string,
    label: string,
  ): Promise<T> {
    const created = await this.dataStore.create<T>(collection, data);
    if (created) return created;
    // A database uniqueness race is a normal idempotent retry. Re-read once;
    // do not invent a second record or silently treat another payload as equal.
    const recovered = await this.findUnique<T>(collection, {
      tenant_id: tenantId,
      idempotency_key: key,
    }, label);
    if (!recovered) unavailable();
    if (recovered.request_hash !== requestHash) requestConflict();
    return recovered;
  }

  async createRuleSet(actor: ActorContext, rawRuleSet: unknown, rawKey: unknown) {
    const key = idempotencyKey(rawKey);
    const ruleSet = normalizeQuoteRuleSet(rawRuleSet);
    const ruleHash = evidenceHash(ruleSet);
    const requestHash = evidenceHash({ ruleSet });
    return this.serialized(`rule:${actor.tenantId}:${key}`, async () => {
      const priorKey = await this.findUnique<RuleRecord>(QUOTATION_COLLECTIONS.rules, {
        tenant_id: actor.tenantId,
        idempotency_key: key,
      }, 'rule idempotency');
      if (priorKey) {
        if (priorKey.request_hash !== requestHash) requestConflict();
        await this.invalidateDraftsForLatestRule(priorKey);
        return this.ruleView(priorKey);
      }

      const existingVersion = await this.findUnique<RuleRecord>(QUOTATION_COLLECTIONS.rules, {
        tenant_id: actor.tenantId,
        rule_set_key: ruleSet.ruleSetKey,
        version: ruleSet.version,
      }, 'rule set version');
      if (existingVersion) {
        if (existingVersion.rule_hash !== ruleHash) {
          throw new QuotationError('quote_rule_version_immutable', 'A rule version cannot be overwritten', 409);
        }
        throw new QuotationError('quote_rule_version_exists', 'This immutable rule version already exists; retry with its original Idempotency-Key', 409);
      }

      // starter_198 is deliberately one product / one logical rule-set key;
      // new immutable versions of that key remain allowed.
      const tenantRules = await this.listAll<RuleRecord>(QUOTATION_COLLECTIONS.rules, {
        tenant_id: actor.tenantId,
      }, 'starter_198 quote rule sets');
      if (tenantRules.some(item => item.rule_set_key !== ruleSet.ruleSetKey || item.product_id !== ruleSet.productId)) {
        throw new QuotationError('starter_198_rule_limit', 'starter_198 supports one product and one rule-set key', 409);
      }
      const createdAt = nowIso(this.clock);
      const created = await this.createOrRecover<RuleRecord>(QUOTATION_COLLECTIONS.rules, {
        tenant_id: actor.tenantId,
        rule_set_key: ruleSet.ruleSetKey,
        version: ruleSet.version,
        product_id: ruleSet.productId,
        status: 'confirmed',
        rule_hash: ruleHash,
        rule_set: ruleSet,
        idempotency_key: key,
        request_hash: requestHash,
        created_by: actor.userId,
        created_at: createdAt,
      }, actor.tenantId, key, requestHash, 'rule idempotency');
      await this.invalidateDraftsForLatestRule(created);
      return this.ruleView(created);
    });
  }

  async estimate(actor: ActorContext, command: CreateDraftCommand): Promise<QuoteEstimate> {
    const key = text(command.ruleSetKey, 'ruleSetKey', 80);
    const version = text(command.ruleSetVersion, 'ruleSetVersion', 80);
    const record = await this.ruleRecord(actor.tenantId, key, version);
    return calculateQuote(record.rule_set, command.input);
  }

  async createDraft(actor: ActorContext, command: CreateDraftCommand, rawKey: unknown): Promise<DraftView> {
    const key = idempotencyKey(rawKey);
    const ruleKey = text(command.ruleSetKey, 'ruleSetKey', 80);
    const ruleVersion = text(command.ruleSetVersion, 'ruleSetVersion', 80);
    const estimate = await this.estimate(actor, { ...command, ruleSetKey: ruleKey, ruleSetVersion: ruleVersion });
    if (estimate.status === 'missing_facts' || !estimate.calculation) {
      throw new QuotationError('quote_facts_missing', 'Required inquiry facts are missing; no calculation or draft was created', 422, estimate);
    }
    const calculation = estimate.calculation;
    const input = estimate.input as NormalizedQuoteInquiry;
    const requestHash = evidenceHash({
      ruleSetRef: estimate.ruleSetRef,
      inputHash: estimate.inputHash,
    });
    return this.serialized(`draft:${actor.tenantId}:${input.inquiryId}`, async () => {
      let draft = await this.findUnique<DraftRecord>(QUOTATION_COLLECTIONS.drafts, {
        tenant_id: actor.tenantId,
        idempotency_key: key,
      }, 'draft idempotency');
      if (draft) {
        if (draft.request_hash !== requestHash) requestConflict();
      } else {
        const timestamp = nowIso(this.clock);
        draft = await this.createOrRecover<DraftRecord>(QUOTATION_COLLECTIONS.drafts, {
          tenant_id: actor.tenantId,
          inquiry_id: input.inquiryId,
          inquiry_version: input.inquiryVersion,
          rule_set_key: estimate.ruleSetRef.key,
          rule_set_version: estimate.ruleSetRef.version,
          rule_hash: estimate.ruleSetRef.hash,
          input_hash: estimate.inputHash,
          calculation_hash: calculation.calculationHash,
          input,
          calculation,
          exceptions: estimate.exceptions,
          status: estimate.executable ? 'draft_ready' : 'exception_pending',
          approval_valid: false,
          idempotency_key: key,
          request_hash: requestHash,
          created_by: actor.userId,
          created_at: timestamp,
          updated_at: timestamp,
        }, actor.tenantId, key, requestHash, 'draft idempotency');
      }
      if (estimate.exceptions.length > 0) draft = await this.ensureExceptionRequest(actor, draft);
      draft = await this.invalidateChangedInput(actor.tenantId, draft);
      return this.draftView(draft);
    });
  }

  async getDraft(actor: ActorContext, id: string): Promise<DraftView> {
    let draft = await this.tenantRecord<DraftRecord>(QUOTATION_COLLECTIONS.drafts, id, actor.tenantId);
    if (!draft) throw new QuotationError('quote_draft_not_found', 'Quote draft was not found', 404);
    draft = await this.effectiveDraft(draft);
    return this.draftView(draft);
  }

  private async effectiveDraft(draft: DraftRecord): Promise<DraftRecord> {
    const versions = await this.listAll<DraftRecord>(QUOTATION_COLLECTIONS.drafts, {
      tenant_id: draft.tenant_id,
      inquiry_id: draft.inquiry_id,
    }, 'quote drafts for an inquiry');
    const latest = versions.sort((left, right) => {
      const byTime = String(left.created_at).localeCompare(String(right.created_at));
      return byTime || left.id.localeCompare(right.id);
    }).at(-1);
    const hasNewBinding = latest
      && latest.id !== draft.id
      && (latest.input_hash !== draft.input_hash || latest.rule_hash !== draft.rule_hash);
    if (hasNewBinding) return { ...draft, status: 'superseded', approval_valid: false };
    const rules = await this.listAll<RuleRecord>(QUOTATION_COLLECTIONS.rules, {
      tenant_id: draft.tenant_id,
      rule_set_key: draft.rule_set_key,
    }, 'rule versions for a quote draft');
    const latestRule = rules.sort((left, right) => {
      const byTime = String(left.created_at).localeCompare(String(right.created_at));
      return byTime || left.id.localeCompare(right.id);
    }).at(-1);
    if (!latestRule) throw new QuotationError('quotation_integrity_error', 'Bound rule set was not found', 503);
    return latestRule.rule_hash !== draft.rule_hash
      ? { ...draft, status: 'superseded', approval_valid: false }
      : draft;
  }

  private async ensureExceptionRequest(actor: ActorContext, draft: DraftRecord): Promise<DraftRecord> {
    if (draft.exception_request_id) return draft;
    const key = `exception:${draft.id}`;
    const requestHash = evidenceHash({ draftId: draft.id, inputHash: draft.input_hash, exceptions: draft.exceptions });
    let request = await this.findUnique<StoredRecord & { request_hash: string }>(QUOTATION_COLLECTIONS.exceptions, {
      tenant_id: actor.tenantId,
      draft_id: draft.id,
    }, 'exception request');
    if (!request) {
      request = await this.createOrRecover(QUOTATION_COLLECTIONS.exceptions, {
        tenant_id: actor.tenantId,
        draft_id: draft.id,
        inquiry_id: draft.inquiry_id,
        status: 'pending_internal_review',
        exceptions: draft.exceptions,
        input_hash: draft.input_hash,
        rule_hash: draft.rule_hash,
        calculation_hash: draft.calculation_hash,
        idempotency_key: key,
        request_hash: requestHash,
        requested_by: actor.userId,
        created_at: nowIso(this.clock),
      }, actor.tenantId, key, requestHash, 'exception request');
    } else if (request.request_hash !== requestHash) {
      throw new QuotationError('quotation_integrity_error', 'Exception request does not match its draft', 503);
    }
    const timestamp = nowIso(this.clock);
    if (!await this.dataStore.update(QUOTATION_COLLECTIONS.drafts, draft.id, {
      exception_request_id: request.id,
      updated_at: timestamp,
    })) unavailable('Could not bind the exception request to its draft');
    return { ...draft, exception_request_id: request.id, updated_at: timestamp };
  }

  private async invalidateChangedInput(tenantId: string, current: DraftRecord): Promise<DraftRecord> {
    const drafts = await this.listAll<DraftRecord>(QUOTATION_COLLECTIONS.drafts, {
      tenant_id: tenantId,
      inquiry_id: current.inquiry_id,
    }, 'quote drafts for an inquiry');
    const ordered = [...drafts].sort((left, right) => {
      const byTime = String(left.created_at).localeCompare(String(right.created_at));
      return byTime || left.id.localeCompare(right.id);
    });
    const winner = ordered.at(-1) ?? current;
    const sameBindingAsCurrent = winner.input_hash === current.input_hash && winner.rule_hash === current.rule_hash;
    if (!sameBindingAsCurrent && winner.id !== current.id) {
      const timestamp = nowIso(this.clock);
      if (!await this.dataStore.update(QUOTATION_COLLECTIONS.drafts, current.id, {
        status: 'superseded', approval_valid: false,
        invalidation_reason: winner.input_hash === current.input_hash ? 'quote_rule_version_changed' : 'inquiry_input_changed',
        superseded_by_id: winner.id, invalidated_at: timestamp, updated_at: timestamp,
      })) unavailable('Could not invalidate an obsolete quote draft');
      return { ...current, status: 'superseded', approval_valid: false, updated_at: timestamp };
    }
    for (const prior of drafts) {
      if (
        prior.id === current.id
        || (prior.input_hash === current.input_hash && prior.rule_hash === current.rule_hash)
        || ['superseded', 'expired'].includes(prior.status)
      ) continue;
      const timestamp = nowIso(this.clock);
      if (!await this.dataStore.update(QUOTATION_COLLECTIONS.drafts, prior.id, {
        status: 'superseded',
        approval_valid: false,
        invalidation_reason: prior.input_hash === current.input_hash ? 'quote_rule_version_changed' : 'inquiry_input_changed',
        superseded_by_id: current.id,
        invalidated_at: timestamp,
        updated_at: timestamp,
      })) unavailable('Could not invalidate an obsolete quote draft');
    }
    return current;
  }

  private async verifiedEstimateForDraft(actor: ActorContext, draft: DraftRecord): Promise<QuoteEstimate> {
    const rule = await this.ruleRecord(actor.tenantId, draft.rule_set_key, draft.rule_set_version);
    const estimate = calculateQuote(rule.rule_set, jsonValue<QuoteInquiryInput>(draft.input, 'stored quote input'));
    if (
      estimate.inputHash !== draft.input_hash
      || estimate.ruleSetRef.hash !== draft.rule_hash
      || !estimate.calculation
      || estimate.calculation.calculationHash !== draft.calculation_hash
    ) {
      throw new QuotationError('quote_draft_binding_invalid', 'Quote draft no longer matches its immutable commercial evidence', 409);
    }
    return estimate;
  }

  private async ensureNotExpired(draft: DraftRecord, calculation: QuoteCalculation): Promise<void> {
    if (this.clock().toISOString().slice(0, 10) <= calculation.validUntil) return;
    const timestamp = nowIso(this.clock);
    if (!await this.dataStore.update(QUOTATION_COLLECTIONS.drafts, draft.id, {
      status: 'expired', approval_valid: false, invalidation_reason: 'quote_validity_expired',
      invalidated_at: timestamp, updated_at: timestamp,
    })) unavailable('Could not expire an obsolete quotation');
    throw new QuotationError('quote_draft_expired', 'Quote draft validity period has expired', 409);
  }

  async decideDraft(
    actor: ActorContext,
    id: string,
    rawKey: unknown,
    decisionValue: unknown,
    noteValue?: unknown,
    expectedInputHash?: string,
  ) {
    const key = idempotencyKey(rawKey);
    if (decisionValue !== 'approved' && decisionValue !== 'rejected') {
      invalidQuote('decision must be approved or rejected');
    }
    const decision = decisionValue;
    const note = noteValue === undefined || noteValue === null || noteValue === ''
      ? ''
      : text(noteValue, 'decisionNote', 1000);
    if (decision === 'rejected' && !note) invalidQuote('decisionNote is required when returning a quote');
    return this.serialized(`quote-decision:${actor.tenantId}:${id}`, async () => {
      let draft = await this.tenantRecord<DraftRecord>(QUOTATION_COLLECTIONS.drafts, id, actor.tenantId);
      if (!draft) throw new QuotationError('quote_draft_not_found', 'Quote draft was not found', 404);
      draft = await this.effectiveDraft(draft);
      if (expectedInputHash !== undefined && draft.input_hash !== expectedInputHash) {
        throw new QuotationError('quote_draft_changed', 'Quote draft changed after it was displayed', 409);
      }
      const requestHash = evidenceHash({
        draftId: draft.id,
        inputHash: draft.input_hash,
        ruleHash: draft.rule_hash,
        calculationHash: draft.calculation_hash,
        decision,
        note,
      });
      const priorKey = await this.findUnique<ApprovalRecord>(QUOTATION_COLLECTIONS.approvals, {
        tenant_id: actor.tenantId, idempotency_key: key,
      }, 'quote decision idempotency');
      if (priorKey) {
        if (priorKey.request_hash !== requestHash || priorKey.draft_id !== draft.id) requestConflict();
        this.assertEvidenceIntegrity(priorKey);
        if (draft.status === 'draft_ready' && !draft.approval_evidence_id) {
          const estimate = await this.verifiedEstimateForDraft(actor, draft);
          if (!estimate.executable || !estimate.calculation) {
            throw new QuotationError('quote_exception_required', 'Quote has unresolved rule exceptions', 409);
          }
          const evidenceDay = priorKey.recorded_at.slice(0, 10);
          if (evidenceDay > estimate.calculation.validUntil) {
            throw new QuotationError('quotation_integrity_error', 'Approval evidence was recorded after quote expiry', 503);
          }
          const timestamp = nowIso(this.clock);
          const recoveredStatus = priorKey.decision === 'approved' ? 'approved' : 'returned';
          const recoveredApprovalValid = priorKey.decision === 'approved';
          if (!await this.dataStore.update(QUOTATION_COLLECTIONS.drafts, draft.id, {
            status: recoveredStatus, approval_valid: recoveredApprovalValid, approval_evidence_id: priorKey.id,
            decided_at: priorKey.recorded_at, updated_at: timestamp,
          })) unavailable('Could not recover the decided quote state');
          draft = { ...draft, status: recoveredStatus, approval_valid: recoveredApprovalValid, approval_evidence_id: priorKey.id, updated_at: timestamp };
        }
        return { draft: this.draftView(draft), evidence: this.decisionView(priorKey, draft) };
      }
      if (draft.status !== 'draft_ready' || draft.approval_valid) {
        throw new QuotationError('quote_draft_not_approvable', 'Only a current, unapproved draft can be approved', 409);
      }
      const estimate = await this.verifiedEstimateForDraft(actor, draft);
      if (!estimate.executable || !estimate.calculation || estimate.exceptions.length > 0) {
        throw new QuotationError('quote_exception_required', 'Quote has unresolved rule exceptions', 409, estimate.exceptions);
      }
      await this.ensureNotExpired(draft, estimate.calculation);
      const existing = await this.findUnique<ApprovalRecord>(QUOTATION_COLLECTIONS.approvals, {
        tenant_id: actor.tenantId, draft_id: draft.id,
      }, 'quote approval evidence');
      if (existing) throw new QuotationError('quote_draft_already_decided', 'Quote draft already has immutable decision evidence', 409);

      const recordedAt = nowIso(this.clock);
      const envelope = {
        schemaVersion: 'EvidenceEnvelopeV1',
        action: 'quote_draft_decision',
        decision,
        subject: {
          type: 'quote_draft', id: draft.id,
          inquiryId: draft.inquiry_id, inquiryVersion: draft.inquiry_version,
        },
        binding: {
          inputHash: draft.input_hash,
          ruleSetKey: draft.rule_set_key,
          ruleSetVersion: draft.rule_set_version,
          ruleHash: draft.rule_hash,
          fxSnapshotId: estimate.calculation.fxSnapshot.id,
          calculationHash: draft.calculation_hash,
          marginBps: estimate.calculation.marginBps,
          validUntil: estimate.calculation.validUntil,
        },
        actor: { userId: actor.userId, role: actor.role },
        note,
        recordedAt,
      };
      const evidence = await this.createOrRecover<ApprovalRecord>(QUOTATION_COLLECTIONS.approvals, {
        tenant_id: actor.tenantId,
        draft_id: draft.id,
        input_hash: draft.input_hash,
        rule_hash: draft.rule_hash,
        calculation_hash: draft.calculation_hash,
        decision,
        status: decision,
        envelope,
        envelope_hash: evidenceHash(envelope),
        idempotency_key: key,
        request_hash: requestHash,
        recorded_at: recordedAt,
      }, actor.tenantId, key, requestHash, 'quote decision idempotency');
      const decidedStatus = decision === 'approved' ? 'approved' : 'returned';
      const approvalValid = decision === 'approved';
      if (!await this.dataStore.update(QUOTATION_COLLECTIONS.drafts, draft.id, {
        status: decidedStatus, approval_valid: approvalValid, approval_evidence_id: evidence.id,
        decided_at: recordedAt, updated_at: recordedAt,
      })) unavailable('Could not bind decision evidence to its quote draft');
      draft = { ...draft, status: decidedStatus, approval_valid: approvalValid, approval_evidence_id: evidence.id, updated_at: recordedAt };
      return { draft: this.draftView(draft), evidence: this.decisionView(evidence, draft) };
    });
  }

  async approveDraft(actor: ActorContext, id: string, rawKey: unknown, noteValue?: unknown) {
    return this.decideDraft(actor, id, rawKey, 'approved', noteValue);
  }

  async recordExternalSendEvidence(
    actor: ActorContext,
    draftId: string,
    rawKey: unknown,
    values: { channel?: unknown; artifactHash?: unknown; providerReference?: unknown },
    expectedInputHash?: string,
  ) {
    const key = idempotencyKey(rawKey);
    const channel = text(values.channel, 'channel', 80);
    const artifactHash = text(values.artifactHash, 'artifactHash', 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(artifactHash)) invalidQuote('artifactHash must be a SHA-256 hex digest');
    const providerReference = values.providerReference === undefined || values.providerReference === null || values.providerReference === ''
      ? ''
      : text(values.providerReference, 'providerReference', 240);
    return this.serialized(`quote-send-evidence:${actor.tenantId}:${draftId}`, async () => {
      let draft = await this.tenantRecord<DraftRecord>(QUOTATION_COLLECTIONS.drafts, draftId, actor.tenantId);
      if (!draft) throw new QuotationError('quote_draft_not_found', 'Quote draft was not found', 404);
      draft = await this.effectiveDraft(draft);
      if (expectedInputHash !== undefined && draft.input_hash !== expectedInputHash) {
        throw new QuotationError('quote_draft_changed', 'Quote draft changed after it was displayed', 409);
      }
      const requestHash = evidenceHash({ draftId, inputHash: draft.input_hash, calculationHash: draft.calculation_hash, channel, artifactHash, providerReference });
      const prior = await this.findUnique<ExternalSendEvidenceRecord>(QUOTATION_COLLECTIONS.externalSendEvidence, {
        tenant_id: actor.tenantId, idempotency_key: key,
      }, 'external send evidence idempotency');
      if (prior) {
        if (prior.request_hash !== requestHash || prior.draft_id !== draft.id) requestConflict();
        this.assertEvidenceIntegrity(prior);
        return this.externalEvidenceView(prior, draft);
      }
      if (draft.status !== 'approved' || !draft.approval_valid || !draft.approval_evidence_id) {
        throw new QuotationError('quote_manual_send_evidence_not_allowed', 'Current quote approval is required before evidence can be submitted', 409);
      }
      const estimate = await this.verifiedEstimateForDraft(actor, draft);
      if (!estimate.executable || !estimate.calculation) throw new QuotationError('quote_manual_send_evidence_not_allowed', 'Quote is not executable', 409);
      await this.ensureNotExpired(draft, estimate.calculation);
      const duplicateArtifact = await this.findUnique<ExternalSendEvidenceRecord>(QUOTATION_COLLECTIONS.externalSendEvidence, {
        tenant_id: actor.tenantId, draft_id: draft.id, artifact_hash: artifactHash,
      }, 'external send artifact');
      if (duplicateArtifact) throw new QuotationError('quote_send_evidence_already_recorded', 'This evidence artifact is already recorded', 409);

      const recordedAt = nowIso(this.clock);
      const envelope = {
        schemaVersion: 'EvidenceEnvelopeV1',
        action: 'external_manual_send_evidence_submission',
        status: 'submitted_unverified',
        subject: { type: 'quote_draft', id: draft.id },
        binding: {
          inputHash: draft.input_hash,
          ruleHash: draft.rule_hash,
          calculationHash: draft.calculation_hash,
          approvalEvidenceId: draft.approval_evidence_id,
        },
        artifact: { channel, sha256: artifactHash, providerReference },
        actor: { userId: actor.userId, role: actor.role },
        recordedAt,
      };
      const evidence = await this.createOrRecover<ExternalSendEvidenceRecord>(QUOTATION_COLLECTIONS.externalSendEvidence, {
        tenant_id: actor.tenantId,
        draft_id: draft.id,
        artifact_hash: artifactHash,
        status: 'submitted_unverified',
        envelope,
        envelope_hash: evidenceHash(envelope),
        idempotency_key: key,
        request_hash: requestHash,
        recorded_at: recordedAt,
      }, actor.tenantId, key, requestHash, 'external send evidence idempotency');
      // This is a user's evidence assertion only: no provider call and no draft/send status mutation.
      return this.externalEvidenceView(evidence, draft);
    });
  }

  private assertEvidenceIntegrity(record: ApprovalRecord | ExternalSendEvidenceRecord): void {
    if (evidenceHash(jsonValue(record.envelope, 'stored evidence envelope')) !== record.envelope_hash) {
      throw new QuotationError('quotation_integrity_error', 'Stored evidence failed its immutable hash', 503);
    }
  }

  private decisionView(record: ApprovalRecord, draft: DraftRecord) {
    this.assertEvidenceIntegrity(record);
    const currentlyEffective = draft.approval_evidence_id === record.id
      && ((record.decision === 'approved' && draft.status === 'approved')
        || (record.decision === 'rejected' && draft.status === 'returned'));
    return {
      id: record.id,
      status: record.status,
      decision: record.decision,
      currentlyEffective,
      currentlyValid: record.decision === 'approved' && draft.status === 'approved'
        && Boolean(draft.approval_valid)
        && draft.approval_evidence_id === record.id,
      envelope: jsonValue<Record<string, unknown>>(record.envelope, 'stored approval envelope'),
      evidenceHash: record.envelope_hash,
      recordedAt: record.recorded_at,
      externalEffect: 'none' as const,
    };
  }

  private externalEvidenceView(record: ExternalSendEvidenceRecord, draft: DraftRecord) {
    this.assertEvidenceIntegrity(record);
    return {
      id: record.id,
      status: 'submitted_unverified' as const,
      verified: false as const,
      currentlyBound: draft.status === 'approved' && Boolean(draft.approval_valid),
      envelope: jsonValue<Record<string, unknown>>(record.envelope, 'stored external-send evidence envelope'),
      evidenceHash: record.envelope_hash,
      recordedAt: record.recorded_at,
      providerInvoked: false as const,
      externalEffect: 'reported_by_user' as const,
      draftStatusChanged: false as const,
    };
  }

  private ruleView(record: RuleRecord) {
    return {
      id: record.id,
      key: record.rule_set_key,
      version: record.version,
      productId: record.product_id,
      status: 'confirmed',
      ruleHash: record.rule_hash,
      ruleSet: jsonValue<QuoteRuleSetInput>(record.rule_set, 'stored rule set'),
      createdAt: record.created_at,
    };
  }

  private draftView(record: DraftRecord): DraftView {
    const calculation = jsonValue<QuoteCalculation>(record.calculation, 'stored calculation');
    if (calculation.calculationHash !== record.calculation_hash) {
      throw new QuotationError('quotation_integrity_error', 'Stored calculation hash field is inconsistent', 503);
    }
    return {
      id: record.id,
      inquiryId: record.inquiry_id,
      inquiryVersion: record.inquiry_version,
      status: record.status,
      executable: record.status !== 'exception_pending' && record.status !== 'superseded' && record.status !== 'expired',
      externalEffect: 'none',
      approvalValid: Boolean(record.approval_valid),
      ruleSetRef: { key: record.rule_set_key, version: record.rule_set_version, hash: record.rule_hash },
      input: jsonValue<NormalizedQuoteInquiry>(record.input, 'stored quote input'),
      inputHash: record.input_hash,
      calculationHash: record.calculation_hash,
      calculation,
      exceptions: jsonValue<QuoteEstimate['exceptions']>(record.exceptions, 'stored quote exceptions'),
      ...(record.exception_request_id ? { exceptionRequestId: record.exception_request_id } : {}),
      ...(record.approval_evidence_id ? { approvalEvidenceId: record.approval_evidence_id } : {}),
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    };
  }

}

export { idempotencyKey as normalizeQuotationIdempotencyKey };
