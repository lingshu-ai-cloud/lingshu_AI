import { randomUUID } from 'node:crypto';
import type {
  AccountContentSyncPage,
  AssistedBrowserTaskRecord,
  DouyinCapabilityContext,
  PublicationEvidenceSubmission,
  PublicationEvidenceEvent,
  PublicationPackage,
  PublicationPackageSnapshot,
  PublicationPackageStatus,
  ResolvedPublicationEvidence,
  SocialChannelId,
} from '../../shared/contracts/socialChannels.js';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import type { ChannelCapabilityEvaluationContext } from './adapter.js';
import {
  publicationPackageHashIsValid,
  stableSocialChannelHash,
} from '../publishing/publicationPackage.js';
import {
  acquireDurableOperationLease,
  releaseDurableOperationLease,
} from '../runtime/durableLease.js';

export const SOCIAL_CHANNEL_COLLECTIONS = {
  connections: 'social_channel_connections',
  publicationPackages: 'social_publication_packages',
  assistedSessions: 'social_assisted_publish_sessions',
  externalContents: 'social_external_contents',
  metricSnapshots: 'social_channel_metric_snapshots',
  syncCursors: 'social_channel_sync_cursors',
  oauthStates: 'social_channel_oauth_states',
  webhookMessages: 'social_channel_webhook_messages',
} as const;

type Stored = { id: string } & Record<string, unknown>;

export class SocialChannelRepositoryError extends Error {
  constructor(readonly code: string, readonly status = 503, message = code) {
    super(message);
    this.name = 'SocialChannelRepositoryError';
  }
}

const text = (value: unknown): string => String(value ?? '').trim();

function parseObject<T>(value: unknown): T | null {
  if (value && typeof value === 'object') return value as T;
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function assertTenantRows(rows: Stored[], tenantId: string): void {
  if (rows.some(row => text(row.tenant_id) !== tenantId)) {
    throw new SocialChannelRepositoryError('social_channel_storage_integrity_violation', 500);
  }
}

function manifestFromRow(row: Stored, tenantId: string): PublicationPackage {
  const manifest = parseObject<PublicationPackage>(row.manifest);
  if (!manifest || manifest.tenantId !== tenantId || manifest.packageId !== text(row.package_id)
    || manifest.packageHash !== text(row.package_hash) || manifest.channelId !== text(row.channel_id)
    || !publicationPackageHashIsValid(manifest)) {
    throw new SocialChannelRepositoryError('social_publication_package_integrity_violation', 500);
  }
  const status = text(row.status) as PublicationPackageStatus;
  return { ...manifest, status };
}

function evidenceFromRow(
  row: Stored,
  publicationPackage: PublicationPackage,
): PublicationEvidenceSubmission | ResolvedPublicationEvidence | null {
  const evidence = parseObject<PublicationEvidenceSubmission | ResolvedPublicationEvidence>(row.evidence);
  if (!evidence) {
    if (row.evidence !== null && row.evidence !== undefined && row.evidence !== '') {
      throw new SocialChannelRepositoryError('social_publication_evidence_integrity_violation', 500);
    }
    return null;
  }
  if (evidence.packageId !== publicationPackage.packageId
    || evidence.packageHash !== publicationPackage.packageHash
    || evidence.contentHash !== publicationPackage.contentHash
    || evidence.channelId !== publicationPackage.channelId) {
    throw new SocialChannelRepositoryError('social_publication_evidence_integrity_violation', 500);
  }
  return evidence;
}

function evidenceHistoryFromRow(row: Stored, publicationPackage: PublicationPackage): PublicationEvidenceEvent[] {
  const parsed = parseObject<unknown[]>(row.evidence_history);
  if (!parsed && row.evidence_history !== null && row.evidence_history !== undefined && row.evidence_history !== '') {
    throw new SocialChannelRepositoryError('social_publication_evidence_history_integrity_violation', 500);
  }
  const history = parsed ?? [];
  if (!Array.isArray(history)) {
    throw new SocialChannelRepositoryError('social_publication_evidence_history_integrity_violation', 500);
  }
  return history.map(item => {
    const event = item as PublicationEvidenceEvent;
    if (!event || event.schemaVersion !== 'publication-evidence-event.v1'
      || event.packageId !== publicationPackage.packageId
      || event.evidence?.packageId !== publicationPackage.packageId
      || event.evidenceId !== event.evidence?.evidenceId
      || event.evidenceHash !== event.evidence?.evidenceHash) {
      throw new SocialChannelRepositoryError('social_publication_evidence_history_integrity_violation', 500);
    }
    return event;
  });
}

function snapshotFromRow(row: Stored, tenantId: string): PublicationPackageSnapshot {
  const publicationPackage = manifestFromRow(row, tenantId);
  return {
    publicationPackage,
    currentEvidence: evidenceFromRow(row, publicationPackage),
    evidenceHistory: evidenceHistoryFromRow(row, publicationPackage),
  };
}

const mutationQueues = new Map<string, Promise<void>>();

async function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prior = mutationQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const queued = prior.catch(() => undefined).then(() => gate);
  mutationQueues.set(key, queued);
  await prior.catch(() => undefined);
  try { return await task(); } finally {
    release();
    if (mutationQueues.get(key) === queued) mutationQueues.delete(key);
  }
}

