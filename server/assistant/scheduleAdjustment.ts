import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';

export const ASSISTANT_SCHEDULE_CHANGES = 'assistant_schedule_changes';

const CLAIM_ERROR_PREFIX = 'confirmation_claim_for:';

const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
};
const BLOCKED_STATUSES = new Set([
  'publishing', 'provider_processing', 'published', 'partial', 'finalize_pending', 'needs_attention',
]);

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.map(item => text(String(item))).filter(Boolean)
  : [];

type PostRecord = Record_ & {
  tenant_id?: unknown;
  content_id?: unknown;
  platform?: unknown;
  platform_post_id?: unknown;
  title?: unknown;
  published_at?: unknown;
  stats?: unknown;
  updated?: unknown;
  updated_at?: unknown;
};

export type ScheduleChangeItem = {
  id: string;
  title: string;
  thumbnailUrl: string;
  accountLabel: string;
  platform: string;
  sourceScheduledAt: string;
  targetScheduledAt: string;
  expectedVersion: string;
  executionStatus?: 'pending' | 'applying' | 'applied' | 'rolled_back' | 'rollback_failed';
  appliedAt?: string;
  rolledBackAt?: string;
  executionError?: string;
};

type ScheduleChangeRecord = Record_ & {
  tenant_id?: unknown;
  created_by?: unknown;
  idempotency_key?: unknown;
  status?: unknown;
  platform?: unknown;
  source_weekday?: unknown;
  target_weekday?: unknown;
  item_count?: unknown;
  items?: unknown;
  version?: unknown;
  confirmation_version?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  error_code?: unknown;
};

export type PreparedScheduleChange = {
  id: string;
  expectedVersion: string;
  sourceLabel: string;
  targetLabel: string;
  platformLabel: string;
  items: ScheduleChangeItem[];
};

export class ScheduleAdjustmentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(code);
    this.name = 'ScheduleAdjustmentError';
  }
}

function parseStats(post: PostRecord): Record<string, unknown> {
  if (typeof post.stats === 'string') {
    try { return object(JSON.parse(post.stats)); }
    catch { return {}; }
  }
  return object(post.stats);
}

function hasPublishedReceipt(post: PostRecord, stats: Record<string, unknown>): boolean {
  if (text(post.platform_post_id)) return true;
  const results = object(stats.publishResults);
  return Object.values(results).some(value => text(object(value).status) === 'published');
}

function postVersion(post: PostRecord): string {
  const stats = parseStats(post);
  return createHash('sha256').update(JSON.stringify({
    id: post.id,
    publishedAt: text(post.published_at),
    platform: text(post.platform).toLowerCase(),
    platformPostId: text(post.platform_post_id),
    status: text(stats.status),
    scheduleLocked: stats.scheduleLocked === true,
    publishResults: stats.publishResults ?? {},
    updated: text(post.updated_at) || text(post.updated),
  })).digest('hex');
}

function hasAtomicScheduleFields(post: PostRecord): boolean {
  return Object.prototype.hasOwnProperty.call(post, 'stats')
    && Object.prototype.hasOwnProperty.call(post, 'platform_post_id');
}

function postScheduleGuard(
  post: PostRecord,
  publishedAt = text(post.published_at),
  stats: unknown = post.stats,
): Record<string, unknown> {
  // The whole stats document is compared exactly by DataStore CAS. That makes
  // scheduleLocked, status and publishResults part of the same atomic guard as
  // the original time/platform receipt instead of re-checking them before an
  // unconditional write.
  return {
    tenant_id: post.tenant_id,
    platform: post.platform,
    published_at: publishedAt,
    platform_post_id: post.platform_post_id,
    stats,
  };
}

