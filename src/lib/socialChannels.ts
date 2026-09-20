import { authHeader } from './auth';

const BASE = '/api/overseas/social-channels';

export type SocialChannelId = 'douyin_cn' | 'tiktok_global' | 'instagram' | 'facebook' | 'youtube';

export type SocialChannelCapability = {
  channelId: SocialChannelId;
  label: string;
  status: 'available' | 'configuration_required' | 'authorization_required' | 'permission_pending' | 'unsupported';
  reason?: string;
  capabilities: Record<string, boolean>;
  lastVerifiedAt?: string;
};

export type MonitoredContent = {
  id: string;
  channelId: SocialChannelId;
  title: string;
  publishedAt?: string;
  platformUrl?: string;
  publishStatus?: string;
  source: 'official_api' | 'assisted_browser' | 'public_page' | 'manual' | string;
  capturedAt?: string;
  freshness?: 'fresh' | 'stale' | 'unknown' | string;
  metrics: Record<string, number | null>;
};

export type MonitorConnection = {
  id: string;
  channelId: SocialChannelId;
  displayName?: string;
  status: string;
  source?: string;
  lastSyncAt?: string;
  reason?: string;
};

export type SocialMonitorOverview = {
  status: string;
  source?: string;
  freshness?: string;
  lastSyncAt?: string;
  contents: MonitoredContent[];
  connections: MonitorConnection[];
  reconciliationRequired?: boolean;
  reason?: string;
};

export type PublicationAsset = {
  kind: 'video' | 'image' | 'cover' | 'subtitle' | 'document';
  fileName: string;
  downloadUrl: string;
  contentHash: string;
  mediaType?: string;
  byteSize?: number;
};

export type PublicationPackage = {
  packageId: string;
  contentId: string;
  contentVersion: string;
  contentHash: string;
  channelId: SocialChannelId;
  targetAccountId?: string;
  copy: { title: string; body: string; hashtags: string[]; firstComment?: string };
  assets: PublicationAsset[];
  specificationChecks: Array<{ code: string; status: string; message: string }>;
  sourceTracking?: Record<string, string>;
  publishingInstructions: string[];
  packageHash: string;
  generatedAt: string;
  status: string;
};

export type PublicationEvidence = {
  schemaVersion: 'publication-evidence.v1';
  evidenceId: string;
  packageId: string;
  channelId: SocialChannelId;
  method: 'manual_package' | 'assisted_browser' | 'official_api';
  contentHash: string;
  packageHash: string;
  externalContentId?: string;
  publicUrl?: string;
  submittedBy: string;
  submittedAt: string;
  verificationStatus: 'pending' | 'verified' | 'reconciliation_required' | 'rejected';
  evidenceHash: string;
  verifiedAt?: string;
  verifier?: 'official_api' | 'public_page' | 'assisted_session' | 'human_review';
  verifierIdentity?: string;
  sourceReceiptHash?: string;
  reviewNote?: string;
  rejectionReason?: string;
};

export type PublicationEvidenceEvent = {
  eventId: string;
  evidenceId: string;
  evidenceHash: string;
  eventType: 'submitted' | 'corrected' | 'verified' | 'rejected' | 'reconciliation_required';
  actorKind: 'tenant_submitter' | 'internal_verifier';
  recordedAt: string;
  supersedesEvidenceId?: string;
};

export type PublicationPackageSnapshot = {
  publicationPackage: PublicationPackage;
  currentEvidence: PublicationEvidence | null;
  evidenceHistory: PublicationEvidenceEvent[];
};

type CapabilityDecision = {
  availability: 'available' | 'unavailable' | 'unconfigured';
  reasonCode?: string;
  source?: string;
};

type CapabilityMatrix = {
  channelId: SocialChannelId;
  evaluatedAt?: string;
  decisions: Record<string, CapabilityDecision>;
};

type RawExternalContent = {
  channelId: SocialChannelId;
  accountId: string;
  externalContentId: string;
  title?: string;
  publishedAt?: string;
  publicUrl?: string;
  status?: string;
  source?: string;
  observedAt?: string;
};

type RawMetricSnapshot = {
  channelId: SocialChannelId;
  accountId: string;
  externalContentId?: string;
  source?: string;
  capturedAt?: string;
  freshness?: string;
  metrics?: Record<string, number | null>;
};

type RawMonitorOverview = {
  accounts?: Array<{
    channelId: SocialChannelId;
    accountId: string;
    source?: string;
    lastSuccessfulSyncAt?: string;
    consecutiveFailures?: number;
    lastErrorCode?: string;
  }>;
  recentContents?: RawExternalContent[];
  recentMetricSnapshots?: RawMetricSnapshot[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...authHeader(),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.message || data.error || '社媒渠道请求失败');
  return data;
}

