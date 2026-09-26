import type { PublishDeliveryMode } from '../components/publishing/schedulePolicy';

export type PublishPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';
export type PublishWorkflowContext = { runId: string; taskId: string; taskKey: string };
export type StudioGenerationKind = 'script' | 'poster';

export type StudioGenerationFields = {
  generationKind?: StudioGenerationKind;
  generationProvenance?: string;
  qualityStatus?: string;
  publishable?: boolean;
  generationRecordId?: string;
};

export type CopyAuditRecord = {
  enterpriseFactsHash: string;
  sourceHash: string;
  outputHash: string;
  checkedAt: string;
  projectId?: string | null;
  targetPlatforms: PublishPlatform[];
};

export type PublishDraftItem = StudioGenerationFields & {
  videoPath?: string;
  sourceVideoPath?: string;
  previewUrl?: string;
  title: string;
  description: string;
  ratio?: string;
  sourceProjectId?: string;
  platform?: PublishPlatform;
  workflowRunId?: string;
  workflowTaskId?: string;
  workflowTaskKey?: string;
};

export type PublishDraft = PublishDraftItem & {
  items?: PublishDraftItem[];
};
export type PlatformCopy = {
  title?: string;
  description?: string;
  caption?: string;
  text?: string;
  tags?: string[];
  hashtags?: string[];
  firstComment?: string;
};

export type DirectPublishResponse = {
  ok: boolean;
  video?: unknown;
  tracking?: unknown;
  publishRecord?: unknown;
  deliveryStatus?: unknown;
  providerReceiptId?: unknown;
  platformPostId?: unknown;
  platformUrl?: unknown;
};

export type PublishTargetDeliveryResult = {
  platform: PublishPlatform;
  deliveryStatus: 'published' | 'provider_accepted' | 'unknown';
  providerReceiptId?: string;
  platformPostId?: string;
  platformUrl?: string;
};

export function classifyDirectPublishResponse(platform: PublishPlatform, value: unknown): PublishTargetDeliveryResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('平台没有返回发布状态');
  const result = value as DirectPublishResponse;
  if (result.ok !== true) throw new Error('平台没有确认接收发布请求');
  const deliveryStatus = String(result.deliveryStatus || '').trim();
  const providerReceiptId = String(result.providerReceiptId || '').trim();
  const platformPostId = String(result.platformPostId || '').trim();
  const platformUrl = String(result.platformUrl || '').trim();
  if (deliveryStatus === 'provider_accepted') {
    if (!providerReceiptId) throw new Error('平台已受理发布，但没有返回可追踪回执');
    return {
      platform,
      deliveryStatus: 'provider_accepted',
      providerReceiptId,
      ...(platformUrl ? { platformUrl } : {}),
    };
  }
  if (deliveryStatus !== 'published' || !platformPostId) {
    throw new Error('平台尚未返回最终发布回执');
  }
  return {
    platform,
    deliveryStatus: 'published',
    platformPostId,
    ...(providerReceiptId ? { providerReceiptId } : {}),
    ...(platformUrl ? { platformUrl } : {}),
  };
}

export type PublishItemStatus = 'draft' | 'ready' | 'publishing' | 'provider_processing' | 'scheduled' | 'published' | 'partial' | 'failed';
export type DeliveryMode = PublishDeliveryMode;

export type PublishQueueItem = StudioGenerationFields & {
  id: string;
  selected: boolean;
  videoPath: string;
  sourceVideoPath: string;
  previewUrl?: string;
  title: string;
  description: string;
  ratio?: string;
  sourceProjectId?: string;
  sourcePlatform?: PublishPlatform;
  workflowRunId?: string;
  workflowTaskId?: string;
  workflowTaskKey?: string;
  targetAccountIds: string[];
  platformCopy: Record<string, PlatformCopy>;
  firstComment: string;
  trackWaLink: boolean;
  deliveryMode: DeliveryMode;
  scheduledAt: string;
  calendarPostIds?: string[];
  status: PublishItemStatus;
  completedTargets: number;
  deliveryResults: Record<string, PublishTargetDeliveryResult>;
  copyAudit?: CopyAuditRecord;
  error?: string;
};

