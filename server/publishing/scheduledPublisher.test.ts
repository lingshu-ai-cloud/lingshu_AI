import assert from 'node:assert/strict';
import {
  classifyPlatformPublishFailure,
  directPublishAdmission,
  directPublishFailureStatePatch,
} from './platformPublisher.js';
import {
  type PublishResult,
  collectDueScheduledPosts,
  evaluateDigitalEmployeePublishGovernance,
  isExpiredDirectPublishAttempt,
  isScheduledPostDue,
  interruptedPublishResults,
  normalizeReconciliationDecision,
  reconcileExpiredDirectPublishAttempts,
  reconciliationPatchForDecision,
  scheduledTikTokPublishOptionsForAccount,
  scheduledRetryDelay,
  targetAccountsRequiringPublish,
  uncertainPublishReconciliationPatch,
  withScheduledPublisherCycleHeartbeat,
} from './scheduledPublisher.js';
import type { PostRecord } from './waLink.js';
import type { AtomicCompareResult, ListQuery, ListResult, Record_, Where } from '../storage/datastore.js';
import { MemoryAtomicStore } from '../testing/memoryAtomicStore.js';
import {
  persistProviderOperationEvidence,
  providerOperationAuditReference,
  providerOperationEvidenceForAccount,
  providerOperationEvidencePatch,
} from './providerOperationEvidence.js';
import { reconciliationOperationBlock } from './publishOperationFence.js';
import { publicPublishedVideo, publicPublishTracking } from './publicPublication.js';

const now = Date.parse('2026-07-29T10:00:00.000Z');

function post(status: string, overrides: Partial<PostRecord> = {}, stats: Record<string, unknown> = {}): PostRecord {
  return {
    id: 'post-1',
    tenant_id: 'tenant-1',
    platform: 'youtube',
    published_at: '2026-07-29T09:00:00.000Z',
    track_code: 'V1000',
    stats: { status, publishAttempts: 0, source: 'manual', schedulePayloadHash: 'b'.repeat(64), ...stats },
    ...overrides,
  };
}

class QueueAwareMemoryStore extends MemoryAtomicStore {
  readonly listQueries: Array<{ collection: string; query: ListQuery }> = [];

  override async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    this.listQueries.push({ collection, query: structuredClone(query) });
    let records = this.all<Record_>(collection).filter(record => (
      Object.entries(query.where ?? {}).every(([key, value]) => String(record[key] ?? '') === String(value))
      && Object.entries(query.lte ?? {}).every(([key, value]) => {
        const actual = record[key];
        if (actual === undefined || actual === null || actual === '') return false;
        return typeof value === 'number'
          ? Number.isFinite(Number(actual)) && Number(actual) <= value
          : String(actual) <= value;
      })
    ));
    const sortFields = String(query.sort || '').split(',').map(value => value.trim()).filter(Boolean);
    records = records.sort((left, right) => {
      for (const field of sortFields) {
        const descending = field.startsWith('-');
        const key = descending ? field.slice(1) : field;
        const comparison = String(left[key] ?? '').localeCompare(String(right[key] ?? ''));
        if (comparison) return descending ? -comparison : comparison;
      }
      return 0;
    });
    const page = query.page || 1;
    const perPage = query.perPage || 20;
    const start = (page - 1) * perPage;
    return {
      items: records.slice(start, start + perPage) as T[],
      totalItems: query.skipTotal ? -1 : records.length,
      totalPages: query.skipTotal ? -1 : Math.ceil(records.length / perPage),
      page,
      perPage,
    };
  }
}

class ProviderEvidenceTimeoutRaceStore extends MemoryAtomicStore {
  private racePhase = 0;

  override async compareAndSet<T = Record_>(
    collection: string,
    id: string,
    expected: Where,
    data: Record<string, unknown>,
  ): Promise<AtomicCompareResult<T>> {
    if (this.racePhase === 0 && collection === 'posts'
      && expected.publish_operation_state === 'active'
      && JSON.stringify(data).includes('providerOperationHandles')) {
      this.racePhase = 1;
      const transitioned = await super.compareAndSet<PostRecord>(collection, id, {
        publish_operation_id: 'evidence-race-operation',
        publish_operation_state: 'active',
      }, {
        publish_operation_state: 'quiescing',
      });
      assert.equal(transitioned.ok, true, 'the test must inject the timeout state transition before the evidence CAS');
      const current = await this.getById<T>(collection, id);
      return { ok: false, reason: 'conflict', ...(current ? { current } : {}) };
    }
    if (this.racePhase === 1 && collection === 'posts'
      && expected.publish_operation_state === 'quiescing'
      && JSON.stringify(data).includes('providerOperationHandles')) {
      this.racePhase = 2;
      const current = await this.getById<PostRecord>(collection, id);
      assert.ok(current);
      const currentStats = current.stats as Record<string, unknown>;
      const reconciled = await super.compareAndSet<PostRecord>(collection, id, {
        publish_revision: Number(current.publish_revision || 0),
        publish_operation_id: 'evidence-race-operation',
        publish_operation_state: 'quiescing',
        publish_lease_owner: 'race-worker',
      }, {
        stats: { ...currentStats, status: 'needs_reconciliation', reconciliationStartedAt: '2026-07-29T10:00:02.000Z' },
        publish_revision: Number(current.publish_revision || 0) + 1,
        publish_lease_owner: '',
        publish_lease_expires_at: '',
        reconciliation_required: true,
      });
      assert.equal(reconciled.ok, true, 'the test must inject timeout failure persistence before the evidence retry');
      const afterReconciliation = await this.getById<T>(collection, id);
      return { ok: false, reason: 'conflict', ...(afterReconciliation ? { current: afterReconciliation } : {}) };
    }
    return super.compareAndSet<T>(collection, id, expected, data);
  }
}