function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `social-channel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function getPublishingVideoManifest(videoPath: string): Promise<PublicationAsset> {
  const response = await fetch('/api/overseas/publishing/local-videos/manifest', {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoPath }),
  });
  const data = await response.json().catch(() => ({})) as { asset?: PublicationAsset; error?: string; message?: string };
  if (!response.ok || !data.asset) throw new Error(data.message || data.error || '无法冻结视频版本');
  return data.asset;
}

export async function createSocialPublicationPackage(input: {
  channelId: SocialChannelId;
  contentId: string;
  contentVersion: string;
  contentHash: string;
  targetAccountId?: string;
  copy: { title: string; body: string; hashtags: string[]; firstComment?: string };
  assets: PublicationAsset[];
  sourceTracking?: Record<string, string>;
}): Promise<PublicationPackage> {
  const key = idempotencyKey();
  const data = await request<{ publicationPackage: PublicationPackage }>('/publication-packages', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ ...input, idempotencyKey: key }),
  });
  return data.publicationPackage;
}

export async function submitSocialPublicationEvidence(input: {
  publicationPackage: PublicationPackage;
  publicUrl?: string;
  externalContentId?: string;
  correctsEvidenceId?: string;
}): Promise<{
  evidence: PublicationEvidence;
  evidenceHistory: PublicationEvidenceEvent[];
  publicationStatus: string;
  reconciliationRequired: boolean;
  correctionAccepted: boolean;
  message?: string;
}> {
  return request(`/publication-packages/${encodeURIComponent(input.publicationPackage.packageId)}/evidence`, {
    method: 'POST',
    body: JSON.stringify({
      method: 'manual_package',
      contentHash: input.publicationPackage.contentHash,
      packageHash: input.publicationPackage.packageHash,
      publicUrl: input.publicUrl?.trim() || undefined,
      externalContentId: input.externalContentId?.trim() || undefined,
      correctsEvidenceId: input.correctsEvidenceId,
    }),
  });
}

export async function getSocialPublicationPackage(packageId: string): Promise<PublicationPackageSnapshot> {
  return request(`/publication-packages/${encodeURIComponent(packageId)}`);
}

export async function getSocialChannelCapabilities(): Promise<SocialChannelCapability[]> {
  const data = await request<{ items?: CapabilityMatrix[] }>('/capabilities');
  return (data.items ?? []).map(matrix => {
    const decisions = matrix.decisions ?? {};
    const enabled = Object.fromEntries(Object.entries(decisions).map(([key, value]) => [key, value.availability === 'available']));
    const availableNames = Object.entries(enabled).filter(([, value]) => value).map(([key]) => key);
    const officialReady = ['official_publish', 'content_list', 'content_metrics'].some(key => enabled[key]);
    const pending = Object.values(decisions).find(item => item.availability !== 'available');
    return {
      channelId: matrix.channelId,
      label: '',
      status: officialReady ? 'available' : availableNames.length ? 'configuration_required' : 'unsupported',
      reason: officialReady
        ? '官方账号能力已通过当前能力矩阵校验'
        : availableNames.includes('publication_package')
          ? '可生成发布包；账号发布与数据能力仍需配置和真实账号验收'
          : pending?.reasonCode || '当前渠道尚未配置',
      capabilities: enabled,
      lastVerifiedAt: matrix.evaluatedAt,
    };
  });
}

export async function getSocialMonitorOverview(): Promise<SocialMonitorOverview> {
  const data = await request<RawMonitorOverview & { overview?: RawMonitorOverview }>('/monitor/overview');
  const raw = data.overview ?? data;
  const snapshots = Array.isArray(raw.recentMetricSnapshots) ? raw.recentMetricSnapshots : [];
  const metricsByContent = new Map<string, RawMetricSnapshot>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.channelId}:${snapshot.accountId}:${snapshot.externalContentId || ''}`;
    if (!metricsByContent.has(key)) metricsByContent.set(key, snapshot);
  }
  const contents = (Array.isArray(raw.recentContents) ? raw.recentContents : []).map(content => {
    const metric = metricsByContent.get(`${content.channelId}:${content.accountId}:${content.externalContentId}`);
    return {
      id: `${content.channelId}:${content.accountId}:${content.externalContentId}`,
      channelId: content.channelId,
      title: content.title || '未命名内容',
      publishedAt: content.publishedAt,
      platformUrl: content.publicUrl,
      publishStatus: content.status,
      source: metric?.source || content.source || 'manual_import',
      capturedAt: metric?.capturedAt || content.observedAt,
      freshness: metric?.freshness || 'unknown',
      metrics: metric?.metrics ?? {},
    } satisfies MonitoredContent;
  });
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  const lastSyncAt = accounts.map(item => item.lastSuccessfulSyncAt || '').filter(Boolean).sort().at(-1);
  return {
    status: accounts.length ? 'ready' : 'not_configured',
    source: 'persisted_snapshots',
    freshness: contents.some(item => item.freshness === 'fresh') ? 'fresh' : 'unknown',
    lastSyncAt,
    contents,
    connections: accounts.map(item => ({
      id: `${item.channelId}:${item.accountId}`,
      channelId: item.channelId,
      displayName: item.accountId,
      status: item.lastErrorCode ? 'degraded' : 'connected',
      source: item.source,
      lastSyncAt: item.lastSuccessfulSyncAt,
      reason: item.lastErrorCode,
    })),
    reason: accounts.length ? undefined : '还没有通过真实渠道同步产生的数据；生成发布包不等于账号已经连接。',
  };
}

export async function requestSocialMonitorSync(channelId: SocialChannelId, accountId: string): Promise<{ status: string; message?: string }> {
  return request('/monitor/sync', {
    method: 'POST',
    body: JSON.stringify({ channelId, accountId }),
  });
}
