import { createHash } from 'node:crypto';
import type {
  PublicationCopy,
  PublicationEvidenceSubmission,
  PublicationMethod,
  PublicationPackage,
  PublicationPackageStatus,
  ResolvedPublicationEvidence,
  SocialChannelId,
} from '../../shared/contracts/socialChannels.js';
import { normalizeSocialChannelId } from '../../shared/contracts/socialChannels.js';
import type { ChannelAdapterRegistry } from '../socialChannels/registry.js';

export class PublicationPackageError extends Error {
  constructor(readonly code: string, readonly status = 400, message = code) {
    super(message);
    this.name = 'PublicationPackageError';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function stableSocialChannelHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function publicationPackageBusinessSubject(input: PublicationPackage): Record<string, unknown> {
  return {
    tenantId: input.tenantId,
    contentId: input.contentId,
    contentVersion: input.contentVersion,
    contentHash: input.contentHash,
    channelId: input.channelId,
    ...(input.targetAccountId ? { targetAccountId: input.targetAccountId } : {}),
    copy: input.copy,
    assets: input.assets,
    specificationChecks: input.specificationChecks,
    ...(input.sourceTracking && Object.keys(input.sourceTracking).length ? { sourceTracking: input.sourceTracking } : {}),
    publishingInstructions: input.publishingInstructions,
  };
}

export function publicationPackageHashIsValid(input: PublicationPackage): boolean {
  return stableSocialChannelHash(publicationPackageBusinessSubject(input)) === input.packageHash;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

const text = (value: unknown): string => String(value ?? '').trim();

function validId(value: unknown): boolean {
  return /^[a-z0-9:_-]{1,200}$/i.test(text(value));
}

function validHash(value: unknown): boolean {
  return /^[a-f0-9]{32,128}$/i.test(text(value));
}

function safeAssetUrl(value: string): boolean {
  if (value.startsWith('/api/overseas/')) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function normalizeCopy(copy: PublicationCopy): PublicationCopy {
  const hashtags = [...new Set((copy.hashtags ?? [])
    .map(item => text(item).replace(/^#+/, ''))
    .filter(Boolean))].slice(0, 30);
  return {
    title: text(copy.title).slice(0, 300),
    body: text(copy.body).slice(0, 10_000),
    hashtags,
    ...(text(copy.cta) ? { cta: text(copy.cta).slice(0, 2_000) } : {}),
    ...(text(copy.firstComment) ? { firstComment: text(copy.firstComment).slice(0, 2_000) } : {}),
    ...(text(copy.altText) ? { altText: text(copy.altText).slice(0, 2_000) } : {}),
  };
}

export interface BuildPublicationPackageInput {
  tenantId: string;
  contentId: string;
  contentVersion: string;
  contentHash: string;
  channelId: SocialChannelId | 'tiktok';
  targetAccountId?: string;
  copy: PublicationCopy;
  assets: PublicationPackage['assets'];
  sourceTracking?: Record<string, string>;
  idempotencyKey: string;
  registry: ChannelAdapterRegistry;
  now?: Date;
}

export function buildPublicationPackage(input: BuildPublicationPackageInput): Readonly<PublicationPackage> {
  const channelId = normalizeSocialChannelId(input.channelId);
  if (!channelId) throw new PublicationPackageError('publication_channel_invalid');
  if (![input.tenantId, input.contentId, input.contentVersion, input.idempotencyKey].every(validId)) {
    throw new PublicationPackageError('publication_identity_invalid');
  }
  if (!validHash(input.contentHash)) throw new PublicationPackageError('publication_content_hash_invalid');
  if (text(input.targetAccountId) && !validId(input.targetAccountId)) {
    throw new PublicationPackageError('publication_target_account_invalid');
  }
  if (!input.assets.length || input.assets.some(asset => !text(asset.fileName)
    || !['video', 'image', 'cover', 'subtitle', 'document'].includes(asset.kind)
    || !validHash(asset.contentHash) || !safeAssetUrl(text(asset.downloadUrl)))) {
    throw new PublicationPackageError('publication_assets_invalid');
  }
  const copy = normalizeCopy(input.copy);
  const assets = input.assets.map(asset => ({
    kind: asset.kind,
    fileName: text(asset.fileName).slice(0, 240),
    downloadUrl: text(asset.downloadUrl),
    contentHash: text(asset.contentHash).toLowerCase(),
    ...(text(asset.mediaType) ? { mediaType: text(asset.mediaType).slice(0, 100) } : {}),
    ...(Number.isSafeInteger(asset.byteSize) && Number(asset.byteSize) >= 0 ? { byteSize: Number(asset.byteSize) } : {}),
  }));
  const sourceTracking = input.sourceTracking
    ? Object.fromEntries(Object.entries(input.sourceTracking)
      .map(([key, value]) => [text(key).slice(0, 80), text(value).slice(0, 500)])
      .filter(([key, value]) => Boolean(key && value)))
    : undefined;
  const adapter = input.registry.get(channelId);
  const artifact = { contentHash: text(input.contentHash).toLowerCase(), copy, assets };
  const specificationChecks = adapter.validateArtifact(artifact);
  if (specificationChecks.some(check => check.status === 'failed')) {
    throw new PublicationPackageError('publication_specification_failed', 422);
  }
  const business = {
    tenantId: text(input.tenantId),
    contentId: text(input.contentId),
    contentVersion: text(input.contentVersion),
    contentHash: text(input.contentHash).toLowerCase(),
    channelId,
    ...(text(input.targetAccountId) ? { targetAccountId: text(input.targetAccountId) } : {}),
    copy,
    assets,
    specificationChecks,
    ...(sourceTracking && Object.keys(sourceTracking).length ? { sourceTracking } : {}),
    publishingInstructions: adapter.buildPublishingInstructions(artifact),
  };
  const packageHash = stableSocialChannelHash(business);
  const packageId = `spkg_${stableSocialChannelHash({
    tenantId: text(input.tenantId),
    idempotencyKey: text(input.idempotencyKey),
  }).slice(0, 24)}`;
  return deepFreeze({
    schemaVersion: 'publication-package.v1',
    packageId,
    ...business,
    packageHash,
    generatedAt: (input.now ?? new Date()).toISOString(),
    status: 'ready',
  });
}

function allowedEvidenceHost(channelId: SocialChannelId, hostname: string): boolean {
  const domains: Record<SocialChannelId, string[]> = {
    douyin_cn: ['douyin.com', 'iesdouyin.com'],
    tiktok_global: ['tiktok.com'],
    instagram: ['instagram.com'],
    facebook: ['facebook.com', 'fb.watch'],
    youtube: ['youtube.com', 'youtu.be'],
  };
  return domains[channelId].some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

function normalizeEvidenceUrl(channelId: SocialChannelId, value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  let url: URL;
  try { url = new URL(raw); } catch { throw new PublicationPackageError('publication_evidence_url_invalid'); }
  if (url.protocol !== 'https:' || !allowedEvidenceHost(channelId, url.hostname.toLowerCase())) {
    throw new PublicationPackageError('publication_evidence_url_invalid');
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export interface BuildPublicationEvidenceInput {
  package: PublicationPackage;
  method: PublicationMethod;
  contentHash: string;
  packageHash: string;
  externalContentId?: string;
  publicUrl?: string;
  providerReceiptHash?: string;
  submittedBy: string;
  now?: Date;
}

export function buildPublicationEvidence(
  input: BuildPublicationEvidenceInput,
): Readonly<PublicationEvidenceSubmission> {
  if (input.package.status === 'superseded' || input.package.status === 'expired') {
    throw new PublicationPackageError('publication_package_not_publishable', 409);
  }
  if (text(input.contentHash).toLowerCase() !== input.package.contentHash
    || text(input.packageHash).toLowerCase() !== input.package.packageHash) {
    throw new PublicationPackageError('publication_evidence_frozen_version_mismatch', 409);
  }
  if (!['manual_package', 'assisted_browser', 'official_api'].includes(input.method)) {
    throw new PublicationPackageError('publication_method_invalid');
  }
  if (!validId(input.submittedBy)) throw new PublicationPackageError('publication_evidence_actor_invalid');
  const publicUrl = normalizeEvidenceUrl(input.package.channelId, input.publicUrl);
  const externalContentId = text(input.externalContentId).slice(0, 300) || undefined;
  const providerReceiptHash = text(input.providerReceiptHash).toLowerCase() || undefined;
  if (providerReceiptHash && !validHash(providerReceiptHash)) {
    throw new PublicationPackageError('publication_evidence_receipt_hash_invalid');
  }
  if (!publicUrl && !externalContentId && !providerReceiptHash) {
    throw new PublicationPackageError('publication_evidence_required');
  }
  const subject = {
    packageId: input.package.packageId,
    channelId: input.package.channelId,
    method: input.method,
    contentHash: input.package.contentHash,
    packageHash: input.package.packageHash,
    ...(externalContentId ? { externalContentId } : {}),
    ...(publicUrl ? { publicUrl } : {}),
    ...(providerReceiptHash ? { providerReceiptHash } : {}),
    submittedBy: text(input.submittedBy),
  };
  const submittedAt = (input.now ?? new Date()).toISOString();
  const evidenceHash = stableSocialChannelHash(subject);
  return deepFreeze({
    schemaVersion: 'publication-evidence.v1',
    evidenceId: `pevd_${evidenceHash.slice(0, 24)}`,
    ...subject,
    submittedAt,
    verificationStatus: 'pending',
    evidenceHash,
  });
}

export interface ResolvePublicationEvidenceInput {
  package: PublicationPackage;
  evidence: PublicationEvidenceSubmission | ResolvedPublicationEvidence;
  verifier: ResolvedPublicationEvidence['verifier'];
  verifierIdentity: string;
  verificationRequestId?: string;
  sourceReceiptHash: string;
  publiclyObservable: boolean;
  observedContentHash?: string;
  rejectionReason?: string;
  reviewNote?: string;
  now?: Date;
}

export function resolvePublicationEvidence(input: ResolvePublicationEvidenceInput): Readonly<{
  packageStatus: PublicationPackageStatus;
  evidence: ResolvedPublicationEvidence;
  reconciliationRequired: boolean;
}> {
  if (input.evidence.packageId !== input.package.packageId
    || input.evidence.packageHash !== input.package.packageHash
    || input.evidence.contentHash !== input.package.contentHash) {
    throw new PublicationPackageError('publication_evidence_integrity_violation', 409);
  }
  if (!validId(input.verifierIdentity) || !validHash(input.sourceReceiptHash)) {
    throw new PublicationPackageError('publication_verifier_invalid');
  }
  if (text(input.verificationRequestId) && !validId(input.verificationRequestId)) {
    throw new PublicationPackageError('publication_verification_request_id_invalid');
  }
  const observed = text(input.observedContentHash).toLowerCase() || undefined;
  const mismatch = Boolean(observed && observed !== input.package.contentHash);
  const explicitRejection = Boolean(text(input.rejectionReason));
  const verified = input.publiclyObservable && observed === input.package.contentHash && !explicitRejection;
  const verificationStatus: ResolvedPublicationEvidence['verificationStatus'] = verified
    ? 'verified'
    : mismatch || explicitRejection
      ? 'rejected'
      : 'reconciliation_required';
  const packageStatus: PublicationPackageStatus = verificationStatus === 'verified'
    ? 'published_verified'
    : verificationStatus === 'rejected'
      ? 'failed'
      : 'reconciliation_required';
  const submission = {
    schemaVersion: input.evidence.schemaVersion,
    evidenceId: input.evidence.evidenceId,
    packageId: input.evidence.packageId,
    channelId: input.evidence.channelId,
    method: input.evidence.method,
    contentHash: input.evidence.contentHash,
    packageHash: input.evidence.packageHash,
    ...(input.evidence.externalContentId ? { externalContentId: input.evidence.externalContentId } : {}),
    ...(input.evidence.publicUrl ? { publicUrl: input.evidence.publicUrl } : {}),
    ...(input.evidence.providerReceiptHash ? { providerReceiptHash: input.evidence.providerReceiptHash } : {}),
    submittedBy: input.evidence.submittedBy,
    submittedAt: input.evidence.submittedAt,
    evidenceHash: input.evidence.evidenceHash,
  };
  const evidence = deepFreeze({
    ...submission,
    verificationStatus,
    verifiedAt: (input.now ?? new Date()).toISOString(),
    verifier: input.verifier,
    verifierIdentity: text(input.verifierIdentity),
    ...(text(input.verificationRequestId) ? { verificationRequestId: text(input.verificationRequestId) } : {}),
    ...(observed ? { observedContentHash: observed } : {}),
    sourceReceiptHash: text(input.sourceReceiptHash).toLowerCase(),
    ...(text(input.reviewNote) ? { reviewNote: text(input.reviewNote).slice(0, 2_000) } : {}),
    ...(verificationStatus !== 'verified'
      ? { rejectionReason: text(input.rejectionReason) || (mismatch ? 'observed_content_hash_mismatch' : 'verification_incomplete') }
      : {}),
  }) as Readonly<ResolvedPublicationEvidence>;
  return deepFreeze({ packageStatus, evidence, reconciliationRequired: verificationStatus !== 'verified' });
}
