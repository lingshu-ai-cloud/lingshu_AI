import assert from 'node:assert/strict';
import {
  buildTikTokPublishOptionsByAccount,
  cancelCalendarPostsBeforeReschedule,
  createDefaultTikTokPublishOptions,
  isIgnorableCalendarDeleteError,
  normalizeVideoDurationSeconds,
  normalizeStoredPublishDraft,
  normalizeStoredPublishQueueItem,
  normalizeTikTokPublishOptions,
  replacePublishVideoIdentity,
  tiktokCalendarPublishRequestOptions,
  tiktokDirectPublishRequestOptions,
  validateTikTokPublishOptions,
  type TikTokCreatorInfo,
} from './TrafficPage';

const legacyItem = normalizeStoredPublishQueueItem({ id: 'legacy-item' });
assert.ok(legacyItem);
assert.equal(legacyItem.videoPath, '');
assert.equal(legacyItem.title, '');
assert.deepEqual(legacyItem.targetAccountIds, []);
assert.deepEqual(legacyItem.platformCopy, {});
assert.equal(legacyItem.deliveryMode, 'now');
assert.equal(legacyItem.status, 'draft');
assert.deepEqual(legacyItem.directPublishRevisions, {});
assert.deepEqual(legacyItem.calendarPostRevisions, {});
assert.deepEqual(legacyItem.tiktokPublishOptionsByAccount, {}, 'legacy queue entries must not inherit consent or a privacy default');
assert.equal(legacyItem.videoDurationSeconds, undefined, 'legacy queue entries must fail closed until metadata is measured');

assert.deepEqual(createDefaultTikTokPublishOptions(), {
  privacyLevel: '',
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  commercialContent: false,
  brandContentToggle: false,
  brandOrganicToggle: false,
  isAigc: false,
  userConsent: false,
}, 'TikTok controls must start unselected and fail closed');

const malformedItem = normalizeStoredPublishQueueItem({
  id: 'malformed-item',
  videoPath: 42,
  title: null,
  targetAccountIds: 'not-an-array',
  platformCopy: [],
  deliveryMode: 'later',
  status: 'unknown',
  completedTargets: 'NaN',
  videoDurationSeconds: '30',
});
assert.ok(malformedItem);
assert.equal(malformedItem.videoPath, '');
assert.equal(malformedItem.title, '');
assert.deepEqual(malformedItem.targetAccountIds, []);
assert.equal(malformedItem.completedTargets, 0);
assert.equal(malformedItem.videoDurationSeconds, undefined);

const validItem = normalizeStoredPublishQueueItem({
  id: 'valid-item',
  selected: true,
  videoPath: '/api/overseas/publishing/local-videos/example.mp4',
  title: 'Example',
  description: 'Description',
  targetAccountIds: ['account-1', '', 7],
  platformCopy: { tiktok: { caption: 'Caption', hashtags: ['one', 2] } },
  deliveryMode: 'schedule',
  scheduledAt: '2026-08-27T20:00',
  status: 'ready',
  completedTargets: 1,
  videoDurationSeconds: 37.1254,
  tiktokPublishOptionsByAccount: {
    'account-1': {
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      allowComment: true,
      allowDuet: 'yes',
      brandOrganicToggle: true,
      userConsent: true,
    },
  },
});
assert.ok(validItem);
assert.deepEqual(validItem.targetAccountIds, ['account-1']);
assert.deepEqual(validItem.platformCopy.tiktok.hashtags, ['one']);
assert.equal(validItem.deliveryMode, 'schedule');
assert.equal(validItem.status, 'ready');
assert.equal(validItem.videoDurationSeconds, 37.125);
assert.deepEqual(validItem.tiktokPublishOptionsByAccount['account-1'], {
  privacyLevel: 'PUBLIC_TO_EVERYONE',
  allowComment: true,
  allowDuet: false,
  allowStitch: false,
  commercialContent: true,
  brandContentToggle: false,
  brandOrganicToggle: true,
  isAigc: false,
  userConsent: true,
});

