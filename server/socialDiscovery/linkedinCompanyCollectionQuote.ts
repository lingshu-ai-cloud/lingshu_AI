import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { frozenLinkedInCompanyActorInput, type LinkedInCompanyCollectionScope } from '../routes/linkedinCompanyPostPaidCollection.js';
import { readCurrentLinkedInCompanyCollectionApproval, type LinkedInCompanyCollectionApproval } from './linkedinCompanyCollectionApproval.js';

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex = (value: string) => /^[a-f0-9]{64}$/.test(value);
const micros = (value: number) => Math.ceil(value * 1_000_000 - 1e-9);

/** Account-specific evidence, including every charge outside the Actor run cap. */
export interface LinkedInCompanyCostEvidence {
  actorId: string;
  accountRef: string;
  tokenFingerprint: string;
  actorMaxTotalChargeUsd: number;
  fxCnyPerUsdUpper: number;
  fxEvidenceRef: string;
  nonActorMaximumCny: number;
  nonActorEvidenceRef: string;
  pricingEvidenceRef: string;
  checkedAt: string;
  validUntil: string;
}

export interface LinkedInCompanyQuotePorts {
  /** Server-owned credential only; fingerprint uses sha256-json-string-v1, never request JSON. */
  readAccountBinding(): Promise<{ accountRef: string; tokenFingerprint: string }>;
  readCostEvidence(binding: { accountRef: string; tokenFingerprint: string }, actorId: string): Promise<LinkedInCompanyCostEvidence | null>;
  /** Must validate the account tariff, exchange-rate ceiling and all non-Actor charges against durable source evidence. */
  verifyCostEvidence(evidence: LinkedInCompanyCostEvidence): Promise<boolean>;
}

/** Prepares a bounded quote. It neither reserves budget nor issues a paid permit. */
export async function quoteLinkedInCompanyCollection(input: {
  store: DataStore;
  scope: LinkedInCompanyCollectionScope;
  approval: LinkedInCompanyCollectionApproval;
  ports: LinkedInCompanyQuotePorts;
  now?: () => number;
}) {
  const now = input.now?.() ?? Date.now();
  const current = () => readCurrentLinkedInCompanyCollectionApproval({
    store: input.store, scope: input.scope,
    discoveryScopeId: input.approval.discoveryScopeId,
    discoveryScopeVersion: input.approval.discoveryScopeVersion,
    discoveryScopeHash: input.approval.discoveryScopeHash, now,
  });
  if ((await current()).recordHash !== input.approval.recordHash)
    throw Error('linkedin_company_collection_quote_approval_changed');
  const binding = await input.ports.readAccountBinding();
  if (!binding?.accountRef?.trim() || !hex(binding.tokenFingerprint))
    throw Error('linkedin_company_collection_quote_account_unverified');
  const evidence = await input.ports.readCostEvidence(binding, input.approval.actorId);
  if (!evidence || evidence.actorId !== input.approval.actorId
    || evidence.accountRef !== binding.accountRef || evidence.tokenFingerprint !== binding.tokenFingerprint
    || !Number.isFinite(evidence.actorMaxTotalChargeUsd) || evidence.actorMaxTotalChargeUsd <= 0
    || !Number.isFinite(evidence.fxCnyPerUsdUpper) || evidence.fxCnyPerUsdUpper <= 0
    || !Number.isFinite(evidence.nonActorMaximumCny) || evidence.nonActorMaximumCny <= 0
    || !evidence.fxEvidenceRef?.trim() || !evidence.nonActorEvidenceRef?.trim()
    || !evidence.pricingEvidenceRef?.trim()
    || !Number.isFinite(Date.parse(evidence.checkedAt))
    || Date.parse(evidence.checkedAt) > now
    || !Number.isFinite(Date.parse(evidence.validUntil))
    || Date.parse(evidence.validUntil) <= now
    || !await input.ports.verifyCostEvidence(structuredClone(evidence))) {
    throw Error('linkedin_company_collection_quote_evidence_unverified');
  }
  const actorCnyMicros = micros(evidence.actorMaxTotalChargeUsd * evidence.fxCnyPerUsdUpper);
  const otherCnyMicros = micros(evidence.nonActorMaximumCny);
  const totalCnyMicros = actorCnyMicros + otherCnyMicros;
  if (![actorCnyMicros, otherCnyMicros, totalCnyMicros].every(value => Number.isSafeInteger(value) && value > 0)
    || totalCnyMicros > Math.round(input.approval.maximumCny * 1_000_000))
    throw Error('linkedin_company_collection_quote_budget_exceeded');
  const actorInputSha256 = sha(frozenLinkedInCompanyActorInput(input.scope));
  if (actorInputSha256 !== input.approval.actorInputSha256)
    throw Error('linkedin_company_collection_quote_input_changed');
  if ((await current()).recordHash !== input.approval.recordHash)
    throw Error('linkedin_company_collection_quote_approval_changed');
  const operationId = `linkedin-company-collection:${sha([input.approval.recordHash,
    actorInputSha256, binding.accountRef, binding.tokenFingerprint])}`;
  return { operationId, scope: structuredClone(input.scope), approvalRecordHash: input.approval.recordHash,
    actorInputSha256, actorId: input.approval.actorId, accountRef: binding.accountRef,
    tokenFingerprint: binding.tokenFingerprint, maxTotalChargeUsd: evidence.actorMaxTotalChargeUsd,
    actorCnyMicros, nonActorCnyMicros: otherCnyMicros, reservedCnyMicros: totalCnyMicros,
    evidenceSha256: sha(evidence), validUntil: new Date(Math.min(Date.parse(evidence.validUntil),
      Date.parse(input.approval.expiresAt))).toISOString() };
}