export interface SocialMonitorOverview {
  accounts: Array<{
    channelId: SocialChannelId;
    accountId: string;
    source: string;
    lastSuccessfulSyncAt?: string;
    nextRetryAt?: string;
    consecutiveFailures: number;
    lastErrorCode?: string;
  }>;
  recentContents: unknown[];
  recentMetricSnapshots: unknown[];
}

export class SocialChannelRepository {
  private readonly evidenceLeaseOwner = `social-evidence:${process.pid}:${randomUUID()}`;

  constructor(private readonly database: DataStore = store) {}

  async createPublicationPackage(input: {
    package: PublicationPackage;
    idempotencyKey: string;
    createdBy: string;
  }): Promise<{ package: PublicationPackage; created: boolean }> {
    const manifest = input.package;
    return serialize(`package:${manifest.tenantId}:${input.idempotencyKey}`, async () => {
      const existing = await this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.publicationPackages, {
        where: { tenant_id: manifest.tenantId, idempotency_key: input.idempotencyKey }, perPage: 2,
      });
      assertTenantRows(existing.items, manifest.tenantId);
      if (existing.items.length > 1) throw new SocialChannelRepositoryError('social_publication_package_duplicate', 500);
      if (existing.items[0]) {
        const stored = manifestFromRow(existing.items[0], manifest.tenantId);
        if (stored.packageHash !== manifest.packageHash) {
          throw new SocialChannelRepositoryError('social_publication_idempotency_conflict', 409);
        }
        return { package: stored, created: false };
      }
      const now = manifest.generatedAt;
      const created = await this.database.create<Stored>(SOCIAL_CHANNEL_COLLECTIONS.publicationPackages, {
        tenant_id: manifest.tenantId,
        package_id: manifest.packageId,
        idempotency_key: input.idempotencyKey,
        request_hash: manifest.packageHash,
        content_id: manifest.contentId,
        content_version: manifest.contentVersion,
        content_hash: manifest.contentHash,
        channel_id: manifest.channelId,
        target_account_id: manifest.targetAccountId ?? '',
        package_hash: manifest.packageHash,
        status: manifest.status,
        manifest,
        evidence: null,
        evidence_history: [],
        created_by: input.createdBy,
        created_at: now,
        updated_at: now,
      });
      if (!created) {
        const raced = await this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.publicationPackages, {
          where: { tenant_id: manifest.tenantId, idempotency_key: input.idempotencyKey }, perPage: 2,
        });
        assertTenantRows(raced.items, manifest.tenantId);
        if (raced.items.length === 1) {
          const stored = manifestFromRow(raced.items[0], manifest.tenantId);
          if (stored.packageHash === manifest.packageHash) return { package: stored, created: false };
        }
        throw new SocialChannelRepositoryError('social_publication_package_write_failed');
      }
      return { package: manifest, created: true };
    });
  }

  async getPublicationPackage(tenantId: string, packageId: string): Promise<PublicationPackage | null> {
    return (await this.getPublicationPackageSnapshot(tenantId, packageId))?.publicationPackage ?? null;
  }

  async getPublicationPackageSnapshot(
    tenantId: string,
    packageId: string,
  ): Promise<PublicationPackageSnapshot | null> {
    const result = await this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.publicationPackages, {
      where: { tenant_id: tenantId, package_id: packageId }, perPage: 2,
    });
    assertTenantRows(result.items, tenantId);
    if (result.items.length > 1) throw new SocialChannelRepositoryError('social_publication_package_duplicate', 500);
    return result.items[0] ? snapshotFromRow(result.items[0], tenantId) : null;
  }

  async recordPublicationEvidence(input: {
    tenantId: string;
    packageId: string;
    evidence: PublicationEvidenceSubmission | ResolvedPublicationEvidence;
    status: PublicationPackageStatus;
    eventType: PublicationEvidenceEvent['eventType'];
    actorKind: PublicationEvidenceEvent['actorKind'];
    actorId: string;
    expectedCurrentEvidenceId?: string;
    updatedAt?: string;
  }): Promise<PublicationPackageSnapshot> {
    return serialize(`evidence:${input.tenantId}:${input.packageId}`, async () => {
      const lease = await acquireDurableOperationLease({
        dataStore: this.database,
        tenantId: input.tenantId,
        scope: 'social-publication-evidence',
        subjectId: input.packageId,
        ownerId: this.evidenceLeaseOwner,
        leaseDurationMs: 2 * 60_000,
      });
      if (!lease) throw new SocialChannelRepositoryError('social_publication_evidence_busy', 409);
      try {
      const rows = await this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.publicationPackages, {
        where: { tenant_id: input.tenantId, package_id: input.packageId }, perPage: 2,
      });
      assertTenantRows(rows.items, input.tenantId);
      if (rows.items.length !== 1) {
        throw new SocialChannelRepositoryError(rows.items.length ? 'social_publication_package_duplicate' : 'social_publication_package_not_found', rows.items.length ? 500 : 404);
      }
      const currentSnapshot = snapshotFromRow(rows.items[0], input.tenantId);
      const manifest = currentSnapshot.publicationPackage;
      if (input.evidence.packageId !== manifest.packageId
        || input.evidence.packageHash !== manifest.packageHash
        || input.evidence.contentHash !== manifest.contentHash) {
        throw new SocialChannelRepositoryError('social_publication_evidence_integrity_violation', 409);
      }
      if (!/^[a-z0-9:_-]{1,200}$/i.test(text(input.actorId))) {
        throw new SocialChannelRepositoryError('social_publication_evidence_actor_invalid', 400);
      }
      const expectedStatus: Record<PublicationEvidenceSubmission['verificationStatus'] | ResolvedPublicationEvidence['verificationStatus'], PublicationPackageStatus> = {
        pending: 'evidence_submitted',
        verified: 'published_verified',
        reconciliation_required: 'reconciliation_required',
        rejected: 'failed',
      };
      if (expectedStatus[input.evidence.verificationStatus] !== input.status) {
        throw new SocialChannelRepositoryError('social_publication_evidence_status_invalid', 409);
      }
      const current = currentSnapshot.currentEvidence;
      const verificationRequestId = input.evidence.verificationStatus === 'pending'
        ? undefined
        : input.evidence.verificationRequestId;
      const verificationReceiptHash = input.evidence.verificationStatus === 'pending'
        ? undefined
        : input.evidence.sourceReceiptHash;
      if (verificationRequestId) {
        const priorRequest = currentSnapshot.evidenceHistory.find(event => (
          event.evidence.verificationStatus !== 'pending'
          && 'verificationRequestId' in event.evidence
          && event.evidence.verificationRequestId === verificationRequestId
        ));
        if (priorRequest) {
          if (priorRequest.evidence.verificationStatus === 'pending'
            || priorRequest.evidence.sourceReceiptHash !== verificationReceiptHash) {
            throw new SocialChannelRepositoryError('social_publication_verification_idempotency_conflict', 409);
          }
          return currentSnapshot;
        }
      }
      const exactRepeat = current
        && current.evidenceId === input.evidence.evidenceId
        && current.evidenceHash === input.evidence.evidenceHash
        && current.verificationStatus === input.evidence.verificationStatus
        && (current.verificationStatus === 'pending'
          || current.sourceReceiptHash === (input.evidence as ResolvedPublicationEvidence).sourceReceiptHash);
      if (exactRepeat) return currentSnapshot;

      if (input.eventType === 'submitted') {
        if (current) throw new SocialChannelRepositoryError('social_publication_evidence_correction_required', 409);
        if (input.evidence.verificationStatus !== 'pending' || input.actorKind !== 'tenant_submitter') {
          throw new SocialChannelRepositoryError('social_publication_evidence_transition_invalid', 409);
        }
      } else if (input.eventType === 'corrected') {
        if (!current || input.actorKind !== 'tenant_submitter'
          || input.evidence.verificationStatus !== 'pending'
          || !input.expectedCurrentEvidenceId
          || input.expectedCurrentEvidenceId !== current.evidenceId
          || current.verificationStatus === 'verified') {
          throw new SocialChannelRepositoryError('social_publication_evidence_correction_invalid', 409);
        }
      } else {
        if (!current || input.actorKind !== 'internal_verifier'
          || input.evidence.verificationStatus === 'pending'
          || !input.expectedCurrentEvidenceId
          || input.expectedCurrentEvidenceId !== current.evidenceId
          || input.evidence.evidenceId !== current.evidenceId
          || input.evidence.evidenceHash !== current.evidenceHash
          || input.eventType !== input.evidence.verificationStatus) {
          throw new SocialChannelRepositoryError('social_publication_evidence_verification_invalid', 409);
        }
      }
      if (currentSnapshot.evidenceHistory.length >= 200) {
        throw new SocialChannelRepositoryError('social_publication_evidence_history_limit_reached', 409);
      }
      const recordedAt = input.updatedAt ?? new Date().toISOString();
      const eventId = `pevt_${stableSocialChannelHash({
        packageId: input.packageId,
        evidenceId: input.evidence.evidenceId,
        evidenceHash: input.evidence.evidenceHash,
        eventType: input.eventType,
        actorKind: input.actorKind,
        actorId: text(input.actorId),
        sourceReceiptHash: input.evidence.verificationStatus === 'pending'
          ? undefined : input.evidence.sourceReceiptHash,
      }).slice(0, 24)}`;
      const event: PublicationEvidenceEvent = {
        schemaVersion: 'publication-evidence-event.v1',
        eventId,
        packageId: input.packageId,
        evidenceId: input.evidence.evidenceId,
        evidenceHash: input.evidence.evidenceHash,
        eventType: input.eventType,
        actorKind: input.actorKind,
        actorId: text(input.actorId),
        recordedAt,
        ...(current ? { supersedesEvidenceId: current.evidenceId } : {}),
        evidence: input.evidence,
      };
      const nextHistory = [...currentSnapshot.evidenceHistory, event];
      const updated = await this.database.update(SOCIAL_CHANNEL_COLLECTIONS.publicationPackages, rows.items[0].id, {
        evidence: input.evidence,
        evidence_history: nextHistory,
        status: input.status,
        updated_at: recordedAt,
      });
      if (!updated) throw new SocialChannelRepositoryError('social_publication_evidence_write_failed');
      return {
        publicationPackage: { ...manifest, status: input.status },
        currentEvidence: input.evidence,
        evidenceHistory: nextHistory,
      };
      } finally {
        await releaseDurableOperationLease({ dataStore: this.database, lease });
      }
    });
  }

  async createAssistedSession(record: AssistedBrowserTaskRecord): Promise<void> {
    const created = await this.database.create(SOCIAL_CHANNEL_COLLECTIONS.assistedSessions, {
      tenant_id: record.tenantId,
      session_id: record.sessionId,
      package_id: record.packageId,
      channel_id: record.channelId,
      target_account_id: record.targetAccountId,
      token_digest: record.tokenDigest,
      status: record.status,
      session: record,
      expires_at: record.expiresAt,
      created_by: record.requestedBy,
      created_at: record.createdAt,
      updated_at: record.createdAt,
    });
    if (!created) throw new SocialChannelRepositoryError('social_assisted_session_write_failed');
  }

  async getAssistedSession(tenantId: string, sessionId: string): Promise<AssistedBrowserTaskRecord | null> {
    const rows = await this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.assistedSessions, {
      where: { tenant_id: tenantId, session_id: sessionId }, perPage: 2,
    });
    assertTenantRows(rows.items, tenantId);
    if (rows.items.length > 1) throw new SocialChannelRepositoryError('social_assisted_session_duplicate', 500);
    const session = rows.items[0] ? parseObject<AssistedBrowserTaskRecord>(rows.items[0].session) : null;
    if (rows.items[0] && !session) {
      throw new SocialChannelRepositoryError('social_assisted_session_integrity_violation', 500);
    }
    if (session && (session.tenantId !== tenantId || session.sessionId !== sessionId
      || session.tokenDigest !== text(rows.items[0].token_digest))) {
      throw new SocialChannelRepositoryError('social_assisted_session_integrity_violation', 500);
    }
    return session;
  }

  async updateAssistedSession(record: AssistedBrowserTaskRecord): Promise<void> {
    const rows = await this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.assistedSessions, {
      where: { tenant_id: record.tenantId, session_id: record.sessionId }, perPage: 2,
    });
    assertTenantRows(rows.items, record.tenantId);
    if (rows.items.length !== 1) throw new SocialChannelRepositoryError('social_assisted_session_not_found', 404);
    const previous = parseObject<AssistedBrowserTaskRecord>(rows.items[0].session);
    if (!previous || previous.tenantId !== record.tenantId || previous.sessionId !== record.sessionId
      || previous.packageId !== record.packageId || previous.packageHash !== record.packageHash
      || previous.contentHash !== record.contentHash || previous.tokenDigest !== record.tokenDigest) {
      throw new SocialChannelRepositoryError('social_assisted_session_integrity_violation', 500);
    }
    if (!await this.database.update(SOCIAL_CHANNEL_COLLECTIONS.assistedSessions, rows.items[0].id, {
      status: record.status,
      session: record,
      updated_at: new Date().toISOString(),
    })) throw new SocialChannelRepositoryError('social_assisted_session_write_failed');
  }

  async capabilityContext(
    tenantId: string,
    channelId: SocialChannelId,
    accountId?: string,
  ): Promise<ChannelCapabilityEvaluationContext> {
    if (!accountId) return {};
    const rows = await this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.connections, {
      where: { tenant_id: tenantId, channel_id: channelId, account_id: accountId }, perPage: 2,
    });
    assertTenantRows(rows.items, tenantId);
    if (rows.items.length > 1) throw new SocialChannelRepositoryError('social_channel_connection_duplicate', 500);
    const row = rows.items[0];
    if (!row || text(row.status) !== 'active') return {};
    const assistedBrowserE2E = ['passed', 'failed', 'not_run'].includes(text(row.assisted_browser_e2e))
      ? text(row.assisted_browser_e2e) as 'passed' | 'failed' | 'not_run' : 'not_run';
    if (channelId !== 'douyin_cn') return { assistedBrowserE2E };
    const approvedScopes = parseObject<unknown[]>(row.approved_scopes) ?? [];
    const tokenMetadata = parseObject<{ accessTokenExpiresAt?: unknown }>(row.token_metadata);
    const tokenExpiry = tokenMetadata?.accessTokenExpiresAt
      ? new Date(text(tokenMetadata.accessTokenExpiresAt)).getTime() : Number.NaN;
    const douyin: DouyinCapabilityContext = {
      applicationType: ['web', 'mobile', 'mini_program'].includes(text(row.application_type))
        ? text(row.application_type) as DouyinCapabilityContext['applicationType'] : 'unknown',
      approvedScopes: approvedScopes.map(text).filter(Boolean),
      tokenType: text(row.token_type) === 'user_access_token' ? 'user_access_token'
        : text(row.token_type) === 'client_token' ? 'client_token' : 'none',
      tokenHealth: !tokenMetadata?.accessTokenExpiresAt ? 'missing'
        : !Number.isFinite(tokenExpiry) ? 'unknown'
          : tokenExpiry > Date.now() ? 'valid' : 'expired',
      accountQualification: text(row.account_qualification) === 'eligible' ? 'eligible'
        : text(row.account_qualification) === 'ineligible' ? 'ineligible' : 'unknown',
      applicationReview: ['approved', 'pending', 'rejected'].includes(text(row.application_review))
        ? text(row.application_review) as DouyinCapabilityContext['applicationReview'] : 'unknown',
      realAccountE2E: ['passed', 'failed', 'not_run'].includes(text(row.real_account_e2e))
        ? text(row.real_account_e2e) as DouyinCapabilityContext['realAccountE2E'] : 'not_run',
      webhookConfigured: Boolean(text(row.credential_ref)),
    };
    return { assistedBrowserE2E, douyin };
  }

  async persistSyncPage(page: AccountContentSyncPage): Promise<void> {
    const tenantId = page.cursor.tenantId;
    for (const content of page.items) {
      if (content.tenantId !== tenantId) throw new SocialChannelRepositoryError('social_monitor_tenant_mismatch', 409);
      const rows = await this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.externalContents, {
        where: {
          tenant_id: tenantId, channel_id: content.channelId, account_id: content.accountId,
          external_content_id: content.externalContentId, source: content.source,
        }, perPage: 2,
      });
      assertTenantRows(rows.items, tenantId);
      if (rows.items.length > 1) throw new SocialChannelRepositoryError('social_external_content_duplicate', 500);
      const data = {
        tenant_id: tenantId, channel_id: content.channelId, account_id: content.accountId,
        external_content_id: content.externalContentId, source: content.source,
        status: content.status, public_url: content.publicUrl ?? '', linked_package_id: content.linkedPackageId ?? '',
        content, observed_at: content.observedAt, updated_at: new Date().toISOString(),
      };
      if (rows.items[0]) {
        if (!await this.database.update(SOCIAL_CHANNEL_COLLECTIONS.externalContents, rows.items[0].id, data)) {
          throw new SocialChannelRepositoryError('social_external_content_write_failed');
        }
      }
      else if (!await this.database.create(SOCIAL_CHANNEL_COLLECTIONS.externalContents, { ...data, created_at: new Date().toISOString() })) {
        throw new SocialChannelRepositoryError('social_external_content_write_failed');
      }
    }
    for (const snapshot of page.metricSnapshots) {
      if (snapshot.tenantId !== tenantId) throw new SocialChannelRepositoryError('social_monitor_tenant_mismatch', 409);
      const existing = await this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.metricSnapshots, {
        where: { tenant_id: tenantId, snapshot_id: snapshot.snapshotId }, perPage: 2,
      });
      assertTenantRows(existing.items, tenantId);
      if (existing.items.length > 1) throw new SocialChannelRepositoryError('social_metric_snapshot_duplicate', 500);
      if (!existing.items.length && !await this.database.create(SOCIAL_CHANNEL_COLLECTIONS.metricSnapshots, {
        tenant_id: tenantId, snapshot_id: snapshot.snapshotId, channel_id: snapshot.channelId,
        account_id: snapshot.accountId, external_content_id: snapshot.externalContentId ?? '',
        source: snapshot.source, captured_at: snapshot.capturedAt, freshness: snapshot.freshness, snapshot,
      })) throw new SocialChannelRepositoryError('social_metric_snapshot_write_failed');
    }
    const cursorRows = await this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.syncCursors, {
      where: {
        tenant_id: tenantId, channel_id: page.cursor.channelId,
        account_id: page.cursor.accountId, source: page.cursor.source,
      }, perPage: 2,
    });
    assertTenantRows(cursorRows.items, tenantId);
    if (cursorRows.items.length > 1) throw new SocialChannelRepositoryError('social_sync_cursor_duplicate', 500);
    const cursorData = {
      cursor_digest: page.cursor.cursorDigest,
      cursor: page.cursor,
      last_successful_sync_at: page.cursor.lastSuccessfulSyncAt ?? page.cursor.capturedAt,
      next_retry_at: page.cursor.nextRetryAt ?? '',
      consecutive_failures: 0,
      last_error_code: '',
      updated_at: new Date().toISOString(),
    };
    if (cursorRows.items[0]) {
      if (!await this.database.update(SOCIAL_CHANNEL_COLLECTIONS.syncCursors, cursorRows.items[0].id, cursorData)) {
        throw new SocialChannelRepositoryError('social_sync_cursor_write_failed');
      }
    }
    else if (!await this.database.create(SOCIAL_CHANNEL_COLLECTIONS.syncCursors, {
      tenant_id: tenantId, channel_id: page.cursor.channelId, account_id: page.cursor.accountId,
      source: page.cursor.source, ...cursorData,
    })) throw new SocialChannelRepositoryError('social_sync_cursor_write_failed');
  }

  async monitorOverview(tenantId: string): Promise<SocialMonitorOverview> {
    const [cursorRows, contentRows, metricRows] = await Promise.all([
      this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.syncCursors, { where: { tenant_id: tenantId }, sort: '-updated_at', perPage: 200 }),
      this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.externalContents, { where: { tenant_id: tenantId }, sort: '-observed_at', perPage: 100 }),
      this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.metricSnapshots, { where: { tenant_id: tenantId }, sort: '-captured_at', perPage: 100 }),
    ]);
    assertTenantRows(cursorRows.items, tenantId); assertTenantRows(contentRows.items, tenantId); assertTenantRows(metricRows.items, tenantId);
    return {
      accounts: cursorRows.items.map(row => ({
        channelId: text(row.channel_id) as SocialChannelId,
        accountId: text(row.account_id),
        source: text(row.source),
        ...(text(row.last_successful_sync_at) ? { lastSuccessfulSyncAt: text(row.last_successful_sync_at) } : {}),
        ...(text(row.next_retry_at) ? { nextRetryAt: text(row.next_retry_at) } : {}),
        consecutiveFailures: Number(row.consecutive_failures) || 0,
        ...(text(row.last_error_code) ? { lastErrorCode: text(row.last_error_code) } : {}),
      })),
      recentContents: contentRows.items.map(row => parseObject(row.content)).filter(Boolean),
      recentMetricSnapshots: metricRows.items.map(row => parseObject(row.snapshot)).filter(Boolean),
    };
  }

  async claimWebhookMessage(input: {
    tenantId: string;
    connectionId: string;
    messageId: string;
    receivedAt: string;
    payloadDigest: string;
  }): Promise<boolean> {
    let created: Stored | null = null;
    try {
      created = await this.database.create<Stored>(SOCIAL_CHANNEL_COLLECTIONS.webhookMessages, {
        tenant_id: input.tenantId, connection_id: input.connectionId, message_id: input.messageId,
        received_at: input.receivedAt, status: 'queued', payload_digest: input.payloadDigest,
      });
    } catch {
      // PocketBase reports unique-index contention as an exception. Re-read the
      // authoritative row below so a normal webhook retry still receives ACK.
    }
    if (created) return true;
    const existing = await this.database.list<Stored>(SOCIAL_CHANNEL_COLLECTIONS.webhookMessages, {
      where: { tenant_id: input.tenantId, connection_id: input.connectionId, message_id: input.messageId }, perPage: 2,
    });
    assertTenantRows(existing.items, input.tenantId);
    if (existing.items.length > 1) throw new SocialChannelRepositoryError('social_webhook_claim_integrity_violation', 500);
    if (existing.items[0]) {
      const row = existing.items[0];
      if (text(row.connection_id) !== input.connectionId
        || text(row.message_id) !== input.messageId
        || text(row.payload_digest) !== input.payloadDigest) {
        throw new SocialChannelRepositoryError('social_webhook_message_collision', 409);
      }
      return false;
    }
    throw new SocialChannelRepositoryError('social_webhook_claim_unavailable');
  }
}

export const socialChannelRepository = new SocialChannelRepository();
