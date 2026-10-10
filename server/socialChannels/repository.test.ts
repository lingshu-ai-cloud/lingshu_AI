import assert from 'node:assert/strict';
import type { DataStore, ListQuery, ListResult } from '../storage/datastore.js';
import {
  buildPublicationEvidence,
  buildPublicationPackage,
  resolvePublicationEvidence,
} from '../publishing/publicationPackage.js';
import { createAssistedBrowserTask } from '../publishing/assistedBrowserSession.js';
import { normalizeAccountContentPage } from './monitoring.js';
import { createDefaultChannelRegistry } from './registry.js';
import {
  SOCIAL_CHANNEL_COLLECTIONS,
  SocialChannelRepository,
  SocialChannelRepositoryError,
} from './repository.js';

type Row = { id: string } & Record<string, unknown>;

class MemoryStore implements DataStore {
  readonly rows = new Map<string, Row[]>();

  async getById<T = Row>(collection: string, id: string): Promise<T | null> {
    return (this.rows.get(collection)?.find(row => row.id === id) as T | undefined) ?? null;
  }

  async create<T = Row>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const rows = this.rows.get(collection) ?? [];
    const uniqueKeys: Partial<Record<string, string[]>> = {
      [SOCIAL_CHANNEL_COLLECTIONS.publicationPackages]: ['tenant_id', 'idempotency_key'],
      [SOCIAL_CHANNEL_COLLECTIONS.metricSnapshots]: ['tenant_id', 'snapshot_id'],
      [SOCIAL_CHANNEL_COLLECTIONS.externalContents]: ['tenant_id', 'channel_id', 'account_id', 'external_content_id', 'source'],
      [SOCIAL_CHANNEL_COLLECTIONS.syncCursors]: ['tenant_id', 'channel_id', 'account_id', 'source'],
      [SOCIAL_CHANNEL_COLLECTIONS.webhookMessages]: ['tenant_id', 'connection_id', 'message_id'],
      durable_operation_leases: ['tenant_id', 'lease_scope', 'subject_id'],
    };
    const keys = uniqueKeys[collection];
    if (keys && rows.some(row => keys.every(key => row[key] === data[key]))) return null;
    const row = { id: `${collection}-${rows.length + 1}`, ...structuredClone(data) } as Row;
    rows.push(row);
    this.rows.set(collection, rows);
    return row as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const rows = this.rows.get(collection) ?? [];
    const index = rows.findIndex(row => row.id === id);
    if (index < 0) return false;
    rows[index] = { ...rows[index], ...structuredClone(data) };
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const rows = this.rows.get(collection) ?? [];
    const index = rows.findIndex(row => row.id === id);
    if (index < 0) return false;
    rows.splice(index, 1);
    return true;
  }

  async list<T = Row>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    let rows = [...(this.rows.get(collection) ?? [])];
    rows = rows.filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
    return {
      items: rows as T[], totalItems: rows.length, totalPages: rows.length ? 1 : 0,
      page: query.page ?? 1, perPage: query.perPage ?? 20,
    };
  }
}

const database = new MemoryStore();
const repository = new SocialChannelRepository(database);
const registry = createDefaultChannelRegistry();
const build = (body = '已核验的产品事实') => buildPublicationPackage({
  tenantId: 'tenant-a', contentId: 'content-a', contentVersion: 'v1', contentHash: 'a'.repeat(64),
  channelId: 'douyin_cn', targetAccountId: 'douyin-account-a',
  copy: { title: '采购指南', body, hashtags: ['采购'] },
  assets: [{
    kind: 'video', fileName: 'approved.mp4', downloadUrl: '/api/overseas/assets/approved.mp4',
    contentHash: 'b'.repeat(64),
  }],
  idempotencyKey: 'publication-key-100', registry, now: new Date('2026-09-19T00:00:00.000Z'),
});

const manifest = build();
const first = await repository.createPublicationPackage({
  package: manifest, idempotencyKey: 'publication-key-100', createdBy: 'user-a',
});
const repeated = await repository.createPublicationPackage({
  package: manifest, idempotencyKey: 'publication-key-100', createdBy: 'user-a',
});
assert.equal(first.created, true);
assert.equal(repeated.created, false);
assert.equal(database.rows.get(SOCIAL_CHANNEL_COLLECTIONS.publicationPackages)?.length, 1);
await assert.rejects(
  repository.createPublicationPackage({
    package: build('更改后的文案'), idempotencyKey: 'publication-key-100', createdBy: 'user-a',
  }),
  (error: unknown) => error instanceof SocialChannelRepositoryError && error.code === 'social_publication_idempotency_conflict',
);

