export type PublishingOAuthPlatform = 'facebook' | 'instagram' | 'tiktok' | 'youtube';

export type PublishingOAuthClients = {
  meta: boolean;
  instagram: boolean;
  tiktok: boolean;
  google: boolean;
};

const labels: Record<PublishingOAuthPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

/**
 * Existing connected accounts remain usable without forcing a new OAuth app
 * check. Only a platform that still needs its first/replacement connection is
 * blocked by missing administrator OAuth configuration.
 */
export function missingPublishingOAuthConfiguration(input: {
  targetPlatforms: string[];
  connectedPlatforms: string[];
  clients: PublishingOAuthClients;
}): PublishingOAuthPlatform[] {
  const connected = new Set(input.connectedPlatforms);
  return [...new Set(input.targetPlatforms)]
    .filter((platform): platform is PublishingOAuthPlatform => platform in labels)
    .filter(platform => !connected.has(platform))
    .filter(platform => platform === 'facebook' ? !input.clients.meta
      : platform === 'instagram' ? !(input.clients.instagram || input.clients.meta)
        : platform === 'tiktok' ? !input.clients.tiktok
          : !input.clients.google);
}

export function publishingOAuthConfigurationMessage(platforms: PublishingOAuthPlatform[]): string {
  return platforms.length
    ? `${platforms.map(platform => labels[platform]).join('、')} 授权服务尚未配置，管理员需先配置平台应用与回调地址`
    : '目标平台授权服务已配置';
}

export function publishingAccountConnectionMessage(platforms: PublishingOAuthPlatform[]): string {
  return platforms.length
    ? `${platforms.map(platform => labels[platform]).join('、')} 尚未连接真实发布账号，请先在账号管理完成授权`
    : '本周目标平台均已连接真实发布账号';
}