assert.equal(isScheduledPostDue(post('scheduled'), now), true, 'an overdue scheduled post should run');
assert.equal(
  isScheduledPostDue(post('scheduled', { published_at: '2026-07-29T11:00:00.000Z' }), now),
  false,
  'a future scheduled post must wait',
);
assert.equal(isScheduledPostDue(post(''), now), false, 'legacy posts without an explicit scheduled status must not run');
assert.equal(
  isScheduledPostDue(post('failed', {}, { nextPublishAttemptAt: '2026-07-29T10:01:00.000Z' }), now),
  false,
  'a failed post must wait until its retry time',
);
assert.equal(
  isScheduledPostDue(post('failed', {}, { nextPublishAttemptAt: '2026-07-29T09:59:00.000Z' }), now),
  true,
  'a failed post should retry after the retry time',
);
assert.equal(
  isScheduledPostDue(post('failed'), now),
  false,
  'a failed post without a durable retry deadline must remain terminal',
);
assert.equal(
  isScheduledPostDue(post('publishing', {}, { lastPublishAttemptAt: '2026-07-29T09:40:00.000Z' }), now),
  true,
  'a stale publishing lock should recover',
);
assert.equal(
  isScheduledPostDue(post('publishing', {}, { lastPublishAttemptAt: '2026-07-29T09:50:00.000Z' }), now),
  false,
  'an active publishing lock must not run twice',
);
assert.equal(isScheduledPostDue(post('failed', {}, { publishAttempts: 3 }), now), false, 'exhausted tasks must stop retrying');
assert.equal(isScheduledPostDue(post('on_hold'), now), false, 'a fenced post must never become due');
assert.equal(isScheduledPostDue(post('needs_reconciliation', { reconciliation_required: true }), now), false, 'an uncertain result must never retry blindly');
assert.equal(isScheduledPostDue(post('scheduled', {}, { directPublish: true }), now), false, 'direct publish tracking rows are never scheduler work');
assert.equal(isScheduledPostDue(post('scheduled', {}, { schedulePayloadHash: '' }), now), false, 'unapproved legacy rows are never scheduler work');
assert.equal(isScheduledPostDue(post('scheduled', {
  publish_lease_owner: 'other-worker',
  publish_lease_expires_at: '2026-07-29T10:05:00.000Z',
}), now), false, 'a live lease must not consume scheduler admission capacity');

const orphanedQuiescingPost = post('needs_reconciliation', {
  publish_operation_id: 'orphaned-operation',
  publish_operation_state: 'quiescing',
  publish_lease_expires_at: '',
}, {
  reconciliationStartedAt: '2026-07-29T09:00:00.000Z',
});
assert.equal(
  reconciliationOperationBlock(orphanedQuiescingPost, Date.parse('2026-07-29T09:20:00.000Z')),
  'publish_operation_not_quiesced',
);
assert.equal(
  reconciliationOperationBlock(orphanedQuiescingPost, Date.parse('2026-07-29T09:31:00.000Z')),
  null,
  'an orphaned quiescing transport becomes manually resolvable only after its conservative settlement window',
);

const tiktokOptions = {
  privacyLevel: 'MUTUAL_FOLLOW_FRIENDS',
  allowComment: true,
  allowDuet: false,
  allowStitch: true,
  brandContentToggle: false,
  brandOrganicToggle: true,
  isAigc: true,
  userConsent: true,
} as const;
const tiktokScheduledPost = post('scheduled', { platform: 'tiktok' }, {
  targetAccountIds: ['tiktok-account-1', 'tiktok-account-2'],
  tiktokPublishOptionsByAccount: {
    'tiktok-account-1': tiktokOptions,
    'tiktok-account-2': { ...tiktokOptions, privacyLevel: 'SELF_ONLY' },
  },
});
assert.deepEqual(
  scheduledTikTokPublishOptionsForAccount(tiktokScheduledPost, 'tiktok-account-1'),
  { ok: true, value: tiktokOptions },
  'the scheduler must resolve the exact TikTok disclosure choices for each account',
);
assert.deepEqual(
  scheduledTikTokPublishOptionsForAccount(tiktokScheduledPost, 'missing-account'),
  { ok: false, error: 'tiktok_publish_options_required' },
  'a TikTok account without persisted options must fail before provider admission',
);
assert.deepEqual(
  scheduledTikTokPublishOptionsForAccount(post('scheduled', { platform: 'tiktok' }, {
    tiktokPublishOptionsByAccount: { 'tiktok-account-1': { ...tiktokOptions, userConsent: false } },
  }), 'tiktok-account-1'),
  { ok: false, error: 'tiktok_user_consent_required' },
  'persisted options without explicit consent must fail closed',
);
assert.deepEqual(
  scheduledTikTokPublishOptionsForAccount(post('scheduled', { platform: 'tiktok' }, {
    tiktokPublishOptionsByAccount: { 'tiktok-account-1': { ...tiktokOptions, allowComment: 'yes' } },
  }), 'tiktok-account-1'),
  { ok: false, error: 'tiktok_publish_options_invalid' },
  'TikTok boolean choices must not be coerced into consented provider options',
);