const submittedEvidence = buildPublicationEvidence({
  package: manifest,
  method: 'manual_package',
  contentHash: manifest.contentHash,
  packageHash: manifest.packageHash,
  publicUrl: 'https://www.douyin.com/video/100',
  submittedBy: 'user-a',
  now: new Date('2026-09-19T00:10:00.000Z'),
});
const submittedSnapshot = await repository.recordPublicationEvidence({
  tenantId: 'tenant-a', packageId: manifest.packageId, evidence: submittedEvidence,
  status: 'evidence_submitted', eventType: 'submitted', actorKind: 'tenant_submitter', actorId: 'user-a',
});
assert.equal(submittedSnapshot.currentEvidence?.verificationStatus, 'pending');
assert.equal(submittedSnapshot.evidenceHistory.length, 1);

const correctedEvidence = buildPublicationEvidence({
  package: submittedSnapshot.publicationPackage,
  method: 'manual_package',
  contentHash: manifest.contentHash,
  packageHash: manifest.packageHash,
  publicUrl: 'https://www.douyin.com/video/200',
  submittedBy: 'user-a',
  now: new Date('2026-09-19T00:20:00.000Z'),
});
await assert.rejects(
  repository.recordPublicationEvidence({
    tenantId: 'tenant-a', packageId: manifest.packageId, evidence: correctedEvidence,
    status: 'evidence_submitted', eventType: 'corrected', actorKind: 'tenant_submitter', actorId: 'user-a',
  }),
  (error: unknown) => error instanceof SocialChannelRepositoryError
    && error.code === 'social_publication_evidence_correction_invalid',
  'a correction must compare-and-set the current evidence id',
);
const correctedSnapshot = await repository.recordPublicationEvidence({
  tenantId: 'tenant-a', packageId: manifest.packageId, evidence: correctedEvidence,
  status: 'evidence_submitted', eventType: 'corrected', actorKind: 'tenant_submitter', actorId: 'user-a',
  expectedCurrentEvidenceId: submittedEvidence.evidenceId,
});
assert.equal(correctedSnapshot.currentEvidence?.evidenceId, correctedEvidence.evidenceId);
assert.equal(correctedSnapshot.evidenceHistory.length, 2);
assert.equal(correctedSnapshot.evidenceHistory[1].supersedesEvidenceId, submittedEvidence.evidenceId);

const verifiedResolution = resolvePublicationEvidence({
  package: correctedSnapshot.publicationPackage,
  evidence: correctedEvidence,
  verifier: 'human_review',
  verifierIdentity: 'internal_admin:reviewer-a',
  verificationRequestId: 'review-request-100',
  sourceReceiptHash: 'c'.repeat(64),
  publiclyObservable: true,
  observedContentHash: manifest.contentHash,
  reviewNote: '人工比对公开作品与冻结视频后确认一致。',
  now: new Date('2026-09-19T00:30:00.000Z'),
});
const verifiedSnapshot = await repository.recordPublicationEvidence({
  tenantId: 'tenant-a', packageId: manifest.packageId,
  evidence: verifiedResolution.evidence, status: verifiedResolution.packageStatus,
  eventType: 'verified', actorKind: 'internal_verifier', actorId: 'internal_admin:reviewer-a',
  expectedCurrentEvidenceId: correctedEvidence.evidenceId,
});
assert.equal(verifiedSnapshot.publicationPackage.status, 'published_verified');
assert.equal(verifiedSnapshot.currentEvidence?.verificationStatus, 'verified');
assert.equal(verifiedSnapshot.evidenceHistory.length, 3);

const verificationRetry = await repository.recordPublicationEvidence({
  tenantId: 'tenant-a', packageId: manifest.packageId,
  evidence: verifiedResolution.evidence, status: verifiedResolution.packageStatus,
  eventType: 'verified', actorKind: 'internal_verifier', actorId: 'internal_admin:reviewer-a',
  expectedCurrentEvidenceId: correctedEvidence.evidenceId,
});
assert.equal(verificationRetry.evidenceHistory.length, 3, 'verification retries must be idempotent');
await assert.rejects(
  repository.recordPublicationEvidence({
    tenantId: 'tenant-a', packageId: manifest.packageId, evidence: correctedEvidence,
    status: 'evidence_submitted', eventType: 'corrected', actorKind: 'tenant_submitter', actorId: 'user-a',
    expectedCurrentEvidenceId: correctedEvidence.evidenceId,
  }),
  (error: unknown) => error instanceof SocialChannelRepositoryError
    && error.code === 'social_publication_evidence_correction_invalid',
  'ordinary submitters cannot overwrite a verified fact',
);

