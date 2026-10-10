import type { TikTokDirectPostOptions } from './tikTokPostSettings';
import type { PublishPlatform } from './publishQueueState';

export const EXTERNAL_VIDEO_PLATFORMS: readonly PublishPlatform[] = ['youtube', 'instagram', 'facebook', 'tiktok'];

export type ExternalVideoAccount = {
  id: string;
  platform: PublishPlatform;
  label: string;
  status: string;
};

export type ExternalVideoApprovalRequest = {
  videoPath: string;
  title: string;
  description: string;
  platform: PublishPlatform;
  targetAccountIds: string[];
  scheduledAt: string;
  trackWaLink: boolean;
  tiktokPostOptions?: TikTokDirectPostOptions;
  tiktokCreatorReceiptHash?: string;
};

export type ExternalApprovalState = { status: string; scheduledAt: string; platformPostId?: string; platformUrl?: string };

export function canRestartExternalApprovals(approvals: readonly ExternalApprovalState[], now = Date.now()): boolean {
  return approvals.length > 0
    && approvals.every(approval => ['awaiting_approval', 'rejected', 'failed'].includes(approval.status))
    && approvals.some(approval => ['rejected', 'failed'].includes(approval.status)
      || Date.parse(approval.scheduledAt) <= now);
}

export function canStartNextExternalVideo(approvals: readonly (ExternalApprovalState | undefined)[]): boolean {
  return approvals.length === EXTERNAL_VIDEO_PLATFORMS.length
    && approvals.every(approval => approval?.status === 'published' && Boolean(approval.platformPostId || approval.platformUrl));
}

export function buildExternalVideoApprovalRequests(input: {
  videoPath: string;
  title: string;
  description: string;
  scheduledAt: string;
  accountIds: Partial<Record<PublishPlatform, string>>;
  accounts: readonly ExternalVideoAccount[];
  trackWaLink: boolean;
  tiktokPostOptions?: TikTokDirectPostOptions;
  tiktokCreatorReceiptHash?: string;
}): ExternalVideoApprovalRequest[] {
  const videoPath = input.videoPath.trim();
  const title = input.title.trim();
  const scheduled = new Date(input.scheduledAt);
  if (!videoPath || !title) throw new Error('请先上传视频并填写标题');
  if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now()) throw new Error('请选择未来的发布时间');
  return EXTERNAL_VIDEO_PLATFORMS.map(platform => {
    const accountId = input.accountIds[platform];
    const account = input.accounts.find(item => item.id === accountId && item.platform === platform && item.status === 'connected');
    if (!account) throw new Error(`请为 ${platform} 选择一个已授权账号`);
    if (platform === 'tiktok' && (!input.tiktokPostOptions || input.tiktokPostOptions.userConsent !== true || input.tiktokPostOptions.musicUsageConfirmed !== true || !/^[a-f0-9]{64}$/.test(input.tiktokCreatorReceiptHash || ''))) throw new Error('请完成 TikTok 最新账号设置与本次发布授权');
    return {
      ...(platform === 'tiktok' ? { tiktokPostOptions: structuredClone(input.tiktokPostOptions!), tiktokCreatorReceiptHash: input.tiktokCreatorReceiptHash } : {}),
      videoPath,
      title,
      description: input.description.trim(),
      platform,
      targetAccountIds: [account.id],
      scheduledAt: scheduled.toISOString(),
      trackWaLink: input.trackWaLink,
    };
  });
}