const scheduledQueueStore = new QueueAwareMemoryStore();
await scheduledQueueStore.create('posts', post('published', {
  id: 'defensive-false-positive',
  publish_queue_state: 'pending',
  publish_available_at: '2026-07-29T08:00:00.000Z',
}));
await scheduledQueueStore.create('posts', post('scheduled', {
  id: 'due-from-index',
  published_at: '2026-07-29T09:00:00.000Z',
  publish_queue_state: 'pending',
  publish_available_at: '2026-07-29T09:00:00.000Z',
}));
await scheduledQueueStore.create('posts', post('scheduled', {
  id: 'due-after-batch-limit',
  published_at: '2026-07-29T09:30:00.000Z',
  publish_queue_state: 'pending',
  publish_available_at: '2026-07-29T09:30:00.000Z',
}));
await scheduledQueueStore.create('posts', post('scheduled', {
  id: 'future-index-row',
  published_at: '2026-07-29T09:00:00.000Z',
  publish_queue_state: 'pending',
  publish_available_at: '2026-07-29T10:00:00.001Z',
}));
await scheduledQueueStore.create('posts', post('published', {
  id: 'historical-terminal',
  publish_queue_state: 'terminal',
  publish_available_at: '',
}));
const indexedDue = await collectDueScheduledPosts(scheduledQueueStore, now, 1);
assert.deepEqual(indexedDue.posts.map(item => item.id), ['due-from-index'], 'overfetch must skip a false positive without exceeding the work limit');
assert.equal(indexedDue.inspected, 3, 'only bounded due-index candidates are defensively inspected');
assert.equal(indexedDue.total, -1, 'queue reads must not perform an unbounded total count');
assert.deepEqual(scheduledQueueStore.listQueries, [{
  collection: 'posts',
  query: {
    where: { publish_queue_state: 'pending' },
    lte: { publish_available_at: '2026-07-29T10:00:00.000Z' },
    sort: 'publish_available_at,id',
    page: 1,
    perPage: 500,
    skipTotal: true,
  },
}], 'scheduled candidates must come from one bounded indexed query');

const driftedQueueStore = new QueueAwareMemoryStore();
for (let index = 0; index < 501; index += 1) {
  await driftedQueueStore.create('posts', post('published', {
    id: `a-false-positive-${String(index).padStart(3, '0')}`,
    publish_queue_state: 'pending',
    publish_available_at: '2026-07-29T08:00:00.000Z',
  }));
}
await driftedQueueStore.create('posts', post('scheduled', {
  id: 'z-valid-due-after-drift',
  publish_queue_state: 'pending',
  publish_available_at: '2026-07-29T09:00:00.000Z',
}));
const dueAfterProjectionDrift = await collectDueScheduledPosts(driftedQueueStore, now, 1);
assert.deepEqual(dueAfterProjectionDrift.posts.map(item => item.id), ['z-valid-due-after-drift']);
assert.equal(dueAfterProjectionDrift.inspected, 502, 'bounded pagination must advance beyond a full page of false positives');
assert.equal(driftedQueueStore.listQueries.length, 2);

assert.equal(scheduledRetryDelay(1), 60_000);
assert.equal(scheduledRetryDelay(2), 300_000);
assert.equal(scheduledRetryDelay(3), 900_000);
assert.equal(scheduledRetryDelay(99), 900_000);

assert.deepEqual(classifyPlatformPublishFailure({ response: { status: 422 } }), {
  disposition: 'definitive_rejection', outcomeUnknown: false, retrySafe: true,
  statusCode: 422, reason: 'definitive_http_4xx',
});
assert.equal(classifyPlatformPublishFailure({ statusCode: 408 }).outcomeUnknown, true, 'request timeouts may have committed remotely');
assert.equal(classifyPlatformPublishFailure({ response: { status: 409 } }).outcomeUnknown, true, 'conflicts can represent a duplicate remote commit');
assert.deepEqual(classifyPlatformPublishFailure({ statusCode: 409 }), {
  disposition: 'definitive_rejection', outcomeUnknown: false, retrySafe: false,
  statusCode: 409, reason: 'local_rejection',
}, 'a local CAS/content-fence conflict happened before provider admission');
assert.equal(classifyPlatformPublishFailure({ response: { status: 503 } }).outcomeUnknown, true, '5xx responses must be reconciled');
assert.equal(classifyPlatformPublishFailure(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })).retrySafe, false);
assert.equal(classifyPlatformPublishFailure(new Error('platform returned success without an id')).outcomeUnknown, true);