/** A partial retry must not submit accounts already accepted by a provider. */
export function pendingDirectPublishAccountIds(item: PublishQueueItem, connectedAccountIds: readonly string[]): string[] {
  return connectedAccountIds.filter(accountId =>
    item.targetAccountIds.includes(accountId) && !item.deliveryResults[accountId],
  );
}

export function directPublishOutcome(
  targetAccountIds: readonly string[],
  deliveryResults: Readonly<Record<string, PublishTargetDeliveryResult>>,
  failedCount: number,
): { status: 'published' | 'provider_processing' | 'partial' | 'failed'; allPublished: boolean } {
  const deliveries = targetAccountIds.map(id => deliveryResults[id]).filter(Boolean);
  const allPublished = targetAccountIds.length > 0
    && deliveries.length === targetAccountIds.length
    && deliveries.every(delivery => delivery.deliveryStatus === 'published');
  if (allPublished && failedCount === 0) return { status: 'published', allPublished };
  if (deliveries.length === targetAccountIds.length && failedCount === 0
    && deliveries.every(delivery => delivery.deliveryStatus !== 'unknown')) {
    return { status: 'provider_processing', allPublished: false };
  }
  return { status: deliveries.length ? 'partial' : 'failed', allPublished: false };
}
export function publishItemId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `publish-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const PUBLISH_PLATFORMS = new Set<PublishPlatform>(['youtube', 'tiktok', 'instagram', 'facebook']);
const PUBLISH_ITEM_STATUSES = new Set<PublishItemStatus>(['draft', 'ready', 'publishing', 'provider_processing', 'scheduled', 'published', 'partial', 'failed']);
const PUBLISH_DELIVERY_MODES = new Set<DeliveryMode>(['now', 'flexible', 'schedule']);

function storedString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function storedOptionalString(value: unknown): string | undefined {
  const normalized = storedString(value);
  return normalized || undefined;
}

function storedStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

function storedPlatform(value: unknown): PublishPlatform | undefined {
  return typeof value === 'string' && PUBLISH_PLATFORMS.has(value as PublishPlatform)
    ? value as PublishPlatform
    : undefined;
}

function storedGenerationKind(value: unknown): StudioGenerationKind | undefined {
  return value === 'script' || value === 'poster' ? value : undefined;
}

function normalizedGenerationFields(value: Record<string, unknown>): StudioGenerationFields {
  return {
    generationKind: storedGenerationKind(value.generationKind),
    generationProvenance: storedOptionalString(value.generationProvenance),
    qualityStatus: storedOptionalString(value.qualityStatus),
    publishable: value.publishable === true,
    generationRecordId: storedOptionalString(value.generationRecordId),
  };
}

function normalizedCopyAudit(value: unknown): CopyAuditRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const enterpriseFactsHash = storedString(record.enterpriseFactsHash);
  const sourceHash = storedString(record.sourceHash);
  const outputHash = storedString(record.outputHash);
  const checkedAt = storedString(record.checkedAt);
  const targetPlatforms = storedStringArray(record.targetPlatforms).filter(item => PUBLISH_PLATFORMS.has(item as PublishPlatform)) as PublishPlatform[];
  if (![enterpriseFactsHash, sourceHash, outputHash].every(item => /^[a-f0-9]{64}$/i.test(item)) || !checkedAt || !targetPlatforms.length) return undefined;
  return { enterpriseFactsHash, sourceHash, outputHash, checkedAt, targetPlatforms, projectId: storedOptionalString(record.projectId) || null };
}

export function studioGenerationIsVerified(value: StudioGenerationFields): boolean {
  return value.generationKind === 'script' || value.generationKind === 'poster'
    ? value.generationProvenance === 'ai'
      && value.qualityStatus === 'passed'
      && value.publishable === true
      && Boolean(value.generationRecordId?.trim())
    : false;
}

function normalizeStoredPlatformCopy(value: unknown): Record<string, PlatformCopy> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([platform, rawCopy]) => {
    if (!rawCopy || typeof rawCopy !== 'object' || Array.isArray(rawCopy)) return [];
    const copy = rawCopy as Record<string, unknown>;
    return [[platform, {
      title: storedOptionalString(copy.title),
      description: storedOptionalString(copy.description),
      caption: storedOptionalString(copy.caption),
      text: storedOptionalString(copy.text),
      tags: storedStringArray(copy.tags),
      hashtags: storedStringArray(copy.hashtags),
      firstComment: storedOptionalString(copy.firstComment),
    } satisfies PlatformCopy]];
  }));
}

function normalizeStoredDeliveryResults(value: unknown): Record<string, PublishTargetDeliveryResult> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized: Record<string, PublishTargetDeliveryResult> = {};
  for (const [accountId, rawResult] of Object.entries(value as Record<string, unknown>)) {
    if (!accountId.trim() || !rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) continue;
    const result = rawResult as Record<string, unknown>;
    const platform = storedPlatform(result.platform);
    const deliveryStatus = result.deliveryStatus;
    const providerReceiptId = storedOptionalString(result.providerReceiptId);
    const platformPostId = storedOptionalString(result.platformPostId);
    const platformUrl = storedOptionalString(result.platformUrl);
    if (!platform) continue;
    if (deliveryStatus === 'provider_accepted' && providerReceiptId) {
      normalized[accountId] = { platform, deliveryStatus, providerReceiptId, ...(platformUrl ? { platformUrl } : {}) };
      continue;
    }
    if (deliveryStatus === 'published' && platformPostId) {
      normalized[accountId] = { platform, deliveryStatus, platformPostId, ...(providerReceiptId ? { providerReceiptId } : {}), ...(platformUrl ? { platformUrl } : {}) };
      continue;
    }
    if (deliveryStatus === 'unknown') {
      normalized[accountId] = { platform, deliveryStatus, ...(providerReceiptId ? { providerReceiptId } : {}) };
    }
  }
  return normalized;
}

export function normalizeStoredPublishDraft(value: unknown): PublishDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const normalizeItem = (item: unknown): PublishDraftItem | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    return {
      ...normalizedGenerationFields(record),
      videoPath: storedOptionalString(record.videoPath),
      sourceVideoPath: storedOptionalString(record.sourceVideoPath),
      previewUrl: storedOptionalString(record.previewUrl),
      title: storedString(record.title),
      description: storedString(record.description),
      ratio: storedOptionalString(record.ratio),
      sourceProjectId: storedOptionalString(record.sourceProjectId),
      platform: storedPlatform(record.platform),
      workflowRunId: storedOptionalString(record.workflowRunId),
      workflowTaskId: storedOptionalString(record.workflowTaskId),
      workflowTaskKey: storedOptionalString(record.workflowTaskKey),
    };
  };
  const base = normalizeItem(raw);
  if (!base) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.map(normalizeItem).filter((item): item is PublishDraftItem => Boolean(item))
    : [];
  return items.length ? { ...base, items } : base;
}

export function normalizeStoredPublishQueueItem(value: unknown): PublishQueueItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = storedString(raw.id).trim();
  if (!id) return null;
  const status = typeof raw.status === 'string' && PUBLISH_ITEM_STATUSES.has(raw.status as PublishItemStatus)
    ? raw.status as PublishItemStatus
    : 'draft';
  const deliveryMode = typeof raw.deliveryMode === 'string' && PUBLISH_DELIVERY_MODES.has(raw.deliveryMode as DeliveryMode)
    ? raw.deliveryMode as DeliveryMode
    : 'now';
  const completedTargets = Number(raw.completedTargets);
  return {
    ...normalizedGenerationFields(raw),
    id,
    selected: raw.selected === true,
    videoPath: storedString(raw.videoPath),
    sourceVideoPath: storedString(raw.sourceVideoPath) || storedString(raw.videoPath),
    previewUrl: storedOptionalString(raw.previewUrl),
    title: storedString(raw.title),
    description: storedString(raw.description),
    ratio: storedOptionalString(raw.ratio),
    sourceProjectId: storedOptionalString(raw.sourceProjectId),
    sourcePlatform: storedPlatform(raw.sourcePlatform),
    workflowRunId: storedOptionalString(raw.workflowRunId),
    workflowTaskId: storedOptionalString(raw.workflowTaskId),
    workflowTaskKey: storedOptionalString(raw.workflowTaskKey),
    targetAccountIds: storedStringArray(raw.targetAccountIds),
    platformCopy: normalizeStoredPlatformCopy(raw.platformCopy),
    firstComment: storedString(raw.firstComment),
    trackWaLink: raw.trackWaLink !== false,
    deliveryMode,
    scheduledAt: storedString(raw.scheduledAt),
    calendarPostIds: storedStringArray(raw.calendarPostIds),
    status,
    completedTargets: Number.isFinite(completedTargets) ? Math.max(0, completedTargets) : 0,
    deliveryResults: normalizeStoredDeliveryResults(raw.deliveryResults),
    copyAudit: normalizedCopyAudit(raw.copyAudit),
    error: storedOptionalString(raw.error),
  };
}

export function titleFromVideoPath(videoPath: string) {
  const filename = videoPath.trim().split(/[\\/]/).pop() || '';
  return filename.replace(/\.(mp4|mov|webm|mkv|avi)$/i, '') || '未命名视频';
}

export function browserVideoUrl(value: string | undefined): string {
  const candidate = String(value || '').trim();
  if (/^(?:https?:\/\/|blob:|data:video\/)/i.test(candidate)) return candidate;
  if (/^\/(?:api\/|media\/|covers\/|generated\/)/i.test(candidate)) return candidate;
  return '';
}

export function publishSourceRequestFields(item: PublishQueueItem) {
  return {
    sourceKind: item.sourceProjectId ? 'project' as const : 'manual_upload' as const,
    projectId: item.sourceProjectId,
    sourceVideoPath: item.sourceVideoPath || item.videoPath,
    generationKind: item.generationKind,
    generationProvenance: item.generationProvenance,
    qualityStatus: item.qualityStatus,
    publishable: item.publishable,
    generationRecordId: item.generationRecordId,
  };
}

export function createPublishItem(
  draft?: PublishDraftItem | null,
  targetAccountIds: string[] = [],
  workflowContext?: PublishWorkflowContext | null,
): PublishQueueItem {
  const sourcePlatform = draft?.platform;
  const videoPath = storedString(draft?.videoPath);
  const title = storedString(draft?.title);
  const description = storedString(draft?.description);
  const initialCopy: Record<string, PlatformCopy> = sourcePlatform
    ? {
      [sourcePlatform]: sourcePlatform === 'youtube'
        ? { title, description }
        : sourcePlatform === 'facebook'
          ? { text: description }
          : { caption: description },
    }
    : {};
  return {
    id: publishItemId(),
    selected: Boolean(videoPath.trim()),
    videoPath,
    sourceVideoPath: storedString(draft?.sourceVideoPath) || videoPath,
    previewUrl: storedOptionalString(draft?.previewUrl) || browserVideoUrl(videoPath),
    title,
    description,
    ratio: draft?.ratio,
    sourceProjectId: draft?.sourceProjectId,
    generationKind: draft?.generationKind,
    generationProvenance: draft?.generationProvenance,
    qualityStatus: draft?.qualityStatus,
    publishable: draft?.publishable,
    generationRecordId: draft?.generationRecordId,
    sourcePlatform,
    workflowRunId: draft?.workflowRunId || workflowContext?.runId,
    workflowTaskId: draft?.workflowTaskId || workflowContext?.taskId,
    workflowTaskKey: draft?.workflowTaskKey || workflowContext?.taskKey,
    targetAccountIds,
    platformCopy: initialCopy,
    firstComment: '',
    trackWaLink: true,
    deliveryMode: 'now',
    scheduledAt: '',
    status: 'draft',
    completedTargets: 0,
    deliveryResults: {},
  };
}

function expandPublishDraft(draft?: PublishDraft | null): PublishDraftItem[] {
  if (!draft) return [];
  const { items, ...base } = draft;
  if (!Array.isArray(items) || !items.length) return [base];
  return items.map(item => ({ ...base, ...item }));
}

export function createPublishItems(
  draft?: PublishDraft | null,
  targetAccountIds: string[] = [],
  workflowContext?: PublishWorkflowContext | null,
): PublishQueueItem[] {
  const drafts = expandPublishDraft(draft).filter(item => Boolean(item.videoPath?.trim()));
  return drafts.length
    ? drafts.map(item => createPublishItem(item, targetAccountIds, workflowContext))
    : draft ? [] : [createPublishItem(null, targetAccountIds, workflowContext)];
}

export function mergePublishItems(previous: PublishQueueItem[], additions: PublishQueueItem[]): PublishQueueItem[] {
  if (!additions.length) return previous;
  const onlyBlank = previous.length === 1 && !previous[0].videoPath.trim() && !previous[0].title.trim();
  const replacementProjectIds = new Set(additions.map(item => item.sourceProjectId).filter(Boolean));
  const base = onlyBlank
    ? []
    : previous.filter(item => item.status === 'provider_processing' || !item.sourceProjectId || !replacementProjectIds.has(item.sourceProjectId));
  const existingKeys = new Set(base.map(item => item.videoPath.trim() || item.title.trim()).filter(Boolean));
  const unique = additions.filter(item => {
    const key = item.videoPath.trim() || item.title.trim();
    if (!key || existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
  return unique.length ? [...base, ...unique] : previous;
}

export function dateTimeLocalValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function nextScheduleValue(): string {
  const next = new Date(Date.now() + 60 * 60_000);
  next.setMinutes(next.getMinutes() < 30 ? 30 : 0, 0, 0);
  if (next.getMinutes() === 0) next.setHours(next.getHours() + 1);
  return dateTimeLocalValue(next);
}

export function publishStorageKey(base: string, storageScope?: string): string {
  const scope = String(storageScope || '').trim();
  return scope ? `${base}:${encodeURIComponent(scope)}` : base;
}

export function readStoredPublishDraft(storageScope?: string): PublishDraft | null {
  try {
    return normalizeStoredPublishDraft(JSON.parse(localStorage.getItem(publishStorageKey('ow_publish_draft', storageScope)) || 'null'));
  } catch {
    return null;
  }
}

export const PUBLISH_QUEUE_STORAGE_KEY = 'ow_publish_queue';

export function readStoredPublishQueue(storageScope?: string): PublishQueueItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(publishStorageKey(PUBLISH_QUEUE_STORAGE_KEY, storageScope)) || '[]');
    return Array.isArray(parsed)
      ? parsed.map(normalizeStoredPublishQueueItem).filter((item): item is PublishQueueItem => Boolean(item))
      : [];
  } catch {
    return [];
  }
}

export const PUBLISH_STATUS_META: Record<PublishItemStatus, { label: string; className: string }> = {
  draft: { label: '待配置', className: 'bg-slate-100 text-slate-600' },
  ready: { label: '待发布', className: 'bg-emerald-50 text-emerald-700' },
  publishing: { label: '发布中', className: 'bg-sky-50 text-sky-700' },
  provider_processing: { label: '平台处理中', className: 'bg-sky-50 text-sky-700' },
  scheduled: { label: '已排期', className: 'bg-violet-50 text-violet-700' },
  published: { label: '已完成', className: 'bg-emerald-50 text-emerald-700' },
  partial: { label: '部分失败', className: 'bg-amber-50 text-amber-700' },
  failed: { label: '发布失败', className: 'bg-red-50 text-red-700' },
};
