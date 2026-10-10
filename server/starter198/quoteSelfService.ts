import { createHash } from 'node:crypto';
import type {
  Starter198OrgRole,
  Starter198QuoteInquiryInput,
  Starter198QuoteRuleSetupInput,
} from '../../shared/contracts/starter198.js';
import { evidenceHash } from '../quotation/canonical.js';
import { normalizeQuoteRuleSet } from '../quotation/engine.js';
import { QuotationError } from '../quotation/errors.js';
import { decimalToString, parseExactDecimal } from '../quotation/fixedDecimal.js';
import { QuotationService } from '../quotation/service.js';
import type { QuoteRuleSetInput } from '../quotation/types.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { buildStarter198CapabilityManifest, starter198CapabilityAllowed } from './profile.js';
import {
  createStarter198Repository,
  STARTER_COLLECTIONS,
  Starter198RepositoryError,
  starter198Repository,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import { assertQuoteDraftQuota, Starter198QuotaError, withStarterQuotaScope } from './quota.js';
import {
  notifyStarterQuoteArtifactsReady,
  StarterQuoteArtifactWakeupError,
} from './quoteArtifactWakeup.js';
import {
  persistStarterQuoteDraftLineage,
  resolveActiveStarterQuoteWorkflowBinding,
  starterQuoteInquiryLineageHash,
  starterQuoteInquiryRequestHash,
  starterQuoteInquiryStorageFields,
  type StarterQuoteWorkflowBinding,
} from './quoteLineage.js';
import {
  Starter198RuntimePortError,
  type Starter198QuoteSelfServicePort,
} from './runtimePorts.js';

const RULE_SET_KEY = 'starter-default';
const SOURCE_CHANNELS = new Set<Starter198QuoteInquiryInput['sourceChannel']>([
  'manual', 'whatsapp', 'email', 'trade_show', 'other',
]);
const INCOTERMS = new Set<Starter198QuoteRuleSetupInput['incoterm']>(['EXW', 'FOB', 'CIF', 'DDP']);
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

function object(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]));
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function decimal(value: unknown, label: string, positive = false): string {
  const normalized = text(value);
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/.test(normalized)
    || (positive && Number(normalized) <= 0)) {
    throw new Starter198RuntimePortError(`starter_198_quote_rule_${label}_invalid`, 400);
  }
  // Store the same canonical fixed-point representation used by the quote
  // engine. Otherwise 12.50 and 12.5 would create different immutable rules.
  return decimalToString(parseExactDecimal(normalized, label));
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Starter198RuntimePortError(`starter_198_quote_${label}_invalid`, 400);
  }
  return value;
}

function actorRole(role: Starter198OrgRole): 'super_admin' | 'admin' | 'customer_service' {
  return role === 'owner' ? 'super_admin' : role === 'customer_service' ? 'customer_service' : 'admin';
}

function ruleSetup(input: Starter198QuoteRuleSetupInput): Starter198QuoteRuleSetupInput {
  const sku = text(input.sku).toUpperCase();
  const currency = text(input.currency).toUpperCase();
  const incoterm = text(input.incoterm).toUpperCase() as Starter198QuoteRuleSetupInput['incoterm'];
  const paymentTerm = text(input.paymentTerm);
  const sourceReference = text(input.sourceReference);
  if (!/^[A-Z0-9][A-Z0-9._-]{1,79}$/.test(sku)
    || !/^[A-Z]{3}$/.test(currency)
    || !INCOTERMS.has(incoterm)
    || !paymentTerm || paymentTerm.length > 120
    || !sourceReference || sourceReference.length > 160 || /[\u0000-\u001f]/.test(sourceReference)) {
    throw new Starter198RuntimePortError('starter_198_quote_rule_invalid', 400);
  }
  return {
    sku,
    currency,
    unitPrice: decimal(input.unitPrice, 'unit_price', true),
    unitCost: decimal(input.unitCost, 'unit_cost'),
    moq: integer(input.moq, 'rule_moq', 1, 1_000_000),
    incoterm,
    shippingFlatFee: decimal(input.shippingFlatFee, 'shipping_fee'),
    taxRateBps: integer(input.taxRateBps, 'rule_tax_rate', 0, 10_000),
    paymentTerm,
    leadTimeDays: integer(input.leadTimeDays, 'rule_lead_time', 1, 365),
    validDays: integer(input.validDays, 'rule_valid_days', 1, 90),
    minMarginBps: integer(input.minMarginBps, 'rule_min_margin', 0, 10_000),
    sourceReference,
  };
}

