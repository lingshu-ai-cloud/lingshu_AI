import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { HeyGenClient } from '../lib/heygen.js';
import { studioPaidBudget, type StudioPaidBudget } from '../lib/studioPaidBudget.js';
import { objectStorageEnabled, objectStorageHead, objectStorageUpload } from '../storage/objectStorage.js';
import { materialAssetObjectKey } from '../storage/materialAssets.js';
import { readLocalMaterials, saveLocalMaterials } from '../lib/materialLibrary.js';
import type {
  AuthorizedDigitalPresenter,
  SocialDigitalPresenterBridgePorts,
} from './socialContentDigitalPresenterAdapter.js';
import { validateHeyGenPresenterRecord } from '../lib/presenterAssetTrust.js';
import { recordCurrentContentProviderReceipt } from '../contentExecution/context.js';

type PresenterRecord = Record<string, unknown> & {
  id?: string; name?: string; authorized?: boolean; assetVersion?: number;
  avatarId?: string; voiceId?: string; authorizationRef?: string; consentRef?: string;
  socialAccountId?: string; presenterProfileId?: string; presenterProfileVersion?: string; consistencyKey?: string;
  rightsEvidence?: unknown;
  toolMappings?: { heygen?: { avatarId?: string; voiceId?: string } };
};

export interface SocialHeyGenPresenterAudit {
  total: number;
  executable: number;
  missingByPresenter: Array<{ presenterAssetId: string; requirements: string[] }>;
}

/** Audits tenant-scoped presenter mappings without returning provider IDs or
 * authorization references. This is safe to expose in readiness diagnostics. */
export function auditSocialHeyGenPresenters(items: PresenterRecord[]): SocialHeyGenPresenterAudit {
  const missingByPresenter = items.map((item, index) => {
    const requirements = [
      item.authorized !== true && 'authorized=true',
      !String(item.toolMappings?.heygen?.avatarId || item.avatarId || '').trim() && 'HeyGen avatarId',
      !String(item.toolMappings?.heygen?.voiceId || item.voiceId || '').trim() && 'HeyGen voiceId',
      !String(item.authorizationRef || '').trim() && 'authorizationRef',
      !String(item.consentRef || '').trim() && 'consentRef',
    ].filter(Boolean) as string[];
    return { presenterAssetId: String(item.id || `presenter-${index + 1}`), requirements };
  }).filter(item => item.requirements.length > 0);
  return { total: items.length, executable: items.length - missingByPresenter.length, missingByPresenter };
}

export interface SocialHeyGenBridgeDependencies {
  store: DataStore;
  client: Pick<HeyGenClient, 'create' | 'status'>;
  budget: Pick<StudioPaidBudget, 'status' | 'reserve'>;
  storageReady: () => boolean;
  download: (url: string) => Promise<Buffer>;
  upload: typeof objectStorageUpload;
  head: typeof objectStorageHead;
  pollIntervalMs?: number;
  maxPolls?: number;
}

export interface SocialHeyGenBridgeReadiness {
  ready: boolean;
  reasons: string[];
}

export function socialHeyGenBridgeReadiness(input: {
  enabled?: string; generationEnabled?: string; apiKey?: string; storageReady: boolean;
  budget: { allowed: boolean; reservationCny: number | null; reason: string };
}): SocialHeyGenBridgeReadiness {
  const reasons = [
    ...(input.enabled === 'true' ? [] : ['SOCIAL_CONTENT_HEYGEN_ENABLED']),
    ...(input.generationEnabled === 'true' ? [] : ['HEYGEN_GENERATION_ENABLED']),
    ...(String(input.apiKey || '').trim() ? [] : ['HEYGEN_API_KEY']),
    ...(input.storageReady ? [] : ['对象存储']),
    ...(input.budget.allowed && Number(input.budget.reservationCny) > 0 ? [] : [`付费预算：${input.budget.reason || '未配置正数预留额'}`]),
  ];
  return { ready: reasons.length === 0, reasons };
}

function safeOutputUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && /(^|\.)heygen\.(ai|com)$/i.test(url.hostname);
  } catch { return false; }
}