assert.deepEqual(normalizeTikTokPublishOptions({
  privacyLevel: 'EVERYONE',
  allowComment: 1,
  commercialContent: 'true',
  userConsent: 'true',
}), createDefaultTikTokPublishOptions(), 'malformed persisted values must not synthesize user choices');

const creator: TikTokCreatorInfo = {
  username: 'factory_creator',
  nickname: 'Factory Creator',
  avatarUrl: '',
  privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
  maxVideoPostDurationSec: 180,
};
assert.deepEqual(validateTikTokPublishOptions(createDefaultTikTokPublishOptions(), creator, 30), [
  '请选择 TikTok 可见范围',
  '请明确同意 TikTok Music Usage Confirmation',
]);
assert.deepEqual(validateTikTokPublishOptions({
  ...createDefaultTikTokPublishOptions(),
  privacyLevel: 'PUBLIC_TO_EVERYONE',
  allowDuet: true,
  commercialContent: true,
  userConsent: true,
}, creator, 30), [
  '该创作者已关闭 Duet',
  '商业内容必须披露“自有品牌”或“第三方品牌”',
]);
assert.deepEqual(validateTikTokPublishOptions({
  ...createDefaultTikTokPublishOptions(),
  privacyLevel: 'SELF_ONLY',
  commercialContent: true,
  brandContentToggle: true,
  userConsent: true,
}, creator, 30), ['第三方品牌合作内容不能设为仅自己可见']);

const compliantOptions = {
  ...createDefaultTikTokPublishOptions(),
  privacyLevel: 'PUBLIC_TO_EVERYONE' as const,
  allowComment: true,
  allowStitch: true,
  commercialContent: true,
  brandOrganicToggle: true,
  isAigc: true,
  userConsent: true,
};
assert.deepEqual(validateTikTokPublishOptions(compliantOptions, creator, 30), []);
assert.deepEqual(validateTikTokPublishOptions(compliantOptions, creator), [
  '尚未读取视频实际时长，请等待素材 metadata 加载完成',
], 'TikTok must fail closed until the actual media duration is known');
assert.deepEqual(validateTikTokPublishOptions(compliantOptions, creator, 180.051), [
  '视频实际时长 180.051 秒，超过该创作者允许的 180 秒',
], 'a video beyond the creator limit must be blocked before direct or scheduled publish');
assert.deepEqual(buildTikTokPublishOptionsByAccount(
  ['account-1'],
  { 'account-1': compliantOptions },
  { 'account-1': creator },
  30,
), {
  'account-1': {
    privacyLevel: 'PUBLIC_TO_EVERYONE',
    allowComment: true,
    allowDuet: false,
    allowStitch: true,
    brandContentToggle: false,
    brandOrganicToggle: true,
    isAigc: true,
    userConsent: true,
  },
}, 'the wire payload must omit the UI-only commercial-content master toggle');
assert.deepEqual(tiktokDirectPublishRequestOptions(
  'account-1',
  { 'account-1': compliantOptions },
  { 'account-1': creator },
  30,
), {
  tiktokPublishOptions: buildTikTokPublishOptionsByAccount(
    ['account-1'], { 'account-1': compliantOptions }, { 'account-1': creator }, 30,
  )['account-1'],
});
assert.deepEqual(tiktokCalendarPublishRequestOptions(
  ['account-1'],
  { 'account-1': compliantOptions },
  { 'account-1': creator },
  30,
), {
  tiktokPublishOptionsByAccount: buildTikTokPublishOptionsByAccount(
    ['account-1'], { 'account-1': compliantOptions }, { 'account-1': creator }, 30,
  ),
});
const privateCreator: TikTokCreatorInfo = {
  ...creator,
  username: 'private_creator',
  nickname: 'Private Creator',
  privacyLevelOptions: ['SELF_ONLY'],
  duetDisabled: false,
};
const privateOptions = {
  ...createDefaultTikTokPublishOptions(),
  privacyLevel: 'SELF_ONLY' as const,
  userConsent: true,
};
assert.deepEqual(tiktokCalendarPublishRequestOptions(
  ['account-1', 'account-2'],
  { 'account-1': compliantOptions, 'account-2': privateOptions },
  { 'account-1': creator, 'account-2': privateCreator },
  30,
).tiktokPublishOptionsByAccount, {
  'account-1': buildTikTokPublishOptionsByAccount(['account-1'], { 'account-1': compliantOptions }, { 'account-1': creator }, 30)['account-1'],
  'account-2': buildTikTokPublishOptionsByAccount(['account-2'], { 'account-2': privateOptions }, { 'account-2': privateCreator }, 30)['account-2'],
}, 'calendar payloads must preserve each creator account\'s independent choices');
assert.throws(
  () => tiktokDirectPublishRequestOptions('account-1', {}, { 'account-1': creator }, 30),
  /请选择 TikTok 可见范围.*Music Usage Confirmation/,
  'direct publish payload construction must block until every explicit confirmation is complete',
);