const directPublishingPost = post('publishing', {
  publish_revision: 2,
  digital_employee_fence_revision: 0,
}, {
  source: 'manual',
  status: 'publishing',
  targetAccountIds: ['account-1'],
  publishResults: {},
  directPublish: true,
});
assert.deepEqual(directPublishAdmission({ tenantId: 'tenant-1', accountId: 'account-1', platform: 'youtube' }, directPublishingPost), {
  allow: false,
  reason: 'publishing',
}, 'a second request with the same idempotency binding must not reach the provider');
const directUnknownClassification = classifyPlatformPublishFailure({ response: { status: 503 } });
const directUnknownPatch = directPublishFailureStatePatch({
  tracked: directPublishingPost,
  accountId: 'account-1',
  classification: directUnknownClassification,
  message: 'upstream unavailable after upload',
  now: '2026-07-29T10:00:15.000Z',
});
assert.equal((directUnknownPatch.stats as Record<string, unknown>).source, 'manual');
assert.equal((directUnknownPatch.stats as Record<string, unknown>).status, 'needs_reconciliation');
assert.equal(((directUnknownPatch.stats as Record<string, unknown>).publishResults as Record<string, { status: string }>)['account-1']?.status, 'unknown');
assert.equal(directUnknownPatch.reconciliation_required, true);
assert.equal(directUnknownPatch.publish_lease_owner, '');
assert.equal(directUnknownPatch.publish_revision, 3);
assert.equal(directUnknownPatch.digital_employee_fence_revision, 1);
assert.deepEqual(directPublishAdmission(
  { tenantId: 'tenant-1', accountId: 'account-1', platform: 'youtube' },
  { ...directPublishingPost, ...directUnknownPatch },
), { allow: false, reason: 'needs_reconciliation' }, 'unknown direct outcomes must block blind replay');
assert.deepEqual(directPublishAdmission(
  { tenantId: 'tenant-1', accountId: 'account-1', platform: 'youtube' },
  { ...directPublishingPost, platform_post_id: 'remote-1', stats: { source: 'manual', status: 'published', targetAccountIds: ['account-1'] } },
), { allow: false, reason: 'published' }, 'a committed idempotency key must never republish');

const legacyDirectAttempt = post('publishing', {
  platform_post_id: '',
  publish_lease_owner: 'legacy-direct-worker',
  publish_lease_expires_at: '',
  reconciliation_required: false,
}, {
  source: 'manual',
  directPublish: true,
  status: 'publishing',
  lastPublishAttemptAt: '2026-07-29T09:45:00.000Z',
});
assert.equal(
  isExpiredDirectPublishAttempt(legacyDirectAttempt, now),
  true,
  'legacy direct rows fall back to last attempt plus the 15 minute stale deadline',
);
assert.equal(
  isExpiredDirectPublishAttempt({
    ...legacyDirectAttempt,
    publish_lease_expires_at: '2026-07-29T09:59:00.000Z',
    stats: { ...(legacyDirectAttempt.stats as Record<string, unknown>), lastPublishAttemptAt: '2026-07-29T09:50:00.000Z' },
  }, now),
  false,
  'when both direct deadlines exist, the later deadline remains authoritative',
);
assert.equal(
  isExpiredDirectPublishAttempt({
    ...legacyDirectAttempt,
    publish_lease_expires_at: '',
    stats: { ...(legacyDirectAttempt.stats as Record<string, unknown>), lastPublishAttemptAt: '' },
  }, now),
  false,
  'a direct row with no valid stale evidence must remain blocked',
);

