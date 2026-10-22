import type { PublishPlatform } from '../../lib/publishQueueState';

export const PLATFORM_META: Record<PublishPlatform, { label: string; color: string; format: string }> = {
  youtube: { label: 'YouTube', color: '#ff0000', format: 'Shorts / Video' },
  tiktok: { label: 'TikTok', color: '#111827', format: '9:16 短视频' },
  instagram: { label: 'Instagram', color: '#c13584', format: 'Reels' },
  facebook: { label: 'Facebook', color: '#1877f2', format: 'Reels / Page Video' },
  linkedin: { label: 'LinkedIn', color: '#0A66C2', format: 'Feed Video' },
};
