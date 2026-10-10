import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { adminUserForHttp, type AdminIdentity } from '../lib/demoAccounts.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import {
  buildPublicationEvidence,
  buildPublicationPackage,
  PublicationPackageError,
  resolvePublicationEvidence,
  stableSocialChannelHash,
} from '../publishing/publicationPackage.js';
import {
  confirmAssistedBrowserTask,
  createAssistedBrowserTask,
  AssistedBrowserSessionError,
} from '../publishing/assistedBrowserSession.js';
import { normalizeSocialChannelId } from '../../shared/contracts/socialChannels.js';
import type { SocialChannelId } from '../../shared/contracts/socialChannels.js';
import { ChannelAdapterError } from './adapter.js';
import { createDefaultChannelRegistry, socialChannelRegistry, type ChannelAdapterRegistry } from './registry.js';
import {
  SocialChannelRepository,
  SocialChannelRepositoryError,
  socialChannelRepository,
} from './repository.js';
import {
  acceptDouyinWebhook,
  DouyinWebhookError,
  type DouyinWebhookEnvelope,
} from './douyinWebhook.js';

export interface DouyinWebhookConfiguration {
  tenantId: string;
  connectionId: string;
  clientSecret: string;
}

export interface SocialChannelsRouterDependencies {
  registry?: ChannelAdapterRegistry;
  repository?: SocialChannelRepository;
  resolveRole?: (request: Request, userId: string) => Promise<unknown>;
  authorizeEvidenceVerifier?: (
    request: Request,
    response: Response,
  ) => Promise<AdminIdentity | null | undefined>;
  resolveOfficialAccessToken?: (input: {
    tenantId: string;
    channelId: SocialChannelId;
    accountId: string;
  }) => Promise<string | null>;
  resolveDouyinWebhookConfiguration?: (request: Request) => Promise<DouyinWebhookConfiguration | null>;
  enqueueDouyinWebhook?: (configuration: DouyinWebhookConfiguration, envelope: DouyinWebhookEnvelope) => void;
}

const MUTATION_ROLES = new Set(['super_admin', 'admin', 'social_operator']);
const text = (value: unknown): string => String(value ?? '').trim();
const validId = (value: unknown): boolean => /^[a-z0-9:_-]{1,240}$/i.test(text(value));

function statusForError(error: unknown): number {
  if (error instanceof PublicationPackageError
    || error instanceof AssistedBrowserSessionError
    || error instanceof ChannelAdapterError
    || error instanceof SocialChannelRepositoryError
    || error instanceof DouyinWebhookError) return error.status;
  return 503;
}

function codeForError(error: unknown): string {
  if (error instanceof PublicationPackageError
    || error instanceof AssistedBrowserSessionError
    || error instanceof ChannelAdapterError
    || error instanceof SocialChannelRepositoryError
    || error instanceof DouyinWebhookError) return error.code;
  return 'social_channels_unavailable';
}

function sendError(res: import('express').Response, error: unknown): void {
  const code = codeForError(error);
  res.status(statusForError(error)).json({ error: code, message: code });
}

async function withAckDeadline<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DouyinWebhookError('douyin_webhook_ack_deadline_exceeded', 503)), 4_500);
  });
  try { return await Promise.race([task, timeout]); } finally { if (timer) clearTimeout(timer); }
}