const directReconciliationStore = new QueueAwareMemoryStore();
const directStaleBeforeEvidence = {
  ...post('publishing', {
    id: 'direct-stale',
    platform: 'tiktok',
    platform_post_id: '',
    publish_revision: 7,
    digital_employee_fence_revision: 2,
    publish_lease_owner: 'direct-publish:direct-stale:7',
    publish_lease_expires_at: '2026-07-29T09:59:59.000Z',
    reconciliation_required: false,
    direct_publish_fence_key: 'content-fence-must-remain',
    direct_publish_account_id: 'account-1',
    publish_operation_id: 'provider-operation-fence-1',
    publish_operation_state: 'active',
    publish_queue_state: 'direct',
    publish_available_at: '2026-07-29T09:59:59.000Z',
  }, {
    source: 'manual',
    directPublish: true,
    status: 'publishing',
    targetAccountIds: ['account-1', 'account-2'],
    nextPublishAttemptAt: '2026-07-29T10:00:00.000Z',
    publishResults: {},
  }),
};
const directStaleEvidence = providerOperationEvidencePatch({
  post: directStaleBeforeEvidence,
  operationId: 'provider-operation-fence-1',
  accountId: 'account-1',
  handle: 'tiktok-publish-id-1',
  observedAt: '2026-07-29T09:45:01.000Z',
});
await directReconciliationStore.create('posts', {
  ...directStaleBeforeEvidence,
  stats: directStaleEvidence.stats,
});
await directReconciliationStore.create('posts', {
  ...post('publishing', {
    id: 'direct-live',
    platform_post_id: '',
    publish_revision: 4,
    digital_employee_fence_revision: 0,
    publish_lease_owner: 'direct-publish:direct-live:4',
    publish_lease_expires_at: '2026-07-29T10:00:01.000Z',
    reconciliation_required: false,
    direct_publish_fence_key: 'live-content-fence',
    direct_publish_account_id: 'account-live',
    publish_operation_id: 'provider-operation-fence-live',
    publish_operation_state: 'active',
    publish_queue_state: 'direct',
    publish_available_at: '2026-07-29T10:00:01.000Z',
  }, {
    source: 'manual',
    directPublish: true,
    status: 'publishing',
    targetAccountIds: ['account-live'],
  }),
});
await directReconciliationStore.create('posts', {
  ...post('published', {
    id: 'direct-index-false-positive',
    platform_post_id: '',
    publish_revision: 1,
    digital_employee_fence_revision: 0,
    publish_lease_owner: '',
    publish_lease_expires_at: '2026-07-29T09:59:00.000Z',
    reconciliation_required: false,
    publish_operation_id: '',
    publish_operation_state: '',
    publish_queue_state: 'direct',
    publish_available_at: '2026-07-29T09:59:00.000Z',
  }, {
    source: 'manual',
    directPublish: true,
    status: 'published',
    targetAccountIds: ['account-false-positive'],
  }),
});
await directReconciliationStore.create('publish_content_fences', {
  id: 'content-fence-must-remain',
  state: 'reserved',
  owner_key: 'direct-owner',
  post_id: 'direct-stale',
  revision: 1,
});
const listedStaleDirect = await directReconciliationStore.getById<PostRecord>('posts', 'direct-stale');
assert.ok(listedStaleDirect && isExpiredDirectPublishAttempt(listedStaleDirect, now));
const directReconciliation = await reconcileExpiredDirectPublishAttempts(directReconciliationStore, now, 1);
assert.deepEqual(directReconciliation, { inspected: 2, candidates: 1, reconciled: 1, conflicts: 0 });
assert.deepEqual(directReconciliationStore.listQueries, [{
  collection: 'posts',
  query: {
    where: { publish_queue_state: 'direct' },
    lte: { publish_available_at: '2026-07-29T10:00:00.000Z' },
    sort: 'publish_available_at,id',
    page: 1,
    perPage: 100,
    skipTotal: true,
  },
}], 'expired direct attempts must come from one bounded indexed query');
const reconciledDirect = await directReconciliationStore.getById<PostRecord>('posts', 'direct-stale');
assert.ok(reconciledDirect);
const reconciledDirectStats = reconciledDirect.stats as Record<string, unknown>;
const reconciledDirectResults = reconciledDirectStats.publishResults as Record<string, PublishResult>;
assert.equal(reconciledDirectStats.status, 'needs_reconciliation');
assert.equal(reconciledDirectStats.nextPublishAttemptAt, '', 'an interrupted direct publish must never auto-retry');
assert.equal(reconciledDirect.reconciliation_required, true);
assert.equal(reconciledDirect.publish_revision, 8);
assert.equal(reconciledDirect.digital_employee_fence_revision, 3);
assert.equal(reconciledDirect.publish_lease_owner, '');
assert.equal(reconciledDirect.publish_lease_expires_at, '');
assert.equal(reconciledDirect.publish_operation_id, 'provider-operation-fence-1');
assert.equal(reconciledDirect.publish_operation_state, 'quiesced');
assert.equal(reconciledDirect.publish_queue_state, 'blocked');
assert.equal(reconciledDirect.publish_available_at, '');
assert.equal(
  reconciledDirectResults['account-1']?.providerOperationId,
  providerOperationAuditReference('tiktok', 'tiktok-publish-id-1'),
  'provider evidence must survive reconciliation only as a non-reversible audit reference',
);
assert.equal(reconciledDirectResults['account-2']?.status, 'unknown', 'every unresolved target account must receive an unknown result');
const untouchedLiveDirect = await directReconciliationStore.getById<PostRecord>('posts', 'direct-live');
assert.equal((untouchedLiveDirect?.stats as Record<string, unknown>).status, 'publishing', 'a live direct lease must remain untouched');
assert.equal(untouchedLiveDirect?.publish_revision, 4);
assert.equal(untouchedLiveDirect?.publish_operation_state, 'active');
assert.deepEqual(await directReconciliationStore.getById('publish_content_fences', 'content-fence-must-remain'), {
  id: 'content-fence-must-remain',
  state: 'reserved',
  owner_key: 'direct-owner',
  post_id: 'direct-stale',
  revision: 1,
}, 'reconciliation must not release the direct-publish content fence');