function semanticRule(rule: QuoteRuleSetInput): Record<string, unknown> | null {
  if (rule.skuRules.length !== 1) return null;
  const sku = rule.skuRules[0];
  if (sku.quantityTiers.length !== 1 || sku.incoterms.length !== 1
    || sku.shippingRules.length !== 1 || sku.allowedPaymentTerms.length !== 1) return null;
  return {
    sku: sku.sku,
    currency: rule.baseCurrency,
    unitPrice: sku.quantityTiers[0].unitPrice,
    unitCost: sku.unitCost,
    moq: sku.moq,
    incoterm: sku.incoterms[0].code,
    shippingFlatFee: sku.shippingRules[0].flatFee,
    taxRateBps: sku.taxRateBps,
    paymentTerm: sku.allowedPaymentTerms[0],
    leadTimeDays: sku.standardLeadTimeDays,
    validDays: sku.validDays,
    minMarginBps: sku.minMarginBps,
    sourceReference: rule.sourceRefs[0] || '',
  };
}

function ruleFromRecord(record: StarterRecord): QuoteRuleSetInput {
  const raw = object(record.rule_set);
  if (!raw) throw new Starter198RuntimePortError('starter_198_quote_rule_integrity', 503);
  try {
    const normalized = normalizeQuoteRuleSet(raw);
    if (normalized.ruleSetKey !== text(record.rule_set_key)
      || normalized.version !== text(record.version)
      || normalized.productId !== text(record.product_id)
      || evidenceHash(normalized) !== text(record.rule_hash)) {
      throw new Starter198RuntimePortError('starter_198_quote_rule_integrity', 503);
    }
    return normalized;
  } catch (error) {
    if (error instanceof Starter198RuntimePortError) throw error;
    throw new Starter198RuntimePortError('starter_198_quote_rule_integrity', 503);
  }
}

async function listRules(repository: Starter198Repository, tenantId: string): Promise<StarterRecord[]> {
  const result = await repository.list(STARTER_COLLECTIONS.quoteRuleSets, tenantId, {
    sort: '-created_at', perPage: 500,
  });
  if (result.totalItems > result.items.length) {
    throw new Starter198RuntimePortError('starter_198_quote_rule_list_incomplete', 503);
  }
  // PocketBase does not promise a stable order for equal timestamps. Rule
  // creation can legitimately share one clock tick, so use the immutable id
  // as a deterministic tie-breaker just like QuotationService does.
  return [...result.items].sort((left, right) => (
    text(right.created_at).localeCompare(text(left.created_at))
      || text(right.id).localeCompare(text(left.id))
  ));
}

function nextVersion(records: StarterRecord[]): string {
  const versions = new Set(records.map(record => text(record.version)));
  let value = 1;
  while (versions.has(`v${value}`)) value += 1;
  return `v${value}`;
}

function ruleSetFromSetup(setup: Starter198QuoteRuleSetupInput, version: string, now: Date): QuoteRuleSetInput {
  return normalizeQuoteRuleSet({
    schemaVersion: '1.0',
    ruleSetKey: RULE_SET_KEY,
    version,
    status: 'confirmed',
    productId: setup.sku,
    baseCurrency: setup.currency,
    fxSnapshot: {
      id: `starter-${setup.currency}-${version}`,
      asOf: now.toISOString().slice(0, 10),
      rates: { [setup.currency]: '1' },
      sourceRefs: [setup.sourceReference],
    },
    skuRules: [{
      sku: setup.sku,
      requiredSpecifications: {},
      moq: setup.moq,
      quantityTiers: [{ minQuantity: setup.moq, unitPrice: setup.unitPrice }],
      unitCost: setup.unitCost,
      incoterms: [{ code: setup.incoterm, flatFee: '0', leadTimeDays: setup.leadTimeDays }],
      shippingRules: [{ destinationCountry: '*', incoterm: setup.incoterm, flatFee: setup.shippingFlatFee }],
      taxRateBps: setup.taxRateBps,
      taxBasis: 'goods_and_shipping',
      allowedPaymentTerms: [setup.paymentTerm],
      standardLeadTimeDays: setup.leadTimeDays,
      maxDiscountBps: 0,
      minMarginBps: setup.minMarginBps,
      validDays: setup.validDays,
    }],
    sourceRefs: [setup.sourceReference],
  });
}