export function createSocialChannelsRouter(dependencies: SocialChannelsRouterDependencies = {}): Router {
  const router = Router();
  const registry = dependencies.registry ?? socialChannelRegistry;
  const repository = dependencies.repository ?? socialChannelRepository;
  const resolveRole = dependencies.resolveRole
    ?? ((request: Request, userId: string) => requestOrganizationRoleStrict(request.headers.authorization, userId));
  const authorizeEvidenceVerifier = dependencies.authorizeEvidenceVerifier ?? adminUserForHttp;

  // Webhooks authenticate with the platform signature, not a customer bearer token.
  // Keep this route before `requireAuth` and fail closed until a connection resolver
  // backed by encrypted tenant configuration is injected at composition time.
  router.post('/webhooks/douyin', async (req, res) => {
    try {
      const configuration = await dependencies.resolveDouyinWebhookConfiguration?.(req) ?? null;
      if (!configuration?.clientSecret || !validId(configuration.tenantId) || !validId(configuration.connectionId)
        || !dependencies.enqueueDouyinWebhook) {
        throw new DouyinWebhookError('douyin_webhook_not_configured', 503);
      }
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!(rawBody instanceof Buffer)) throw new DouyinWebhookError('douyin_webhook_raw_body_required', 503);
      const payloadDigest = createHash('sha256').update(rawBody).digest('hex');
      const accepted = await withAckDeadline(acceptDouyinWebhook({
        clientSecret: configuration.clientSecret,
        signatureHeader: req.headers['x-douyin-signature'],
        messageIdHeader: req.headers['msg-id'] ?? req.headers['x-douyin-msg-id'],
        rawBody,
        claimStore: {
          claim: (messageId, receivedAt) => repository.claimWebhookMessage({
            tenantId: configuration.tenantId,
            connectionId: configuration.connectionId,
            messageId,
            receivedAt,
            payloadDigest,
          }),
        },
        enqueue: envelope => dependencies.enqueueDouyinWebhook!(configuration, envelope),
      }));
      res.status(200).json({ ok: true, duplicate: accepted.duplicate });
    } catch (error) { sendError(res, error); }
  });

  router.use(requireAuth);

  router.post('/internal/tenants/:tenantId/publication-packages/:packageId/evidence/verify', async (req, res) => {
    try {
      const verifier = await authorizeEvidenceVerifier(req, res);
      if (verifier === undefined) return;
      if (!verifier) { res.status(403).json({ error: 'internal_evidence_verifier_required' }); return; }
      const tenantId = text(req.params.tenantId);
      const packageId = text(req.params.packageId);
      const evidenceId = text(req.body?.evidenceId);
      const decision = text(req.body?.decision);
      const reviewNote = text(req.body?.reviewNote).slice(0, 2_000);
      const verificationRequestId = text(req.headers['idempotency-key'] ?? req.body?.verificationRequestId);
      if (!validId(tenantId) || !validId(packageId) || !validId(evidenceId)) {
        throw new PublicationPackageError('publication_verification_target_invalid');
      }
      if (!['verified', 'rejected', 'reconciliation_required'].includes(decision)) {
        throw new PublicationPackageError('publication_verification_decision_invalid');
      }
      if (!reviewNote) throw new PublicationPackageError('publication_verification_note_required');
      if (!/^[a-z0-9:_-]{8,200}$/i.test(verificationRequestId)) {
        throw new PublicationPackageError('publication_verification_request_id_invalid');
      }
      if (decision === 'verified' && req.body?.contentMatchesFrozenVersion !== true) {
        throw new PublicationPackageError('publication_verification_frozen_match_required', 409);
      }
      const snapshot = await repository.getPublicationPackageSnapshot(tenantId, packageId);
      if (!snapshot) { res.status(404).json({ error: 'social_publication_package_not_found' }); return; }
      const current = snapshot.currentEvidence;
      if (!current || current.evidenceId !== evidenceId) {
        throw new PublicationPackageError('publication_verification_evidence_changed', 409);
      }
      const reviewedAt = new Date();
      const verifierIdentity = `internal_admin:${createHash('sha256').update(verifier.userId).digest('hex').slice(0, 24)}`;
      const sourceReceiptHash = stableSocialChannelHash({
        schemaVersion: 'manual-publication-review-receipt.v1',
        tenantId,
        packageId,
        evidenceId,
        evidenceHash: current.evidenceHash,
        decision,
        reviewNote,
        contentMatchesFrozenVersion: req.body?.contentMatchesFrozenVersion === true,
        verifierIdentity,
        verificationRequestId,
      });
      const resolution = resolvePublicationEvidence({
        package: snapshot.publicationPackage,
        evidence: current,
        verifier: 'human_review',
        verifierIdentity,
        verificationRequestId,
        sourceReceiptHash,
        publiclyObservable: decision === 'verified',
        observedContentHash: decision === 'verified' ? snapshot.publicationPackage.contentHash : undefined,
        rejectionReason: decision === 'rejected'
          ? text(req.body?.rejectionReason).slice(0, 1_000) || reviewNote
          : undefined,
        reviewNote,
        now: reviewedAt,
      });
      if (resolution.evidence.verificationStatus !== decision) {
        throw new PublicationPackageError('publication_verification_resolution_mismatch', 409);
      }
      const updated = await repository.recordPublicationEvidence({
        tenantId,
        packageId,
        evidence: resolution.evidence,
        status: resolution.packageStatus,
        eventType: resolution.evidence.verificationStatus,
        actorKind: 'internal_verifier',
        actorId: verifierIdentity,
        expectedCurrentEvidenceId: evidenceId,
        updatedAt: resolution.evidence.verifiedAt,
      });
      res.json({
        ...updated,
        verification: {
          status: resolution.evidence.verificationStatus,
          verifier: resolution.evidence.verifier,
          verifierIdentity: resolution.evidence.verifierIdentity,
          verificationRequestId,
          sourceReceiptHash: resolution.evidence.sourceReceiptHash,
          verifiedAt: resolution.evidence.verifiedAt,
        },
      });
    } catch (error) { sendError(res, error); }
  });

  router.use(async (req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method.toUpperCase())) { next(); return; }
    const { userId, supportAccess } = res.locals as AuthLocals;
    try {
      const role = await resolveRole(req, userId);
      if (supportAccess || !MUTATION_ROLES.has(String(role ?? ''))) {
        res.status(403).json({ error: 'social_channel_mutation_forbidden' }); return;
      }
      next();
    } catch {
      res.status(503).json({ error: 'social_channel_role_unavailable' });
    }
  });

  router.get('/capabilities', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const { tenantId } = res.locals as AuthLocals;
    try {
      const channelId = text(req.query.channelId) ? normalizeSocialChannelId(req.query.channelId) : null;
      if (text(req.query.channelId) && !channelId) throw new ChannelAdapterError('social_channel_invalid');
      const accountId = text(req.query.accountId) || undefined;
      const context = channelId
        ? await repository.capabilityContext(tenantId, channelId, accountId)
        : {};
      const items = channelId
        ? [registry.get(channelId).capabilityMatrix(context)]
        : registry.matrices(context);
      res.json({ items });
    } catch (error) { sendError(res, error); }
  });

  router.post('/publication-packages', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const channelId = normalizeSocialChannelId(req.body?.channelId);
      if (!channelId) throw new ChannelAdapterError('social_channel_invalid');
      const matrix = registry.get(channelId).capabilityMatrix();
      if (matrix.decisions.publication_package.availability !== 'available') {
        throw new ChannelAdapterError(matrix.decisions.publication_package.reasonCode ?? 'publication_package_unavailable', 409);
      }
      const idempotencyKey = text(req.headers['idempotency-key'] ?? req.body?.idempotencyKey);
      const manifest = buildPublicationPackage({
        tenantId,
        contentId: req.body?.contentId,
        contentVersion: req.body?.contentVersion,
        contentHash: req.body?.contentHash,
        channelId,
        targetAccountId: req.body?.targetAccountId,
        copy: req.body?.copy ?? {},
        assets: Array.isArray(req.body?.assets) ? req.body.assets : [],
        sourceTracking: req.body?.sourceTracking,
        idempotencyKey,
        registry,
      });
      const result = await repository.createPublicationPackage({ package: manifest, idempotencyKey, createdBy: userId });
      res.status(result.created ? 201 : 200).json({ publicationPackage: result.package, created: result.created });
    } catch (error) { sendError(res, error); }
  });

  router.get('/publication-packages/:packageId', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const snapshot = await repository.getPublicationPackageSnapshot(
        (res.locals as AuthLocals).tenantId,
        text(req.params.packageId),
      );
      if (!snapshot) { res.status(404).json({ error: 'social_publication_package_not_found' }); return; }
      res.json(snapshot);
    } catch (error) { sendError(res, error); }
  });

  router.post('/publication-packages/:packageId/evidence', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const currentSnapshot = await repository.getPublicationPackageSnapshot(tenantId, text(req.params.packageId));
      if (!currentSnapshot) { res.status(404).json({ error: 'social_publication_package_not_found' }); return; }
      const publicationPackage = currentSnapshot.publicationPackage;
      if (req.body?.method !== 'manual_package') {
        throw new PublicationPackageError('publication_evidence_method_not_allowed', 403);
      }
      const evidence = buildPublicationEvidence({
        package: publicationPackage,
        method: req.body?.method,
        contentHash: req.body?.contentHash,
        packageHash: req.body?.packageHash,
        externalContentId: req.body?.externalContentId,
        publicUrl: req.body?.publicUrl,
        providerReceiptHash: req.body?.providerReceiptHash,
        submittedBy: userId,
      });
      const isRepeat = currentSnapshot.currentEvidence?.evidenceId === evidence.evidenceId;
      const recorded = await repository.recordPublicationEvidence({
        tenantId,
        packageId: publicationPackage.packageId,
        evidence,
        status: 'evidence_submitted',
        eventType: currentSnapshot.currentEvidence ? 'corrected' : 'submitted',
        actorKind: 'tenant_submitter',
        actorId: userId,
        expectedCurrentEvidenceId: text(req.body?.correctsEvidenceId) || undefined,
      });
      res.status(202).json({
        evidence: recorded.currentEvidence,
        evidenceHistory: recorded.evidenceHistory,
        publicationStatus: 'evidence_submitted',
        reconciliationRequired: true,
        correctionAccepted: Boolean(currentSnapshot.currentEvidence && !isRepeat),
        message: 'evidence_requires_internal_human_verification',
      });
    } catch (error) { sendError(res, error); }
  });

  router.post('/assisted-sessions', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const publicationPackage = await repository.getPublicationPackage(tenantId, text(req.body?.packageId));
      if (!publicationPackage) { res.status(404).json({ error: 'social_publication_package_not_found' }); return; }
      if (!publicationPackage.targetAccountId) {
        throw new AssistedBrowserSessionError('assisted_browser_target_account_required');
      }
      const context = await repository.capabilityContext(
        tenantId,
        publicationPackage.channelId,
        publicationPackage.targetAccountId,
      );
      const assisted = registry.get(publicationPackage.channelId)
        .capabilityMatrix(context).decisions.assisted_browser_publish;
      if (assisted.availability !== 'available') {
        throw new ChannelAdapterError(assisted.reasonCode ?? 'assisted_browser_unavailable', 409);
      }
      const created = createAssistedBrowserTask({
        tenantId,
        packageId: publicationPackage.packageId,
        packageHash: publicationPackage.packageHash,
        contentHash: publicationPackage.contentHash,
        channelId: publicationPackage.channelId,
        targetAccountId: publicationPackage.targetAccountId,
        requestedBy: userId,
        callbackOrigin: req.body?.callbackOrigin,
        ttlMs: req.body?.ttlMs,
      });
      await repository.createAssistedSession(created.record);
      // The one-time token is returned only in this creation response; tokenDigest
      // and the server-only persistence projection are never exposed.
      res.status(201).json({ session: created.session, oneTimeToken: created.oneTimeToken });
    } catch (error) { sendError(res, error); }
  });

  router.post('/assisted-sessions/:sessionId/confirm', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const session = await repository.getAssistedSession(tenantId, text(req.params.sessionId));
      if (!session) { res.status(404).json({ error: 'social_assisted_session_not_found' }); return; }
      const confirmed = confirmAssistedBrowserTask({
        record: session,
        confirmed: req.body?.confirmed,
        confirmedBy: userId,
        packageHash: req.body?.packageHash,
        contentHash: req.body?.contentHash,
      });
      await repository.updateAssistedSession(confirmed);
      const { tokenDigest: _hidden, ...safeSession } = confirmed;
      res.json({ session: safeSession, publicationStatus: 'awaiting_publish_confirmation' });
    } catch (error) { sendError(res, error); }
  });

  router.get('/monitor/overview', async (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      res.json(await repository.monitorOverview((res.locals as AuthLocals).tenantId));
    } catch (error) { sendError(res, error); }
  });

  router.post('/monitor/sync', async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    try {
      const channelId = normalizeSocialChannelId(req.body?.channelId);
      const accountId = text(req.body?.accountId);
      if (!channelId || !validId(accountId)) throw new ChannelAdapterError('social_monitor_target_invalid');
      const adapter = registry.get(channelId);
      const context = await repository.capabilityContext(tenantId, channelId, accountId);
      const capability = adapter.capabilityMatrix(context).decisions.content_list;
      if (capability.availability !== 'available' || !adapter.syncAccountContent) {
        throw new ChannelAdapterError(capability.reasonCode ?? 'social_monitor_unavailable', 409);
      }
      const accessToken = await dependencies.resolveOfficialAccessToken?.({ tenantId, channelId, accountId }) ?? null;
      if (!accessToken) throw new ChannelAdapterError('social_monitor_credential_unavailable', 503);
      const page = await adapter.syncAccountContent({ tenantId, accountId, accessToken, capabilityContext: context });
      await repository.persistSyncPage(page);
      res.status(202).json({
        status: 'sync_completed',
        source: page.source,
        coverage: page.coverage,
        itemCount: page.items.length,
        capturedAt: page.cursor.capturedAt,
        freshness: page.metricSnapshots.some(snapshot => snapshot.freshness === 'stale') ? 'stale' : 'fresh',
      });
    } catch (error) { sendError(res, error); }
  });

  return router;
}

export const socialChannelsRouter = createSocialChannelsRouter();

// Exported for composition tests and deployments that explicitly configure the
// Douyin official port. The default registry remains fail-closed.
export { createDefaultChannelRegistry };