assert.equal(normalizeVideoDurationSeconds(12.3456), 12.346);
assert.equal(normalizeVideoDurationSeconds('12.3'), undefined);
assert.equal(normalizeVideoDurationSeconds(Number.POSITIVE_INFINITY), undefined);
const replacedVideo = replacePublishVideoIdentity('/tenant/video-b.mp4', {
  'account-1': compliantOptions,
  'account-2': privateOptions,
}, 42.125);
assert.equal(replacedVideo.videoDurationSeconds, 42.125);
assert.equal(replacedVideo.tiktokPublishOptionsByAccount['account-1'].userConsent, false);
assert.equal(replacedVideo.tiktokPublishOptionsByAccount['account-2'].userConsent, false);
const clearedVideo = replacePublishVideoIdentity('', replacedVideo.tiktokPublishOptionsByAccount);
assert.equal(clearedVideo.videoDurationSeconds, undefined);
assert.equal(clearedVideo.tiktokPublishOptionsByAccount['account-1'].userConsent, false);

const interruptedItem = normalizeStoredPublishQueueItem({
  id: 'interrupted', status: 'publishing', directPublishRevisions: { 'account-1': 3 },
  calendarPostRevisions: { 'post-1': 7 },
});
assert.ok(interruptedItem);
assert.equal(interruptedItem.status, 'failed');
assert.match(interruptedItem.error || '', /原请求键/);
assert.equal(interruptedItem.directPublishRevisions['account-1'], 3);
assert.equal(interruptedItem.calendarPostRevisions?.['post-1'], 7);

const draft = normalizeStoredPublishDraft({
  title: 'Fallback title',
  description: null,
  items: [
    { videoPath: '/media/one.mp4', title: 'One', description: 'First', platform: 'tiktok' },
    null,
    { videoPath: 42, title: 'Legacy', description: 'Second', platform: 'unsupported' },
  ],
});
assert.ok(draft);
assert.equal(draft.description, '');
assert.equal(draft.items?.length, 2);
assert.equal(draft.items?.[1].videoPath, undefined);
assert.equal(draft.items?.[1].platform, undefined);

assert.equal(isIgnorableCalendarDeleteError(Object.assign(new Error('missing'), { responseStatus: 404 })), true);
assert.equal(isIgnorableCalendarDeleteError(Object.assign(new Error('publishing'), { responseStatus: 409 })), false);
let createsAfterConflict = 0;
await assert.rejects(async () => {
  await cancelCalendarPostsBeforeReschedule(['old-post'], async () => {
    throw Object.assign(new Error('publishing_post_cannot_be_removed'), { responseStatus: 409 });
  });
  createsAfterConflict += 1;
}, /已停止创建新排期/);
assert.equal(createsAfterConflict, 0, 'a 409 delete must stop the reschedule before any create');
let removedAfterNotFound = 0;
await cancelCalendarPostsBeforeReschedule(['gone', 'existing'], async postId => {
  if (postId === 'gone') throw Object.assign(new Error('missing'), { responseStatus: 404 });
  removedAfterNotFound += 1;
});
assert.equal(removedAfterNotFound, 1, 'only an explicit 404 is safe to ignore');

console.log('TrafficPage publish queue compatibility tests passed');