const youtubeHandle = 'https://upload.youtube.com/resumable/session?upload_id=sensitive-capability';
const youtubeEvidencePost = post('publishing', {
  id: 'youtube-evidence-post',
  publish_operation_id: 'youtube-local-operation',
}, {
  source: 'manual',
  status: 'publishing',
  targetAccountIds: ['youtube-account-1'],
});
const youtubeEvidencePatch = providerOperationEvidencePatch({
  post: youtubeEvidencePost,
  operationId: 'youtube-local-operation',
  accountId: 'youtube-account-1',
  handle: youtubeHandle,
  observedAt: '2026-07-29T09:50:00.000Z',
});
const youtubePostWithEvidence = { ...youtubeEvidencePost, stats: youtubeEvidencePatch.stats };
assert.equal(JSON.stringify(youtubeEvidencePatch.stats).includes(youtubeHandle), false, 'capability-bearing resumable URLs must be encrypted at rest');
assert.equal(
  providerOperationEvidenceForAccount(youtubePostWithEvidence, 'youtube-local-operation', 'youtube-account-1')?.handle,
  youtubeHandle,
  'the reconciler must be able to recover the exact provider handle after a crash',
);
const youtubeReference = providerOperationAuditReference('youtube', youtubeHandle);
assert.match(youtubeReference, /^youtube-resumable:[a-f0-9]{64}$/);
const tiktokHandle = 'tiktok-sensitive-publish-handle';
const tiktokReference = providerOperationAuditReference('tiktok', tiktokHandle);
assert.match(tiktokReference, /^tiktok-operation:[a-f0-9]{64}$/);
assert.equal(tiktokReference.includes(tiktokHandle), false);
assert.equal(providerOperationAuditReference('tiktok', tiktokReference), tiktokReference,
  'audit references must remain stable when failure paths normalize them again');
assert.equal(
  interruptedPublishResults(
    youtubePostWithEvidence,
    youtubeEvidencePatch.stats,
    'worker crashed after provider handle persistence',
    '2026-07-29T10:00:00.000Z',
  )['youtube-account-1']?.providerOperationId,
  youtubeReference,
  'crash recovery must retain a safe audit reference without exposing the resumable URL',
);
const publicEvidenceTracking = publicPublishTracking({
  ...youtubePostWithEvidence,
  publish_lease_owner: 'internal-worker-id',
  stats: {
    ...youtubeEvidencePatch.stats,
    videoPath: '/internal/tenant/video.mp4',
    publishResults: {
      'youtube-account-1': {
        status: 'unknown',
        providerOperationId: youtubeHandle,
      },
    },
  },
});
assert.equal(JSON.stringify(publicEvidenceTracking).includes('providerOperationHandles'), false);
assert.equal(JSON.stringify(publicEvidenceTracking).includes('handleCipher'), false);
assert.equal(JSON.stringify(publicEvidenceTracking).includes('internal-worker-id'), false);
assert.equal(JSON.stringify(publicEvidenceTracking).includes('/internal/tenant/video.mp4'), false);
assert.equal(JSON.stringify(publicEvidenceTracking).includes('providerOperationId'), false);
assert.equal(JSON.stringify(publicEvidenceTracking).includes(youtubeHandle), false);
assert.deepEqual(
  publicPublishedVideo({ id: 'public-video-id', title: 'safe', providerOperationId: youtubeHandle }),
  { id: 'public-video-id', title: 'safe' },
  'direct upload responses must remove exact provider operation handles',
);

const providerEvidenceRaceStore = new ProviderEvidenceTimeoutRaceStore();
const providerEvidenceRacePost = post('publishing', {
  id: 'provider-evidence-race-post',
  platform: 'youtube',
  publish_revision: 4,
  digital_employee_fence_revision: 2,
  publish_lease_owner: 'race-worker',
  publish_lease_expires_at: '2026-07-29T10:15:00.000Z',
  publish_operation_id: 'evidence-race-operation',
  publish_operation_state: 'active',
}, {
  source: 'manual',
  status: 'publishing',
  targetAccountIds: ['youtube-account-1'],
});
await providerEvidenceRaceStore.create('posts', providerEvidenceRacePost);
const racedEvidence = await persistProviderOperationEvidence({
  store: providerEvidenceRaceStore,
  postId: providerEvidenceRacePost.id,
  tenantId: providerEvidenceRacePost.tenant_id,
  platform: providerEvidenceRacePost.platform,
  operationId: 'evidence-race-operation',
  accountId: 'youtube-account-1',
  handle: youtubeHandle,
  leaseOwner: 'race-worker',
  leaseExtensionMs: 60 * 60_000,
  observedAt: '2026-07-29T10:00:01.000Z',
});
assert.equal(racedEvidence.record.publish_operation_state, 'quiescing', 'evidence persistence must never reopen a timed-out operation');
assert.equal(
  racedEvidence.record.publish_lease_expires_at,
  '',
  'evidence persistence must not recreate a lease cleared by timeout reconciliation',
);
assert.equal(racedEvidence.record.publish_lease_owner, '');
assert.equal(racedEvidence.record.reconciliation_required, true);
assert.equal(
  providerOperationEvidenceForAccount(
    racedEvidence.record,
    'evidence-race-operation',
    'youtube-account-1',
  )?.handle,
  youtubeHandle,
  'the exact encrypted handle must survive an active-to-quiescing CAS race',
);