const rejectedCorrection = resolvePublicationEvidence({
  package: verifiedSnapshot.publicationPackage,
  evidence: verifiedSnapshot.currentEvidence!,
  verifier: 'human_review',
  verifierIdentity: 'internal_admin:reviewer-b',
  verificationRequestId: 'review-request-200',
  sourceReceiptHash: 'd'.repeat(64),
  publiclyObservable: false,
  rejectionReason: '复核发现公开作品与冻结版本不一致。',
  reviewNote: '第二位核验员完成更正。',
  now: new Date('2026-09-19T00:40:00.000Z'),
});
const rejectedSnapshot = await repository.recordPublicationEvidence({
  tenantId: 'tenant-a', packageId: manifest.packageId,
  evidence: rejectedCorrection.evidence, status: rejectedCorrection.packageStatus,
  eventType: 'rejected', actorKind: 'internal_verifier', actorId: 'internal_admin:reviewer-b',
  expectedCurrentEvidenceId: correctedEvidence.evidenceId,
});
assert.equal(rejectedSnapshot.publicationPackage.status, 'failed');
assert.equal(rejectedSnapshot.currentEvidence?.verificationStatus, 'rejected');
assert.equal(rejectedSnapshot.evidenceHistory.length, 4, 'human corrections remain append-only');

const firstWebhookClaim = await repository.claimWebhookMessage({
  tenantId: 'tenant-a', connectionId: 'douyin-connection-a', messageId: 'message-100',
  receivedAt: '2026-09-19T01:00:00.000Z', payloadDigest: 'e'.repeat(64),
});
assert.equal(firstWebhookClaim, true);
const throwingDuplicateStore: DataStore = {
  getById: database.getById.bind(database),
  async create<T = Row>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    if (collection === SOCIAL_CHANNEL_COLLECTIONS.webhookMessages) throw new Error('unique constraint failed');
    return database.create<T>(collection, data);
  },
  update: database.update.bind(database), delete: database.delete.bind(database), list: database.list.bind(database),
};
const duplicateClaim = await new SocialChannelRepository(throwingDuplicateStore).claimWebhookMessage({
  tenantId: 'tenant-a', connectionId: 'douyin-connection-a', messageId: 'message-100',
  receivedAt: '2026-09-19T01:01:00.000Z', payloadDigest: 'e'.repeat(64),
});
assert.equal(duplicateClaim, false, 'a unique-index exception must be re-read as a duplicate ACK');
await assert.rejects(
  new SocialChannelRepository(throwingDuplicateStore).claimWebhookMessage({
    tenantId: 'tenant-a', connectionId: 'douyin-connection-a', messageId: 'message-100',
    receivedAt: '2026-09-19T01:02:00.000Z', payloadDigest: 'f'.repeat(64),
  }),
  (error: unknown) => error instanceof SocialChannelRepositoryError
    && error.code === 'social_webhook_message_collision',
);

const session = createAssistedBrowserTask({
  tenantId: 'tenant-a', packageId: manifest.packageId, packageHash: manifest.packageHash,
  contentHash: manifest.contentHash, channelId: manifest.channelId, targetAccountId: 'douyin-account-a',
  requestedBy: 'user-a', callbackOrigin: 'http://127.0.0.1:43127',
});
await repository.createAssistedSession(session.record);
const storedSession = await repository.getAssistedSession('tenant-a', session.record.sessionId);
assert.equal(storedSession?.tokenDigest, session.record.tokenDigest);
assert.equal(JSON.stringify(storedSession).includes(session.oneTimeToken), false);
assert.equal(await repository.getAssistedSession('tenant-b', session.record.sessionId), null);

const page = normalizeAccountContentPage({
  tenantId: 'tenant-a', channelId: 'douyin_cn', accountId: 'douyin-account-a',
  source: 'official_api', coverage: 'account', capturedAt: '2026-09-19T01:00:00.000Z',
  items: [{ externalContentId: 'video-100', status: 'published', metrics: { views: 0 } }],
});
await repository.persistSyncPage(page);
await repository.persistSyncPage(page);
assert.equal(database.rows.get(SOCIAL_CHANNEL_COLLECTIONS.externalContents)?.length, 1);
assert.equal(database.rows.get(SOCIAL_CHANNEL_COLLECTIONS.metricSnapshots)?.length, 1, 'metric snapshots are immutable/idempotent');
assert.equal(database.rows.get(SOCIAL_CHANNEL_COLLECTIONS.syncCursors)?.length, 1);
const overview = await repository.monitorOverview('tenant-a');
assert.equal(overview.recentMetricSnapshots.length, 1);
assert.equal((overview.recentMetricSnapshots[0] as typeof page.metricSnapshots[number]).metrics.comments, null);

const hostileStore: DataStore = {
  ...database,
  getById: database.getById.bind(database), create: database.create.bind(database),
  update: database.update.bind(database), delete: database.delete.bind(database),
  async list<T>() {
    return {
      items: [{ id: 'foreign', tenant_id: 'tenant-b', package_id: manifest.packageId }] as T[],
      totalItems: 1, totalPages: 1, page: 1, perPage: 2,
    };
  },
};
await assert.rejects(
  new SocialChannelRepository(hostileStore).getPublicationPackage('tenant-a', manifest.packageId),
  (error: unknown) => error instanceof SocialChannelRepositoryError
    && error.code === 'social_channel_storage_integrity_violation',
);

console.log('socialChannels repository tests passed');