async function ensureQuotationAccess(repository: Starter198Repository, tenantId: string, now: Date) {
  const access = await repository.access(tenantId);
  const manifest = buildStarter198CapabilityManifest(access, now);
  if (!starter198CapabilityAllowed(manifest, 'quotation.calculate')) {
    throw new Starter198RuntimePortError('starter_198_quotation_not_entitled', 403);
  }
  return access;
}

function inquiryInput(value: Starter198QuoteInquiryInput): Starter198QuoteInquiryInput {
  const sourceChannel = text(value.sourceChannel).toLowerCase() as Starter198QuoteInquiryInput['sourceChannel'];
  const sourceReference = text(value.sourceReference);
  const destinationCountry = text(value.destinationCountry).toUpperCase();
  if (!SOURCE_CHANNELS.has(sourceChannel)
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$/.test(sourceReference)
    // A raw phone number is contact data, not an opaque source reference.
    // Numeric provider ids remain usable when namespaced (for example wa:123).
    || !/[A-Za-z]/.test(sourceReference)
    || !/^[A-Z]{2}$/.test(destinationCountry)) {
    throw new Starter198RuntimePortError('starter_198_quote_inquiry_invalid', 400);
  }
  return {
    sourceChannel,
    sourceReference,
    quantity: integer(value.quantity, 'inquiry_quantity', 1, 1_000_000),
    destinationCountry,
  };
}