await providerEvidenceRaceStore.update('posts', providerEvidenceRacePost.id, {
  publish_operation_id: 'replacement-operation',
  publish_operation_state: 'active',
  publish_lease_owner: 'race-worker',
  publish_lease_expires_at: '2026-07-29T10:30:00.000Z',
  reconciliation_required: false,
});
await persistProviderOperationEvidence({
  store: providerEvidenceRaceStore,
  postId: providerEvidenceRacePost.id,
  tenantId: providerEvidenceRacePost.tenant_id,
  platform: providerEvidenceRacePost.platform,
  operationId: 'replacement-operation',
  accountId: 'youtube-account-1',
  handle: 'https://upload.youtube.com/resumable/session?upload_id=replacement',
  leaseOwner: 'race-worker',
});
await assert.rejects(
  persistProviderOperationEvidence({
    store: providerEvidenceRaceStore,
    postId: providerEvidenceRacePost.id,
    tenantId: providerEvidenceRacePost.tenant_id,
    platform: providerEvidenceRacePost.platform,
    operationId: 'evidence-race-operation',
    accountId: 'youtube-account-1',
    handle: 'https://upload.youtube.com/resumable/session?upload_id=late-old-operation',
    leaseOwner: 'race-worker',
  }),
  /provider_operation_evidence_fence_lost/,
  'a late callback from an old operation must not overwrite replacement-operation evidence',
);
const replacementEvidencePost = await providerEvidenceRaceStore.getById<PostRecord>('posts', providerEvidenceRacePost.id);
assert.equal(
  providerOperationEvidenceForAccount(
    replacementEvidencePost || {},
    'replacement-operation',
    'youtube-account-1',
  )?.handle,
  'https://upload.youtube.com/resumable/session?upload_id=replacement',
);

const governedPost = post('publishing', {
  digital_employee_run_id: 'run-1',
  digital_employee_approval_id: 'approval-1',
  digital_employee_action_hash: 'a'.repeat(64),
  digital_employee_fence_revision: 4,
  reconciliation_required: false,
}, {
  source: 'digital_employee',
  status: 'publishing',
  targetAccountIds: ['account-1', 'account-2'],
  approvalId: 'approval-1',
  approvedActionHash: 'a'.repeat(64),
  approvalRevision: 3,
  authorizedFenceRevision: 4,
});
const run = { id: 'run-1', tenant_id: 'tenant-1', status: 'running' };
const approval = { id: 'approval-1', tenant_id: 'tenant-1', run_id: 'run-1', status: 'approved', approved_payload_hash: 'a'.repeat(64), revision: 3 };
assert.equal(evaluateDigitalEmployeePublishGovernance(governedPost, run, approval).ok, true);
assert.deepEqual(
  evaluateDigitalEmployeePublishGovernance(governedPost, { ...run, status: 'paused' }, approval),
  { ok: false, code: 'publishing_run_paused', disposition: 'hold' },
);
assert.equal(evaluateDigitalEmployeePublishGovernance(governedPost, { ...run, status: 'cancelled' }, approval).disposition, 'cancel');
assert.equal(evaluateDigitalEmployeePublishGovernance(governedPost, run, { ...approval, revision: 4 }).ok, false);
assert.equal(evaluateDigitalEmployeePublishGovernance({ ...governedPost, digital_employee_fence_revision: 5 }, run, approval).ok, false);

const uncertainPatch = uncertainPublishReconciliationPatch(
  governedPost,
  governedPost.stats as Record<string, unknown>,
  1,
  {
    'account-1': {
      status: 'unknown' as const,
      outcomeUnknown: true,
      error: 'socket timeout',
      failureReason: 'network_or_timeout',
    },
  },
  '平台结果不确定，请人工对账',
  '2026-07-29T10:00:30.000Z',
);
assert.equal((uncertainPatch.stats as Record<string, unknown>).status, 'needs_reconciliation');
assert.equal((uncertainPatch.stats as Record<string, unknown>).nextPublishAttemptAt, '');
assert.equal((uncertainPatch.stats as Record<string, unknown>).outcomeUnknown, true);
assert.equal(((uncertainPatch.stats as Record<string, unknown>).publishResults as Record<string, { status: string }>)['account-1']?.status, 'unknown');
assert.equal(uncertainPatch.reconciliation_required, true);
assert.equal(uncertainPatch.publish_lease_owner, '');
assert.equal(uncertainPatch.digital_employee_fence_revision, 5);
const interruptedResults = interruptedPublishResults(governedPost, governedPost.stats as Record<string, unknown>, 'worker interrupted', '2026-07-29T10:00:45.000Z');
assert.equal(interruptedResults['account-1']?.status, 'unknown');
assert.equal(interruptedResults['account-2']?.status, 'unknown');