function changeVersion(input: {
  tenantId: string;
  createdBy: string;
  platform: string;
  sourceWeekday: number;
  targetWeekday: number;
  items: ScheduleChangeItem[];
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function beijingParts(value: string): {
  date: string;
  weekday: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(parsed).map(part => [part.type, part.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(fields.weekday);
  if (weekday < 0) return null;
  return {
    date: `${fields.year}-${fields.month}-${fields.day}`,
    weekday,
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
    hour: Number(fields.hour),
    minute: Number(fields.minute),
    second: Number(fields.second),
  };
}

function moveToWeekday(value: string, sourceWeekday: number, targetWeekday: number): string {
  const parts = beijingParts(value);
  if (!parts || parts.weekday !== sourceWeekday) {
    throw new ScheduleAdjustmentError('assistant_schedule_source_changed', 409, '原排期已变更，请重新核对后再调整。');
  }
  const dayDelta = (targetWeekday - sourceWeekday + 7) % 7;
  const utc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + dayDelta,
    parts.hour - 8,
    parts.minute,
    parts.second,
  );
  return new Date(utc).toISOString();
}

function normalizedItems(value: unknown): ScheduleChangeItem[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => object(item)).map(item => ({
    id: text(item.id),
    title: text(item.title),
    thumbnailUrl: text(item.thumbnailUrl),
    accountLabel: text(item.accountLabel),
    platform: text(item.platform),
    sourceScheduledAt: text(item.sourceScheduledAt),
    targetScheduledAt: text(item.targetScheduledAt),
    expectedVersion: text(item.expectedVersion),
    executionStatus: ['pending', 'applying', 'applied', 'rolled_back', 'rollback_failed'].includes(text(item.executionStatus))
      ? text(item.executionStatus) as ScheduleChangeItem['executionStatus']
      : undefined,
    appliedAt: text(item.appliedAt) || undefined,
    rolledBackAt: text(item.rolledBackAt) || undefined,
    executionError: text(item.executionError) || undefined,
  })).filter(item => item.id && item.expectedVersion && item.sourceScheduledAt && item.targetScheduledAt);
}

function confirmationClaimId(changeId: string, confirmationVersion: string): string {
  // PocketBase permits caller-supplied 15-character lowercase alphanumeric ids.
  // A deterministic primary key turns create into a durable, cross-process
  // compare-and-set: exactly one confirmer can create this record.
  return createHash('sha256')
    .update(`assistant-schedule-confirmation:${changeId}:${confirmationVersion}`)
    .digest('hex')
    .slice(0, 15);
}

function applyingVersion(changeId: string, confirmationVersion: string): string {
  return createHash('sha256')
    .update(`${changeId}:applying:${confirmationVersion}`)
    .digest('hex');
}

function executionItems(items: ScheduleChangeItem[]): ScheduleChangeItem[] {
  return items.map(item => ({
    ...item,
    executionStatus: 'pending',
    appliedAt: undefined,
    rolledBackAt: undefined,
    executionError: undefined,
  }));
}

function changeFromRecord(record: ScheduleChangeRecord): PreparedScheduleChange {
  const sourceWeekday = Number(record.source_weekday);
  const targetWeekday = Number(record.target_weekday);
  return {
    id: record.id,
    expectedVersion: text(record.confirmation_version) || text(record.version),
    sourceLabel: DAY_LABELS[sourceWeekday] ?? '原日期',
    targetLabel: DAY_LABELS[targetWeekday] ?? '新日期',
    platformLabel: PLATFORM_LABELS[text(record.platform).toLowerCase()] ?? text(record.platform),
    items: normalizedItems(record.items),
  };
}

function assertWeekday(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new ScheduleAdjustmentError('assistant_schedule_weekday_invalid', 400, '排期日期无效。');
  }
}

export type ScheduleAdjustmentService = ReturnType<typeof createScheduleAdjustmentService>;

export function createScheduleAdjustmentService(dataStore: DataStore, now: () => Date = () => new Date()) {
  return {
    async prepare(input: {
      tenantId: string;
      userId: string;
      requestId: string;
      platform: string;
      sourceWeekday: number;
      targetWeekday: number;
      count: number;
    }): Promise<PreparedScheduleChange> {
      assertWeekday(input.sourceWeekday);
      assertWeekday(input.targetWeekday);
      if (input.sourceWeekday === input.targetWeekday) {
        throw new ScheduleAdjustmentError('assistant_schedule_day_unchanged', 400, '新日期与原日期相同，请重新选择。');
      }
      if (!Number.isInteger(input.count) || input.count < 1 || input.count > 20) {
        throw new ScheduleAdjustmentError('assistant_schedule_count_invalid', 400, '要调整的视频数量无效。');
      }
      const platform = text(input.platform).toLowerCase();
      if (!['tiktok', 'youtube', 'instagram', 'facebook'].includes(platform)) {
        throw new ScheduleAdjustmentError('assistant_schedule_platform_invalid', 400, '暂不支持这个平台的排期调整。');
      }

      const duplicate = await dataStore.list<ScheduleChangeRecord>(ASSISTANT_SCHEDULE_CHANGES, {
        where: { tenant_id: input.tenantId, idempotency_key: input.requestId }, perPage: 2,
      });
      if (duplicate.totalItems > 1) {
        throw new ScheduleAdjustmentError('assistant_schedule_change_integrity_error', 503, '排期服务数据异常，本次未做修改。');
      }
      if (duplicate.items[0]) return changeFromRecord(duplicate.items[0]);

      const result = await dataStore.list<PostRecord>('posts', {
        where: { tenant_id: input.tenantId }, sort: 'published_at', page: 1, perPage: 500,
      });
      const currentTime = now().getTime();
      const candidates = result.items.filter(post => {
        const stats = parseStats(post);
        const scheduledAt = text(post.published_at);
        const scheduledTime = Date.parse(scheduledAt);
        return text(post.platform).toLowerCase() === platform
          && hasAtomicScheduleFields(post)
          && Number.isFinite(scheduledTime)
          && scheduledTime > currentTime
          && beijingParts(scheduledAt)?.weekday === input.sourceWeekday
          && !hasPublishedReceipt(post, stats)
          && !BLOCKED_STATUSES.has(text(stats.status))
          && stats.scheduleLocked !== true;
      });
      const dates = new Map<string, PostRecord[]>();
      for (const post of candidates) {
        const date = beijingParts(text(post.published_at))?.date;
        if (!date) continue;
        dates.set(date, [...(dates.get(date) ?? []), post]);
      }
      const firstDate = [...dates.keys()].sort()[0];
      const selected = firstDate ? dates.get(firstDate) ?? [] : [];
      if (selected.length !== input.count) {
        const message = selected.length < input.count
          ? `在最近的${DAY_LABELS[input.sourceWeekday]}只找到 ${selected.length} 条可调整的 ${platform === 'tiktok' ? 'TikTok' : platform} 待发布视频，本次未修改排期。`
          : `在最近的${DAY_LABELS[input.sourceWeekday]}找到 ${selected.length} 条 ${platform === 'tiktok' ? 'TikTok' : platform} 待发布视频，无法唯一确定要调整的 ${input.count} 条。请先在日历中选择具体视频。`;
        throw new ScheduleAdjustmentError('assistant_schedule_candidates_not_exact', 422, message);
      }

      const items = selected.map(post => {
        const stats = parseStats(post);
        const labels = stringArray(stats.targetAccountLabels);
        const sourceScheduledAt = text(post.published_at);
        return {
          id: post.id,
          title: text(post.title) || '未命名视频',
          thumbnailUrl: text(stats.coverUrl) || text(stats.videoPreviewUrl) || text(stats.videoUrl) || text(stats.mediaUrl),
          accountLabel: labels.join('、'),
          platform: PLATFORM_LABELS[platform] ?? platform,
          sourceScheduledAt,
          targetScheduledAt: moveToWeekday(sourceScheduledAt, input.sourceWeekday, input.targetWeekday),
          expectedVersion: postVersion(post),
        } satisfies ScheduleChangeItem;
      });
      const version = changeVersion({
        tenantId: input.tenantId,
        createdBy: input.userId,
        platform,
        sourceWeekday: input.sourceWeekday,
        targetWeekday: input.targetWeekday,
        items,
      });
      const timestamp = now().toISOString();
      const created = await dataStore.create<ScheduleChangeRecord>(ASSISTANT_SCHEDULE_CHANGES, {
        tenant_id: input.tenantId,
        created_by: input.userId,
        idempotency_key: input.requestId,
        status: 'pending',
        platform,
        source_weekday: input.sourceWeekday,
        target_weekday: input.targetWeekday,
        item_count: items.length,
        items,
        version,
        confirmation_version: version,
        created_at: timestamp,
        updated_at: timestamp,
        error_code: '',
      });
      if (!created) {
        throw new ScheduleAdjustmentError('assistant_schedule_change_storage_unavailable', 503, '排期确认项暂时无法保存，本次未修改排期。');
      }
      return changeFromRecord(created);
    },

    async confirm(input: {
      tenantId: string;
      userId: string;
      changeId: string;
      expectedVersion: string;
    }): Promise<PreparedScheduleChange> {
      let record = await dataStore.getById<ScheduleChangeRecord>(ASSISTANT_SCHEDULE_CHANGES, input.changeId);
      if (!record || text(record.tenant_id) !== input.tenantId || text(record.created_by) !== input.userId) {
        throw new ScheduleAdjustmentError('assistant_schedule_change_not_found', 404, '这条排期确认项已不存在，请重新发起调整。');
      }
      const confirmationVersion = text(record.confirmation_version) || text(record.version);
      if (text(record.status) === 'applied'
        && (input.expectedVersion === confirmationVersion || input.expectedVersion === text(record.version))) {
        return changeFromRecord(record);
      }
      if (text(record.status) !== 'pending' || input.expectedVersion !== text(record.version)) {
        if (text(record.status) === 'applying') {
          throw new ScheduleAdjustmentError(
            'assistant_schedule_change_in_progress',
            409,
            '这次排期调整正在执行，请勿重复确认。',
          );
        }
        throw new ScheduleAdjustmentError('assistant_schedule_change_stale', 409, '这张确认卡已失效，请重新核对最新排期。');
      }
      const items = normalizedItems(record.items);
      if (!items.length || items.length !== Number(record.item_count)) {
        throw new ScheduleAdjustmentError('assistant_schedule_change_integrity_error', 503, '排期确认项数据不完整，本次未做修改。');
      }

      const claimId = confirmationClaimId(record.id, confirmationVersion);
      const claimTimestamp = now().toISOString();
      let claimCreated = false;
      try {
        const claim = await dataStore.create<ScheduleChangeRecord>(ASSISTANT_SCHEDULE_CHANGES, {
          id: claimId,
          tenant_id: input.tenantId,
          created_by: input.userId,
          idempotency_key: `confirm:${record.id}:${confirmationVersion}`,
          status: 'claim',
          platform: text(record.platform),
          source_weekday: Number(record.source_weekday),
          target_weekday: Number(record.target_weekday),
          item_count: items.length,
          items,
          version: applyingVersion(record.id, confirmationVersion),
          confirmation_version: confirmationVersion,
          created_at: claimTimestamp,
          updated_at: claimTimestamp,
          error_code: `${CLAIM_ERROR_PREFIX}${record.id}`,
        });
        claimCreated = Boolean(claim);
      } catch {
        // A unique-id conflict is the expected loser path. We distinguish it
        // from a storage outage by reading back and validating the claim.
      }
      if (!claimCreated) {
        const existingClaim = await dataStore.getById<ScheduleChangeRecord>(ASSISTANT_SCHEDULE_CHANGES, claimId)
          .catch(() => null);
        if (!existingClaim
          || text(existingClaim.tenant_id) !== input.tenantId
          || text(existingClaim.created_by) !== input.userId
          || text(existingClaim.error_code) !== `${CLAIM_ERROR_PREFIX}${record.id}`
          || text(existingClaim.confirmation_version) !== confirmationVersion) {
          throw new ScheduleAdjustmentError(
            'assistant_schedule_claim_storage_unavailable',
            503,
            '排期确认暂时无法安全锁定，本次未修改任何视频。',
          );
        }
        const latest = await dataStore.getById<ScheduleChangeRecord>(ASSISTANT_SCHEDULE_CHANGES, record.id);
        if (latest && text(latest.status) === 'applied'
          && (input.expectedVersion === text(latest.confirmation_version)
            || input.expectedVersion === text(latest.version))) {
          return changeFromRecord(latest);
        }
        throw new ScheduleAdjustmentError(
          'assistant_schedule_change_in_progress',
          409,
          '这次排期调整正在执行，请勿重复确认。',
        );
      }

      const activeVersion = applyingVersion(record.id, confirmationVersion);
      let trackedItems = executionItems(items);
      const claimedRecord = await dataStore.getById<ScheduleChangeRecord>(ASSISTANT_SCHEDULE_CHANGES, record.id);
      if (!claimedRecord
        || text(claimedRecord.status) !== 'pending'
        || text(claimedRecord.version) !== confirmationVersion
        || text(claimedRecord.tenant_id) !== input.tenantId
        || text(claimedRecord.created_by) !== input.userId) {
        await dataStore.delete(ASSISTANT_SCHEDULE_CHANGES, claimId).catch(() => false);
        throw new ScheduleAdjustmentError(
          'assistant_schedule_change_stale',
          409,
          '这张确认卡已失效，请重新核对最新排期。',
        );
      }
      const applyingPatch = {
        status: 'applying',
        version: activeVersion,
        items: trackedItems,
        updated_at: claimTimestamp,
        error_code: '',
      };
      const transitioned = await (dataStore.compareAndSwap
        ? dataStore.compareAndSwap(
          ASSISTANT_SCHEDULE_CHANGES,
          record.id,
          { status: 'pending', version: confirmationVersion },
          applyingPatch,
        )
        // The durable unique claim is still the cross-process authority for
        // stores without native CAS. This read/update fallback is never used
        // as the sole lock.
        : dataStore.update(ASSISTANT_SCHEDULE_CHANGES, record.id, applyingPatch)
      ).catch(() => false);
      if (!transitioned) {
        await dataStore.delete(ASSISTANT_SCHEDULE_CHANGES, claimId).catch(() => false);
        throw new ScheduleAdjustmentError(
          'assistant_schedule_claim_storage_unavailable',
          503,
          '排期确认暂时无法进入执行状态，本次未修改任何视频。',
        );
      }
      record = {
        ...record,
        status: 'applying',
        version: activeVersion,
        items: trackedItems,
        updated_at: claimTimestamp,
      };

      const snapshots: Array<{ post: PostRecord; stats: Record<string, unknown> }> = [];
      for (const item of items) {
        const post = await dataStore.getById<PostRecord>('posts', item.id);
        const stats = post ? parseStats(post) : {};
        if (!post || text(post.tenant_id) !== input.tenantId
          || !hasAtomicScheduleFields(post)
          || postVersion(post) !== item.expectedVersion
          || text(post.published_at) !== item.sourceScheduledAt
          || hasPublishedReceipt(post, stats)
          || BLOCKED_STATUSES.has(text(stats.status))
          || stats.scheduleLocked === true) {
          const staleSaved = await dataStore.update(ASSISTANT_SCHEDULE_CHANGES, record.id, {
            status: 'stale', error_code: 'post_changed_or_published', updated_at: now().toISOString(),
            version: createHash('sha256').update(`${record.id}:stale:${now().toISOString()}`).digest('hex'),
          }).catch(() => false);
          await dataStore.update(ASSISTANT_SCHEDULE_CHANGES, claimId, {
            status: 'stale', error_code: `${CLAIM_ERROR_PREFIX}${record.id}`, updated_at: now().toISOString(),
          }).catch(() => false);
          if (!staleSaved) {
            throw new ScheduleAdjustmentError(
              'assistant_schedule_receipt_failed',
              502,
              '排期未修改，但状态回执保存失败，请打开日历核对后重新发起。',
            );
          }
          throw new ScheduleAdjustmentError('assistant_schedule_change_stale', 409, '视频状态或排期已变更，本次未使用旧卡片继续执行。');
        }
        snapshots.push({ post, stats });
      }

      const updated: Array<{
        index: number;
        post: PostRecord;
        stats: Record<string, unknown>;
        appliedStats: Record<string, unknown>;
      }> = [];
      let activeIndex = -1;
      let failureKind: 'post_update_failed' | 'post_changed_or_published' = 'post_update_failed';
      try {
        for (let index = 0; index < items.length; index += 1) {
          activeIndex = index;
          const item = items[index]!;
          const snapshot = snapshots[index]!;
          trackedItems = trackedItems.map((candidate, candidateIndex) => candidateIndex === index ? {
            ...candidate,
            executionStatus: 'applying',
            executionError: undefined,
          } : candidate);
          const applyingSaved = await dataStore.update(ASSISTANT_SCHEDULE_CHANGES, record.id, {
            status: 'applying', items: trackedItems, version: activeVersion, updated_at: now().toISOString(),
          });
          if (!applyingSaved) throw new Error('progress_receipt_failed');
          const stats = {
            ...snapshot.stats,
            status: text(snapshot.stats.status) || 'scheduled',
            publishAttempts: 0,
            publishResults: {},
            publishError: '',
            nextPublishAttemptAt: '',
            warnings: [],
          };
          if (!dataStore.compareAndSwap) throw new Error('post_guard_unavailable');
          let ok = false;
          try {
            ok = await dataStore.compareAndSwap(
              'posts',
              item.id,
              postScheduleGuard(snapshot.post),
              { published_at: item.targetScheduledAt, stats },
            );
          } catch {
            throw new Error('post_update_failed');
          }
          if (!ok) {
            failureKind = 'post_changed_or_published';
            throw new Error('post_changed_or_published');
          }
          updated.push({ index, ...snapshot, appliedStats: stats });
          const appliedAt = now().toISOString();
          trackedItems = trackedItems.map((candidate, candidateIndex) => candidateIndex === index ? {
            ...candidate,
            executionStatus: 'applied',
            appliedAt,
            rolledBackAt: undefined,
            executionError: undefined,
          } : candidate);
          const progressSaved = await dataStore.update(ASSISTANT_SCHEDULE_CHANGES, record.id, {
            status: 'applying', items: trackedItems, version: activeVersion, updated_at: appliedAt,
          });
          if (!progressSaved) throw new Error('progress_receipt_failed');
        }
      } catch {
        let rollbackComplete = true;
        const actuallyUpdated = new Set(updated.map(item => item.index));
        for (const updatedItem of updated.reverse()) {
          const restoredAt = now().toISOString();
          const restored = dataStore.compareAndSwap
            ? await dataStore.compareAndSwap(
              'posts',
              updatedItem.post.id,
              postScheduleGuard(
                updatedItem.post,
                items[updatedItem.index]!.targetScheduledAt,
                updatedItem.appliedStats,
              ),
              {
                published_at: text(updatedItem.post.published_at),
                stats: updatedItem.post.stats,
              },
            ).catch(() => false)
            : false;
          rollbackComplete = rollbackComplete && restored;
          trackedItems = trackedItems.map((candidate, candidateIndex) => candidateIndex === updatedItem.index ? {
            ...candidate,
            executionStatus: restored ? 'rolled_back' : 'rollback_failed',
            rolledBackAt: restored ? restoredAt : undefined,
            executionError: restored ? undefined : 'post_rollback_failed',
          } : candidate);
        }
        if (activeIndex >= 0 && !actuallyUpdated.has(activeIndex)) {
          trackedItems = trackedItems.map((candidate, candidateIndex) => candidateIndex === activeIndex ? {
            ...candidate,
            executionStatus: 'pending',
            executionError: failureKind,
          } : candidate);
        }
        const staleConflict = failureKind === 'post_changed_or_published';
        const receiptStatus = rollbackComplete
          ? (staleConflict ? 'stale' : 'pending')
          : 'needs_attention';
        const receiptVersion = rollbackComplete
          ? (staleConflict
            ? createHash('sha256').update(`${record.id}:stale:${now().toISOString()}`).digest('hex')
            : confirmationVersion)
          : activeVersion;
        const rollbackReceiptSaved = await dataStore.update(ASSISTANT_SCHEDULE_CHANGES, record.id, {
          status: receiptStatus,
          error_code: rollbackComplete
            ? (staleConflict ? 'post_changed_or_published' : 'schedule_update_failed')
            : 'schedule_update_partial',
          version: receiptVersion,
          items: trackedItems,
          updated_at: now().toISOString(),
        }).catch(() => false);
        const claimSettled = rollbackComplete && rollbackReceiptSaved
          ? (staleConflict
            ? await dataStore.update(ASSISTANT_SCHEDULE_CHANGES, claimId, {
              status: 'stale',
              version: receiptVersion,
              updated_at: now().toISOString(),
            }).catch(() => false)
            : await dataStore.delete(ASSISTANT_SCHEDULE_CHANGES, claimId).catch(() => false))
          : false;
        if (!claimSettled) {
          if (rollbackComplete && rollbackReceiptSaved) {
            await dataStore.update(ASSISTANT_SCHEDULE_CHANGES, record.id, {
              status: 'needs_attention',
              version: activeVersion,
              error_code: 'confirmation_claim_release_failed',
              items: trackedItems,
              updated_at: now().toISOString(),
            }).catch(() => false);
          }
          await dataStore.update(ASSISTANT_SCHEDULE_CHANGES, claimId, {
            status: 'needs_attention',
            updated_at: now().toISOString(),
          }).catch(() => false);
        }
        if (staleConflict && rollbackComplete && rollbackReceiptSaved && claimSettled) {
          throw new ScheduleAdjustmentError(
            'assistant_schedule_change_stale',
            409,
            '视频已发布或状态已变更，本次未覆盖最新结果。请重新核对排期。',
          );
        }
        throw new ScheduleAdjustmentError(
          rollbackComplete && rollbackReceiptSaved && claimSettled
            ? 'assistant_schedule_update_failed'
            : 'assistant_schedule_update_partial',
          502,
          rollbackComplete && rollbackReceiptSaved && claimSettled
            ? '排期更新失败，已撤销本次修改，可稍后重试。'
            : rollbackComplete
              ? '排期修改已撤销，但回执保存失败，请立即打开日历核对，系统不会自动重试。'
              : '部分排期更新后回滚未完成，请立即打开日历核对，系统不会自动重试。',
        );
      }

      const appliedAt = now().toISOString();
      const appliedVersion = createHash('sha256').update(`${record.id}:applied:${appliedAt}`).digest('hex');
      const saved = await dataStore.update(ASSISTANT_SCHEDULE_CHANGES, record.id, {
        status: 'applied', version: appliedVersion, items: trackedItems, updated_at: appliedAt, error_code: '',
      });
      if (!saved) {
        await dataStore.update(ASSISTANT_SCHEDULE_CHANGES, claimId, {
          status: 'needs_attention', updated_at: now().toISOString(),
        }).catch(() => false);
        throw new ScheduleAdjustmentError('assistant_schedule_receipt_failed', 502, '视频排期已更新，但回执保存失败，请打开日历核对。');
      }
      await dataStore.update(ASSISTANT_SCHEDULE_CHANGES, claimId, {
        status: 'applied', version: appliedVersion, updated_at: appliedAt,
      }).catch(() => false);
      return {
        ...changeFromRecord({
          ...record,
          status: 'applied',
          version: appliedVersion,
          items: trackedItems,
          updated_at: appliedAt,
        }),
        expectedVersion: appliedVersion,
      };
    },

    async pendingForUser(input: { tenantId: string; userId: string }): Promise<PreparedScheduleChange | null> {
      const result = await dataStore.list<ScheduleChangeRecord>(ASSISTANT_SCHEDULE_CHANGES, {
        where: { tenant_id: input.tenantId, created_by: input.userId, status: 'pending' },
        sort: '-updated_at', page: 1, perPage: 2,
      });
      return result.items[0] ? changeFromRecord(result.items[0]) : null;
    },
  };
}
