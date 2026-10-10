import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { QuotationError } from '../quotation/errors.js';
import { QuotationService, type DraftView } from '../quotation/service.js';
import {
  createStarter198Repository,
  STARTER_COLLECTIONS,
  Starter198RepositoryError,
  starter198Repository,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import { buildStarter198CapabilityManifest, starter198CapabilityAllowed } from './profile.js';
import { Starter198RuntimePortError } from './runtimePorts.js';

const ARTIFACT_SCHEMA = 'starter-198.quote-artifact.v1' as const;
const MAX_ARTIFACT_BYTES = 256 * 1024;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {}
  }
  return {};
}

function stableStringify(value: unknown, depth = 0): string {
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const indent = '  '.repeat(depth + 1);
    return `[\n${indent}${value.map(item => stableStringify(item, depth + 1)).join(`,\n${indent}`)}\n${'  '.repeat(depth)}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (!keys.length) return '{}';
    const indent = '  '.repeat(depth + 1);
    return `{\n${indent}${keys.map(key => `${JSON.stringify(key)}: ${stableStringify(record[key], depth + 1)}`).join(`,\n${indent}`)}\n${'  '.repeat(depth)}}`;
  }
  const primitive = JSON.stringify(value);
  return typeof primitive === 'string' ? primitive : 'null';
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function artifactIdFor(input: {
  tenantId: string;
  draftId: string;
  inputHash: string;
  calculationHash: string;
  approvalEvidenceId: string;
}): string {
  return `quote_artifact_${digest(stableStringify(input)).slice(0, 24)}`;
}

function exactIso(value: unknown): string {
  const source = text(value);
  const timestamp = Date.parse(source);
  if (!source || !Number.isFinite(timestamp)) {
    throw new Starter198RuntimePortError('starter_198_quote_artifact_timestamp_invalid', 503);
  }
  return new Date(timestamp).toISOString();
}

function validArtifactRecord(record: StarterRecord, tenantId: string): boolean {
  const encoded = text(record.body_base64);
  const bytes = Buffer.from(encoded, 'base64');
  const artifactId = text(record.artifact_id);
  const draftId = text(record.draft_id);
  const inputHash = text(record.input_hash);
  const ruleHash = text(record.rule_hash);
  const calculationHash = text(record.calculation_hash);
  const approvalEvidenceId = text(record.approval_evidence_id);
  const createdAt = text(record.created_at);
  if (text(record.tenant_id) !== tenantId || text(record.status) !== 'ready'
    || text(record.media_type) !== 'application/json; charset=utf-8'
    || !/^[A-Za-z0-9_-]{1,160}$/.test(draftId)
    || !/^[a-f0-9]{64}$/.test(inputHash)
    || !/^[a-f0-9]{64}$/.test(ruleHash)
    || !/^[a-f0-9]{64}$/.test(calculationHash)
    || !approvalEvidenceId || approvalEvidenceId.length > 200
    || artifactId !== artifactIdFor({ tenantId, draftId, inputHash, calculationHash, approvalEvidenceId })
    || text(record.file_name) !== `quotation-${draftId}.json`
    || !/^[a-f0-9]{64}$/.test(text(record.sha256))
    || !encoded || bytes.toString('base64') !== encoded
    || bytes.length === 0 || bytes.length > MAX_ARTIFACT_BYTES
    || digest(bytes) !== text(record.sha256)) return false;
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    const document = object(parsed);
    const evidence = object(document.immutableEvidence);
    const ruleSet = object(evidence.ruleSet);
    return document.schemaVersion === ARTIFACT_SCHEMA
      && document.documentType === 'quotation'
      && text(document.quoteNumber) === draftId
      && text(document.status) === 'approved'
      && text(document.generatedAt) === createdAt
      && text(evidence.inputHash) === inputHash
      && text(evidence.calculationHash) === calculationHash
      && text(evidence.approvalEvidenceId) === approvalEvidenceId
      && text(ruleSet.hash) === ruleHash
      && `${stableStringify(document)}\n` === bytes.toString('utf8');
  } catch {
    return false;
  }
}

async function supplierName(dataStore: DataStore, tenantId: string): Promise<string> {
  const profiles = await dataStore.list<StarterRecord>('tenant_profiles', {
    where: { tenant_id: tenantId }, perPage: 2,
  });
  if (profiles.totalItems !== profiles.items.length
    || profiles.totalItems > 1
    || profiles.items.some(item => text(item.tenant_id) !== tenantId)) {
    throw new Starter198RuntimePortError('starter_198_quote_artifact_profile_integrity', 503);
  }
  if (profiles.totalItems !== 1 || !profiles.items[0]) {
    throw new Starter198RuntimePortError('starter_198_quote_artifact_profile_missing', 503);
  }
  const profile = object(profiles.items[0]?.profile);
  const name = text(object(profile.company).name);
  if (!name) throw new Starter198RuntimePortError('starter_198_quote_artifact_supplier_missing', 503);
  return name;
}

function artifactDocument(input: { draft: DraftView; supplier: string; generatedAt: string }) {
  return {
    schemaVersion: ARTIFACT_SCHEMA,
    documentType: 'quotation',
    quoteNumber: input.draft.id,
    supplier: input.supplier,
    inquiryReference: input.draft.inquiryId,
    status: 'approved',
    generatedAt: input.generatedAt,
    validFrom: input.draft.calculation.validFrom,
    validUntil: input.draft.calculation.validUntil,
    product: {
      sku: input.draft.input.sku,
      specifications: input.draft.input.specifications,
      quantity: input.draft.input.quantity,
    },
    commercialTerms: {
      currency: input.draft.input.quoteCurrency,
      incoterm: input.draft.input.incoterm,
      destinationCountry: input.draft.input.destinationCountry,
      paymentTerm: input.draft.input.paymentTerm,
      leadTimeDays: input.draft.calculation.promisedLeadTimeDays,
    },
    amounts: {
      unitPrice: input.draft.calculation.unitPrice,
      goodsSubtotal: input.draft.calculation.goodsSubtotal,
      discount: input.draft.calculation.discount,
      incotermFee: input.draft.calculation.incotermFee,
      shipping: input.draft.calculation.shipping,
      tax: input.draft.calculation.tax,
      total: input.draft.calculation.total,
    },
    immutableEvidence: {
      ruleSet: input.draft.ruleSetRef,
      inputHash: input.draft.inputHash,
      calculationHash: input.draft.calculationHash,
      approvalEvidenceId: input.draft.approvalEvidenceId,
    },
    notice: '本文件来自已确认规则的确定性计算。对外发送由用户在系统外完成，系统不会自动承诺或发送。',
  };
}

export interface StarterQuoteArtifact {
  artifactId: string;
  draftId: string;
  inputHash: string;
  ruleHash: string;
  calculationHash: string;
  approvalEvidenceId: string;
  sha256: string;
  mediaType: 'application/json; charset=utf-8';
  fileName: string;
  bytes: Buffer;
  createdAt: string;
}

function view(record: StarterRecord, tenantId: string): StarterQuoteArtifact {
  if (!validArtifactRecord(record, tenantId)) {
    throw new Starter198RuntimePortError('starter_198_quote_artifact_integrity', 503);
  }
  return {
    artifactId: text(record.artifact_id),
    draftId: text(record.draft_id),
    inputHash: text(record.input_hash),
    ruleHash: text(record.rule_hash),
    calculationHash: text(record.calculation_hash),
    approvalEvidenceId: text(record.approval_evidence_id),
    sha256: text(record.sha256),
    mediaType: 'application/json; charset=utf-8',
    fileName: text(record.file_name),
    bytes: Buffer.from(text(record.body_base64), 'base64'),
    createdAt: text(record.created_at),
  };
}

export async function currentStarterQuoteArtifact(input: {
  tenantId: string;
  draftId: string;
  expectedInputHash?: string;
  repository?: Starter198Repository;
}): Promise<StarterQuoteArtifact | null> {
  const repository = input.repository ?? starter198Repository;
  const result = await repository.list(STARTER_COLLECTIONS.quoteArtifacts, input.tenantId, {
    where: { draft_id: input.draftId }, perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) {
    throw new Starter198RuntimePortError('starter_198_quote_artifact_integrity', 503);
  }
  const record = result.items[0];
  if (!record) return null;
  const artifact = view(record, input.tenantId);
  return input.expectedInputHash && artifact.inputHash !== input.expectedInputHash ? null : artifact;
}

export async function readStarterQuoteArtifact(input: {
  tenantId: string;
  artifactId: string;
  repository?: Starter198Repository;
}): Promise<StarterQuoteArtifact | null> {
  const repository = input.repository ?? starter198Repository;
  const result = await repository.list(STARTER_COLLECTIONS.quoteArtifacts, input.tenantId, {
    where: { artifact_id: input.artifactId }, perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) {
    throw new Starter198RuntimePortError('starter_198_quote_artifact_integrity', 503);
  }
  return result.items[0] ? view(result.items[0], input.tenantId) : null;
}

export async function ensureStarterQuoteArtifact(input: {
  tenantId: string;
  userId: string;
  draftId: string;
  expectedInputHash?: string;
  idempotencyKey: string;
  dataStore?: DataStore;
  repository?: Starter198Repository;
  quotationService?: Pick<QuotationService, 'getDraft'>;
  now?: Date;
}): Promise<{ artifact: StarterQuoteArtifact; created: boolean }> {
  const dataStore = input.dataStore ?? store;
  const repository = input.repository ?? (input.dataStore
    ? createStarter198Repository(input.dataStore)
    : starter198Repository);
  try {
    const access = await repository.access(input.tenantId);
    const manifest = buildStarter198CapabilityManifest(access, input.now ?? new Date());
    if (!starter198CapabilityAllowed(manifest, 'quotation.calculate')) {
      throw new Starter198RuntimePortError('starter_198_quote_artifact_not_entitled', 403);
    }
    const existing = await currentStarterQuoteArtifact({
      tenantId: input.tenantId, draftId: input.draftId,
      expectedInputHash: input.expectedInputHash, repository,
    });
    if (existing) return { artifact: existing, created: false };
    const service = input.quotationService ?? new QuotationService(dataStore);
    const draft = await service.getDraft({
      tenantId: input.tenantId, userId: input.userId, role: 'admin',
    }, input.draftId);
    if (draft.status !== 'approved' || !draft.approvalValid || !draft.approvalEvidenceId || !draft.executable) {
      throw new Starter198RuntimePortError('starter_198_quote_artifact_not_approved', 409);
    }
    if (input.expectedInputHash && draft.inputHash !== input.expectedInputHash) {
      throw new Starter198RuntimePortError('quote_draft_changed', 409);
    }
    // The approved draft timestamp is immutable and makes crash recovery and
    // concurrent factories converge on exactly the same byte stream.
    const generatedAt = exactIso(draft.updatedAt || draft.createdAt);
    const document = artifactDocument({
      draft,
      supplier: await supplierName(dataStore, input.tenantId),
      generatedAt,
    });
    const bytes = Buffer.from(`${stableStringify(document)}\n`, 'utf8');
    if (bytes.length === 0 || bytes.length > MAX_ARTIFACT_BYTES) {
      throw new Starter198RuntimePortError('starter_198_quote_artifact_too_large', 503);
    }
    const sha256 = digest(bytes);
    const artifactId = artifactIdFor({
      tenantId: input.tenantId,
      draftId: draft.id,
      inputHash: draft.inputHash,
      calculationHash: draft.calculationHash,
      approvalEvidenceId: draft.approvalEvidenceId,
    });
    const fileName = `quotation-${draft.id}.json`;
    const payload = {
      artifact_id: artifactId,
      draft_id: draft.id,
      input_hash: draft.inputHash,
      rule_hash: draft.ruleSetRef.hash,
      calculation_hash: draft.calculationHash,
      approval_evidence_id: draft.approvalEvidenceId,
      sha256,
      media_type: 'application/json; charset=utf-8',
      file_name: fileName,
      body_base64: bytes.toString('base64'),
      status: 'ready',
      idempotency_key: input.idempotencyKey,
      created_at: generatedAt,
    };
    try {
      const record = await repository.create(STARTER_COLLECTIONS.quoteArtifacts, input.tenantId, payload);
      return { artifact: view(record, input.tenantId), created: true };
    } catch {
      const raced = await currentStarterQuoteArtifact({
        tenantId: input.tenantId, draftId: input.draftId,
        expectedInputHash: draft.inputHash, repository,
      });
      if (!raced || raced.sha256 !== sha256 || raced.calculationHash !== draft.calculationHash
        || raced.approvalEvidenceId !== draft.approvalEvidenceId) {
        throw new Starter198RuntimePortError('starter_198_quote_artifact_storage_unavailable', 503);
      }
      return { artifact: raced, created: false };
    }
  } catch (error) {
    if (error instanceof Starter198RuntimePortError) throw error;
    if (error instanceof Starter198RepositoryError) {
      throw new Starter198RuntimePortError(
        error.code === 'starter_198_not_provisioned' ? error.code : 'starter_198_quote_artifact_storage_unavailable',
        error.code === 'starter_198_not_provisioned' ? 403 : 503,
      );
    }
    if (error instanceof QuotationError) throw new Starter198RuntimePortError(error.code, error.status);
    throw new Starter198RuntimePortError('starter_198_quote_artifact_storage_unavailable', 503);
  }
}