async function defaultDownload(raw: string): Promise<Buffer> {
  if (!safeOutputUrl(raw)) throw new Error('heygen_output_url_untrusted');
  const response = await fetch(raw, { redirect: 'error', signal: AbortSignal.timeout(90_000) });
  if (!response.ok || !response.body) throw new Error(`heygen_output_download_failed:${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000 || bytes.length > 110 * 1024 * 1024) throw new Error('heygen_output_size_invalid');
  return bytes;
}

function configuredPresenter(item: PresenterRecord, presenterAssetId: string): AuthorizedDigitalPresenter | null {
  if (String(item.id || '') !== presenterAssetId) return null;
  const validated = validateHeyGenPresenterRecord(item);
  if (!validated.ok) return null;
  return { presenterAssetId, providerId: 'heygen', providerPresenterId: validated.avatarId, providerVoiceId: validated.voiceId,
    authorizationRef: validated.rights.authorizationRef, consentRef: validated.rights.consentRef,
    assetVersion: validated.assetVersion, authorized: true,
    socialAccountId: String(item.socialAccountId || '') || undefined,
    presenterProfileId: String(item.presenterProfileId || '') || undefined,
    presenterProfileVersion: String(item.presenterProfileVersion || '') || undefined,
    consistencyKey: String(item.consistencyKey || '') || undefined };
}

/** Creates the concrete ports used by the social adapter. The environment
 * gate lives outside this function so tests and alternate runtimes can inject
 * deterministic dependencies without enabling a paid supplier. */
export function createSocialHeyGenBridgePorts(deps: SocialHeyGenBridgeDependencies): SocialDigitalPresenterBridgePorts {
  const polls = Math.max(1, Math.min(240, deps.maxPolls ?? 120));
  const pollInterval = Math.max(0, deps.pollIntervalMs ?? 5_000);
  return {
    maximumCostCny: Number(deps.budget.status('heygen').reservationCny) || 0,
    // This bridge is the current talking-presenter integration. It does not
    // claim guided body action, product contact, face application, reference
    // motion, custom environment or camera-path support.
    capabilities: {
      methods: ['talking'],
      controls: ['scripted_speech', 'timing_control'],
    },
    async resolvePresenter({ tenantId, presenterAssetId, socialAccountId }) {
      const result = await deps.store.list<{ payload?: { presenters?: PresenterRecord[] } }>('studio_production_defaults',
        { where: { tenant_id: tenantId }, perPage: 2 });
      if (result.totalItems !== 1 || result.items.length !== 1) return null;
      return (result.items[0]?.payload?.presenters || [])
        .filter(item => !socialAccountId || item.socialAccountId === socialAccountId)
        .map(item => configuredPresenter(item, presenterAssetId)).find(Boolean) || null;
    },
    async authorizeBudget({ idempotencyKey, maximumCostCny }) {
      if (!deps.storageReady()) return { allowed: false, reason: 'object_storage_unavailable' };
      const status = deps.budget.status('heygen');
      if (!status.allowed || !(Number(status.reservationCny) > 0)) return { allowed: false, reason: status.reason || 'budget_unavailable' };
      if (Number(status.reservationCny) > maximumCostCny) return { allowed: false, reason: 'reservation_exceeds_shot_limit' };
      await deps.budget.reserve('heygen', idempotencyKey);
      return { allowed: true, reservationRef: idempotencyKey };
    },
    async execute(input) {
      const existing = await deps.store.list<any>('studio_social_presenter_jobs',
        { where: { tenant_id: input.tenantId, request_id: input.idempotencyKey }, perPage: 2 });
      if (existing.totalItems > 1) return { status: 'uncertain', error: 'duplicate_provider_job_records' };
      let record = existing.items[0];
      let providerTaskId = String(record?.provider_task_id || '');
      if (!record) {
        record = await deps.store.create<any>('studio_social_presenter_jobs', { tenant_id: input.tenantId,
          task_id: input.taskId, shot_id: input.shotId, request_id: input.idempotencyKey, status: 'submitting',
          provider: 'heygen', presenter_asset_id: input.presenter.presenterAssetId, authorization_ref: input.presenter.authorizationRef,
          consent_ref: input.presenter.consentRef, social_account_id: input.presenter.socialAccountId || '',
          presenter_profile_id: input.presenter.presenterProfileId || '', presenter_profile_version: input.presenter.presenterProfileVersion || '',
          presenter_consistency_key: input.presenter.consistencyKey || '', visual_control: input.visualControl,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        if (!record) return { status: 'uncertain', error: 'provider_job_claim_failed' };
        try {
          await recordCurrentContentProviderReceipt({
            provider: 'heygen', requestId: input.idempotencyKey, state: 'submitting',
            metadata: { reservationRef: input.reservationRef },
          });
          providerTaskId = await deps.client.create({ avatarId: input.presenter.providerPresenterId,
            voiceId: input.presenter.providerVoiceId, script: input.script, ratio: input.aspectRatio,
            transparent: false, title: `灵枢社媒镜头 ${input.shotId}` }, input.idempotencyKey);
          await deps.store.update('studio_social_presenter_jobs', record.id, { provider_task_id: providerTaskId,
            status: 'pending', updated_at: new Date().toISOString() });
          await recordCurrentContentProviderReceipt({
            provider: 'heygen', requestId: input.idempotencyKey, state: 'accepted', providerTaskId,
            metadata: { reservationRef: input.reservationRef },
          });
        } catch (error) {
          await deps.store.update('studio_social_presenter_jobs', record.id, { status: 'uncertain',
            error: String(error instanceof Error ? error.message : error), updated_at: new Date().toISOString() });
          await recordCurrentContentProviderReceipt({
            provider: 'heygen', requestId: input.idempotencyKey, state: 'unknown',
            metadata: { reservationRef: input.reservationRef },
          });
          return { status: 'uncertain', error: 'provider_submission_uncertain' };
        }
      }
      if (!providerTaskId) {
        await recordCurrentContentProviderReceipt({
          provider: 'heygen', requestId: input.idempotencyKey, state: 'unknown',
          metadata: { reservationRef: input.reservationRef },
        });
        return { status: 'uncertain', error: 'provider_task_id_missing' };
      }
      await recordCurrentContentProviderReceipt({
        provider: 'heygen', requestId: input.idempotencyKey, state: 'accepted', providerTaskId,
        metadata: { reservationRef: input.reservationRef },
      });
      let completed: Awaited<ReturnType<HeyGenClient['status']>> | null = null;
      for (let index = 0; index < polls; index += 1) {
        const status = await deps.client.status(providerTaskId);
        if (status.status === 'failed') {
          await recordCurrentContentProviderReceipt({
            provider: 'heygen', requestId: input.idempotencyKey, state: 'failed', providerTaskId,
            metadata: { providerError: status.error || 'provider_failed' },
          });
          return { status: 'failed', providerTaskId, error: status.error || 'provider_failed' };
        }
        if (status.status === 'completed') { completed = status; break; }
        if (pollInterval) await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
      const duration = Number(completed?.duration);
      if (!completed?.url || !(duration > 0)) return { status: 'pending', providerTaskId, error: 'provider_still_processing' };
      const bytes = await deps.download(completed.url);
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const filename = `social-presenter-${createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 24)}.mp4`;
      const localPath = path.join(input.outputDirectory, filename);
      fs.writeFileSync(localPath, bytes, { mode: 0o600 });
      const objectKey = materialAssetObjectKey(input.tenantId, filename);
      await deps.upload({ key: objectKey, body: bytes, contentType: 'video/mp4' });
      const stored = await deps.head(objectKey);
      if (!stored?.size || !stored.etag) throw new Error('digital_presenter_object_storage_verification_failed');
      const materialId = `social-presenter-${createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 24)}`;
      const materials = readLocalMaterials();
      saveLocalMaterials([...materials.filter(item => !(item.id === materialId && item.tenantId === input.tenantId)), {
        id: materialId, name: `社媒数字人口播 · ${input.shotId}`, folder: 'presenter', type: 'video',
        duration, size: `${bytes.length} B`, file: '', url: '', objectKey,
        objectEtag: String(stored.etag), contentSha256: contentHash, scope: 'own', tenantId: input.tenantId,
        usage: 'editable', sourceType: 'heygen', sourceExecutionId: providerTaskId, createdAt: new Date().toISOString(),
      }]);
      await deps.store.update('studio_social_presenter_jobs', record.id, { status: 'completed', provider_task_id: providerTaskId,
        material_id: materialId, object_key: objectKey, content_sha256: contentHash, updated_at: new Date().toISOString() });
      await recordCurrentContentProviderReceipt({
        provider: 'heygen', requestId: input.idempotencyKey, state: 'completed', providerTaskId,
        metadata: { reservationRef: input.reservationRef, materialId, objectKey, contentHash, duration },
      });
      return { status: 'completed', providerTaskId, localPath, contentHash, duration };
    },
  };
}

export function createEnvironmentSocialHeyGenBridge(store: DataStore): {
  readiness: SocialHeyGenBridgeReadiness;
  ports: SocialDigitalPresenterBridgePorts | null;
} {
  const budget = studioPaidBudget.status('heygen');
  const readiness = socialHeyGenBridgeReadiness({ enabled: process.env.SOCIAL_CONTENT_HEYGEN_ENABLED,
    generationEnabled: process.env.HEYGEN_GENERATION_ENABLED, apiKey: process.env.HEYGEN_API_KEY,
    storageReady: objectStorageEnabled(), budget });
  if (!readiness.ready) return { readiness, ports: null };
  return { readiness, ports: createSocialHeyGenBridgePorts({ store,
    client: new HeyGenClient(process.env.HEYGEN_API_KEY || ''), budget: studioPaidBudget,
    storageReady: objectStorageEnabled, download: defaultDownload, upload: objectStorageUpload, head: objectStorageHead }) };
}