async function createOrRecoverInquiry(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  inquiryId: string;
  inquiryVersion: string;
  inquiry: Starter198QuoteInquiryInput;
  sku: string;
  sourceReferenceHash: string;
  requestHash: string;
  idempotencyKey: string;
  now: Date;
  binding?: StarterQuoteWorkflowBinding | null;
}): Promise<{ record: StarterRecord; created: boolean }> {
  const findByKey = async () => input.repository.list(STARTER_COLLECTIONS.quoteInquiries, input.tenantId, {
    where: { idempotency_key: input.idempotencyKey }, perPage: 2,
  });
  const findBySource = async () => input.repository.list(STARTER_COLLECTIONS.quoteInquiries, input.tenantId, {
    where: {
      source_channel: input.inquiry.sourceChannel,
      source_reference_hash: input.sourceReferenceHash,
      inquiry_version: input.inquiryVersion,
    },
    perPage: 2,
  });
  const assertSingle = (result: { totalItems: number; items: StarterRecord[] }) => {
    if (result.totalItems > 1 || result.items.length > 1) {
      throw new Starter198RuntimePortError('starter_198_quote_inquiry_integrity', 503);
    }
    return result.items[0] ?? null;
  };
  const assertSame = (record: StarterRecord): StarterRecord => {
    if (text(record.request_hash) !== input.requestHash
      || text(record.inquiry_id) !== input.inquiryId
      || text(record.inquiry_version) !== input.inquiryVersion
      || text(record.source_reference_hash) !== input.sourceReferenceHash
      || text(record.sku) !== input.sku
      || (input.binding && Object.entries(starterQuoteInquiryStorageFields({
        tenantId: input.tenantId,
        identity: {
          inquiryId: input.inquiryId,
          inquiryVersion: input.inquiryVersion,
          sourceChannel: input.inquiry.sourceChannel,
          sourceReferenceHash: input.sourceReferenceHash,
          sku: input.sku,
          quantity: input.inquiry.quantity,
          destinationCountry: input.inquiry.destinationCountry,
        },
        requestHash: input.requestHash,
        binding: input.binding,
      })).some(([key, value]) => record[key] !== value))) {
      throw new Starter198RuntimePortError('starter_198_quote_inquiry_idempotency_conflict', 409);
    }
    return record;
  };
  const priorByKey = assertSingle(await findByKey());
  const priorBySource = assertSingle(await findBySource());
  if (priorByKey && priorBySource && priorByKey.id !== priorBySource.id) {
    throw new Starter198RuntimePortError('starter_198_quote_inquiry_integrity', 503);
  }
  const prior = priorByKey ?? priorBySource;
  if (prior) {
    return { record: assertSame(prior), created: false };
  }
  try {
    const record = await input.repository.create(STARTER_COLLECTIONS.quoteInquiries, input.tenantId, {
      inquiry_id: input.inquiryId,
      inquiry_version: input.inquiryVersion,
      source_channel: input.inquiry.sourceChannel,
      source_reference_hash: input.sourceReferenceHash,
      source_reference_hint: `${input.inquiry.sourceChannel}:${input.sourceReferenceHash.slice(0, 10)}`,
      source_type: 'manual_structured',
      sku: input.sku,
      quantity: input.inquiry.quantity,
      destination_country: input.inquiry.destinationCountry,
      test_record: false,
      status: 'received',
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      created_by: input.userId,
      created_at: input.now.toISOString(),
      ...(input.binding ? starterQuoteInquiryStorageFields({
        tenantId: input.tenantId,
        identity: {
          inquiryId: input.inquiryId,
          inquiryVersion: input.inquiryVersion,
          sourceChannel: input.inquiry.sourceChannel,
          sourceReferenceHash: input.sourceReferenceHash,
          sku: input.sku,
          quantity: input.inquiry.quantity,
          destinationCountry: input.inquiry.destinationCountry,
        },
        requestHash: input.requestHash,
        binding: input.binding,
      }) : {}),
    });
    return { record, created: true };
  } catch (error) {
    if (!(error instanceof Starter198RepositoryError)) throw error;
    const racedByKey = assertSingle(await findByKey());
    const racedBySource = assertSingle(await findBySource());
    if (racedByKey && racedBySource && racedByKey.id !== racedBySource.id) {
      throw new Starter198RuntimePortError('starter_198_quote_inquiry_integrity', 503);
    }
    const record = racedByKey ?? racedBySource;
    if (!record) {
      throw new Starter198RuntimePortError('starter_198_quote_inquiry_storage_unavailable', 503);
    }
    return { record: assertSame(record), created: false };
  }
}

