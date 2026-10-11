import assert from 'node:assert/strict';
import { buildExternalVideoApprovalRequests, canRestartExternalApprovals, canStartNextExternalVideo, EXTERNAL_VIDEO_PLATFORMS, type ExternalVideoAccount } from './externalVideoApproval';

const accounts: ExternalVideoAccount[] = EXTERNAL_VIDEO_PLATFORMS.map(platform => ({ id: `${platform}-1`, platform, label: platform, status: 'connected' }));
const input = {
  videoPath: '/tenant-a/manual-video.mp4', title: '授权视频', description: '验收内容',
  scheduledAt: new Date(Date.now() + 60_000).toISOString(),
  accountIds: Object.fromEntries(EXTERNAL_VIDEO_PLATFORMS.map(platform => [platform, `${platform}-1`])),
  accounts, trackWaLink: true,
  tiktokPostOptions: {privacyLevel:'SELF_ONLY' as const,allowComment:false,allowDuet:false,allowStitch:false,commercial:{ownBrand:false,brandedContent:false},isAigc:false,musicUsageConfirmed:true,userConsent:true},
  tiktokCreatorReceiptHash:'a'.repeat(64),
};
const requests = buildExternalVideoApprovalRequests(input);
assert.deepEqual(requests.map(request => request.platform), ['youtube', 'instagram', 'facebook', 'tiktok']);
assert.ok(requests.every(request => request.targetAccountIds.length === 1 && request.videoPath === input.videoPath));
assert.deepEqual(requests.find(item => item.platform === 'tiktok')?.tiktokPostOptions,input.tiktokPostOptions);
assert.equal(requests.find(item => item.platform === 'tiktok')?.tiktokCreatorReceiptHash,input.tiktokCreatorReceiptHash);
assert.equal(requests.find(item => item.platform === 'instagram')?.tiktokPostOptions,undefined);
assert.throws(()=>buildExternalVideoApprovalRequests({...input,tiktokCreatorReceiptHash:''}),/TikTok/);
assert.throws(()=>buildExternalVideoApprovalRequests({...input,tiktokPostOptions:undefined}),/TikTok/);
assert.ok(buildExternalVideoApprovalRequests({ ...input, trackWaLink: false }).every(request => request.trackWaLink === false));
assert.throws(() => buildExternalVideoApprovalRequests({ ...input, accountIds: { ...input.accountIds, facebook: '' } }), /facebook/);
assert.throws(() => buildExternalVideoApprovalRequests({ ...input, scheduledAt: new Date(Date.now() - 60_000).toISOString() }), /未来/);
assert.throws(() => buildExternalVideoApprovalRequests({ ...input, videoPath: '' }), /上传视频/);

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();
assert.equal(canRestartExternalApprovals([{ status: 'awaiting_approval', scheduledAt: past }]), true);
assert.equal(canRestartExternalApprovals([{ status: 'rejected', scheduledAt: future }]), true);
assert.equal(canRestartExternalApprovals([{ status: 'scheduled', scheduledAt: past }, { status: 'awaiting_approval', scheduledAt: past }]), false);
assert.equal(canStartNextExternalVideo(EXTERNAL_VIDEO_PLATFORMS.map(() => ({ status: 'scheduled', scheduledAt: past }))), false);
assert.equal(canStartNextExternalVideo(EXTERNAL_VIDEO_PLATFORMS.map(() => ({ status: 'published', scheduledAt: past, platformPostId: 'post-1' }))), true);
assert.equal(canStartNextExternalVideo(EXTERNAL_VIDEO_PLATFORMS.map(() => ({ status: 'published', scheduledAt: past }))), false);

console.log('external video approval request tests passed');