const retry = normalizeReconciliationDecision(governedPost, {
  action: 'confirm_not_published_retry', expectedRevision: 0, note: '已在两个账号后台核对',
  receipts: [
    { accountId: 'account-1', outcome: 'not_published', verifiedAt: '2026-07-29T10:00:00.000Z', evidence: 'account activity log #1' },
    { accountId: 'account-2', outcome: 'not_published', verifiedAt: '2026-07-29T10:00:00.000Z', evidence: 'account activity log #2' },
  ],
});
assert.equal(retry.ok, true);
if (retry.ok) {
  const patch = reconciliationPatchForDecision(governedPost, retry.value, 'admin-1', '2026-07-29T10:01:00.000Z');
  assert.equal((patch.stats as Record<string, unknown>).status, 'failed');
  assert.equal((patch.stats as Record<string, unknown>).authorizedFenceRevision, 5);
  assert.equal(patch.digital_employee_fence_revision, 5);
}
const mixedRetry = normalizeReconciliationDecision(governedPost, {
  action: 'confirm_not_published_retry', expectedRevision: 0, note: '准备重试',
  receipts: [
    { accountId: 'account-1', outcome: 'published', platformPostId: 'post-1', verifiedAt: '2026-07-29T10:00:00.000Z', evidence: 'platform permalink' },
    { accountId: 'account-2', outcome: 'not_published', verifiedAt: '2026-07-29T10:00:00.000Z', evidence: 'account activity log' },
  ],
});
assert.equal(mixedRetry.ok, true, 'known published accounts remain fenced while only known-not-published accounts retry');
if (mixedRetry.ok) {
  const patch = reconciliationPatchForDecision(governedPost, mixedRetry.value, 'admin-1', '2026-07-29T10:01:00.000Z');
  const results = (patch.stats as Record<string, unknown>).publishResults as Record<string, { status: string }>;
  assert.equal(results['account-1']?.status, 'published');
  assert.equal(results['account-2']?.status, 'failed');
  assert.equal(patch.platform_post_id, '', 'a mixed retry must not set the top-level terminal publication ID');
  assert.equal(patch.publish_queue_state, 'pending');
  assert.equal(patch.publish_available_at, '2026-07-29T10:01:00.000Z');
  const retryPost = { ...governedPost, ...patch } as PostRecord;
  assert.deepEqual(
    targetAccountsRequiringPublish(retryPost),
    ['account-2'],
    'the scheduler must skip an account already proven published',
  );
  assert.equal(isScheduledPostDue(retryPost, Date.parse('2026-07-29T10:01:00.000Z')), true);
}
assert.equal(normalizeReconciliationDecision(governedPost, {
  action: 'confirm_published', expectedRevision: 0, note: '已核对', receipts: [],
}).ok, false, 'every account needs a receipt');
const voidDecision = normalizeReconciliationDecision(governedPost, {
  action: 'void', expectedRevision: 0, note: '部分发布后停止后续账号',
  receipts: [
    { accountId: 'account-1', outcome: 'published', platformPostId: 'platform-post-1', verifiedAt: '2026-07-29T10:02:00.000Z', evidence: 'platform permalink' },
    { accountId: 'account-2', outcome: 'not_published', verifiedAt: '2026-07-29T10:03:00.000Z', evidence: 'account activity log' },
  ],
});
assert.equal(voidDecision.ok, true);
if (voidDecision.ok) {
  const patch = reconciliationPatchForDecision(governedPost, voidDecision.value, 'admin-1', '2026-07-29T10:04:00.000Z');
  assert.equal(patch.platform_post_id, 'platform-post-1');
  assert.equal(patch.published_at, '2026-07-29T10:02:00.000Z');
  assert.equal((patch.stats as Record<string, unknown>).status, 'voided');
  assert.equal((patch.stats as Record<string, unknown>).externalPublicationsDetected, true);
  assert.equal(((patch.stats as Record<string, unknown>).publishResults as Record<string, { status: string }>)['account-1']?.status, 'published');
}

const heartbeatEvents: Array<{ name: string; details?: Record<string, unknown> }> = [];
let finishHeartbeatWork: (() => void) | undefined;
const heartbeatWork = new Promise<void>(resolve => { finishHeartbeatWork = resolve; });
const heartbeatCycle = withScheduledPublisherCycleHeartbeat(
  () => heartbeatWork,
  {
    intervalMs: 5,
    now: () => now,
    record: (name, details) => heartbeatEvents.push({ name, details }),
  },
);
assert.equal(heartbeatEvents.length, 1, 'a cycle heartbeat must be written before long-running work starts');
assert.equal(heartbeatEvents[0]?.name, 'scheduled-publisher');
assert.equal(heartbeatEvents[0]?.details?.state, 'running');
await new Promise(resolve => setTimeout(resolve, 25));
assert.ok(heartbeatEvents.length >= 2, 'long provider work must refresh the heartbeat inside the cycle');
finishHeartbeatWork?.();
await heartbeatCycle;
const heartbeatCountAfterFinally = heartbeatEvents.length;
await new Promise(resolve => setTimeout(resolve, 15));
assert.equal(heartbeatEvents.length, heartbeatCountAfterFinally, 'the in-cycle heartbeat timer must be cleared in finally');

console.log('scheduledPublisher passed');