function recordDate(record: StarterRecord, label: string): string {
  const value = text(record.created_at);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Starter198RuntimePortError(`starter_198_quote_${label}_integrity`, 503);
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

export function createStarter198QuoteSelfServicePort(input: {
  dataStore?: DataStore;
  repository?: Starter198Repository;
  quotationService?: QuotationService;
  now?: () => Date;
} = {}): Starter198QuoteSelfServicePort {
  const dataStore = input.dataStore ?? store;
  const repository = input.repository ?? (input.dataStore
    ? createStarter198Repository(input.dataStore)
    : starter198Repository);
  const now = input.now ?? (() => new Date());
  // QuotationService defines "latest" by created_at/id. Keep timestamps
  // strictly monotonic inside this runtime so two confirmations in one clock
  // tick cannot leave a newly confirmed rule behind a random database id.
  let lastQuotationTime = Number.NEGATIVE_INFINITY;
  const quotationClock = () => {
    const candidate = now().getTime();
    const timestamp = Number.isFinite(candidate)
      ? Math.max(candidate, lastQuotationTime + 1)
      : candidate;
    lastQuotationTime = timestamp;
    return new Date(timestamp);
  };
  const quotation = input.quotationService ?? new QuotationService(dataStore, quotationClock);
  return {
    async confirmRule(command) {
      try {
        const at = now();
        await ensureQuotationAccess(repository, command.tenantId, at);
        const setup = ruleSetup(command.setup);
        return await withStarterQuotaScope(`quote-rule:${command.tenantId}`, async () => {
          const rules = await listRules(repository, command.tenantId);
          const latestRecord = rules[0];
          if (latestRecord) {
            const latestRule = ruleFromRecord(latestRecord);
            if (hash(semanticRule(latestRule)) === hash(setup)) {
              return {
                ruleSetKey: latestRule.ruleSetKey,
                ruleSetVersion: latestRule.version,
                sku: latestRule.skuRules[0].sku,
                created: false,
              };
            }
          }
          const ruleSet = ruleSetFromSetup(setup, nextVersion(rules), at);
          const created = await quotation.createRuleSet({
            tenantId: command.tenantId,
            userId: command.userId,
            role: actorRole(command.role),
          }, ruleSet, `starter-rule:${hash(ruleSet).slice(0, 48)}`);
          return {
            ruleSetKey: created.key,
            ruleSetVersion: created.version,
            sku: ruleSet.skuRules[0].sku,
            created: true,
          };
        });
      } catch (error) {
        if (error instanceof Starter198RuntimePortError) throw error;
        if (error instanceof QuotationError) throw new Starter198RuntimePortError(error.code, error.status);
        if (error instanceof Starter198RepositoryError) {
          throw new Starter198RuntimePortError(error.code, error.code === 'starter_198_not_provisioned' ? 403 : 503);
        }
        throw new Starter198RuntimePortError('starter_198_quote_rule_unavailable', 503);
      }
    },

    async submitInquiry(command) {
      try {
        const at = now();
        const access = await ensureQuotationAccess(repository, command.tenantId, at);
        const binding = await resolveActiveStarterQuoteWorkflowBinding({
          repository, tenantId: command.tenantId, access,
        });
        const inquiry = inquiryInput(command.inquiry);
        const rules = await listRules(repository, command.tenantId);
        const latest = rules[0];
        if (!latest) throw new Starter198RuntimePortError('starter_198_quote_rule_required', 409);
        const rule = ruleFromRecord(latest);
        const semantic = semanticRule(rule);
        if (!semantic) throw new Starter198RuntimePortError('starter_198_quote_rule_not_standard', 409);
        const sku = rule.skuRules[0];
        const sourceHash = hash({ tenantId: command.tenantId, channel: inquiry.sourceChannel, reference: inquiry.sourceReference });
        const inquiryId = `inq_${sourceHash.slice(0, 24)}`;
        // A billing/operation-cycle rollover is an explicit new quotation
        // version; retries within one cycle remain identical across dates.
        const inquiryVersion = `v_${hash({
          quantity: inquiry.quantity,
          destinationCountry: inquiry.destinationCountry,
          cycleStartedAt: access.cycleStartedAt,
          ...(binding ? { runId: binding.runId } : {}),
        }).slice(0, 16)}`;
        const inquiryIdentity = {
          inquiryId,
          inquiryVersion,
          sourceChannel: inquiry.sourceChannel,
          sourceReferenceHash: sourceHash,
          sku: sku.sku,
          quantity: inquiry.quantity,
          destinationCountry: inquiry.destinationCountry,
        };
        const inquiryRequestHash = starterQuoteInquiryRequestHash({
          identity: inquiryIdentity,
          binding,
        });
        const inquiryKey = `starter-inquiry:${inquiryRequestHash.slice(0, 48)}`;
        const draftRequestHash = hash({ inquiryRequestHash, ruleHash: text(latest.rule_hash) });
        const draftKey = `starter-inquiry-draft:${draftRequestHash.slice(0, 40)}`;
        return await withStarterQuotaScope(`quote:${command.tenantId}:${access.entitlementSnapshotId}`, async () => {
          const existingDraft = await repository.list(STARTER_COLLECTIONS.quoteDrafts, command.tenantId, {
            where: { idempotency_key: draftKey }, perPage: 2,
          });
          if (existingDraft.totalItems > 1 || existingDraft.items.length > 1) {
            throw new Starter198RuntimePortError('starter_198_quote_draft_integrity', 503);
          }
          await assertQuoteDraftQuota({
            repository,
            tenantId: command.tenantId,
            cycleStartedAt: access.cycleStartedAt,
            cycleEndsAt: access.cycleEndsAt,
            limits: access.resourceLimits,
            idempotencyKey: draftKey,
            now: at,
          });
          // Provenance is persisted only after admission. A tenant at quota
          // cannot create an unbounded trail of orphan inquiry records.
          const source = await createOrRecoverInquiry({
            repository,
            tenantId: command.tenantId,
            userId: command.userId,
            inquiryId,
            inquiryVersion,
            inquiry,
            sku: sku.sku,
            sourceReferenceHash: sourceHash,
            requestHash: inquiryRequestHash,
            idempotencyKey: inquiryKey,
            now: at,
            binding,
          });
          // The business date is bound to persisted provenance/rule records,
          // not the retry wall clock. Replaying tomorrow must return the same
          // deterministic draft instead of conflicting on the input hash.
          const quoteDate = [recordDate(source.record, 'inquiry'), recordDate(latest, 'rule')]
            .sort().at(-1) as string;
          const draft = await quotation.createDraft({
            tenantId: command.tenantId,
            userId: command.userId,
            role: actorRole(command.role),
          }, {
            ruleSetKey: rule.ruleSetKey,
            ruleSetVersion: rule.version,
            input: {
              inquiryId,
              inquiryVersion,
              sku: sku.sku,
              specifications: {},
              quantity: inquiry.quantity,
              quoteCurrency: rule.baseCurrency,
              incoterm: sku.incoterms[0].code,
              destinationCountry: inquiry.destinationCountry,
              paymentTerm: sku.allowedPaymentTerms[0],
              requestedDiscountBps: 0,
              quoteDate,
            },
          }, draftKey);
          if (binding) {
            const lineage = {
              ...inquiryIdentity,
              tenantId: command.tenantId,
              requestHash: inquiryRequestHash,
              inquiryRecordId: source.record.id,
              lineageHash: starterQuoteInquiryLineageHash({
                tenantId: command.tenantId,
                identity: inquiryIdentity,
                requestHash: inquiryRequestHash,
                binding,
              }),
              binding,
            };
            await persistStarterQuoteDraftLineage({
              repository,
              tenantId: command.tenantId,
              draftId: draft.id,
              inquiry: lineage,
            });
            try {
              await notifyStarterQuoteArtifactsReady({
                dataStore: repository.dataStore ?? dataStore,
                repository,
                tenantId: command.tenantId,
                inquiry: lineage,
                draftId: draft.id,
                // Bind access-cycle and wake markers to the admitted quote
                // operation. An exact replay retries the same wake-up without
                // changing the already committed business result.
                now: () => at,
              });
            } catch (error) {
              // Inquiry and quote draft are already durable. A workflow wake
              // failure must never turn that success into a client-visible
              // retryable error (and duplicate submission); exact replay is a
              // safe idempotent repair path.
              console.warn('[starter-198-quote-wakeup] deferred', {
                code: error instanceof StarterQuoteArtifactWakeupError
                  ? error.code
                  : 'starter_quote_wakeup_unavailable',
              });
            }
          }
          return {
            inquiryId,
            inquiryVersion,
            draftId: draft.id,
            status: draft.status,
            total: draft.calculation?.total
              ? { currency: draft.calculation.total.currency, decimal: draft.calculation.total.decimal }
              : null,
            repeated: existingDraft.items.length === 1,
          };
        });
      } catch (error) {
        if (error instanceof Starter198RuntimePortError) throw error;
        if (error instanceof QuotationError) throw new Starter198RuntimePortError(error.code, error.status);
        if (error instanceof Starter198QuotaError) throw new Starter198RuntimePortError(error.code, error.status);
        if (error instanceof Starter198RepositoryError) {
          throw new Starter198RuntimePortError(error.code, error.code === 'starter_198_not_provisioned' ? 403 : 503);
        }
        throw new Starter198RuntimePortError('starter_198_quote_inquiry_unavailable', 503);
      }
    },
  };
}
