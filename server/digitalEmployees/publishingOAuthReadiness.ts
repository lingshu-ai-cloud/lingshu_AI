export type PublishingOAuthPlatform = 'facebook' | 'instagram' | 'tiktok' | 'youtube';

export type PublishingOAuthClients = {
  meta: boolean;
  instagram: boolean;
  tiktok: boolean;
  google: boolean;
};

export type PublishingReadinessSnapshot = {
  required: boolean;
  ready: boolean;
  status: 'not_required' | 'ready' | 'action_required' | 'unavailable';
  targetPlatforms: PublishingOAuthPlatform[];
  connectedPlatforms: PublishingOAuthPlatform[];
  missingOAuthPlatforms: PublishingOAuthPlatform[];
  missingAccountPlatforms: PublishingOAuthPlatform[];
  summary: string;
  actionPage: 'accountManagement';
};

const labels: Record<PublishingOAuthPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

const isPublishingOAuthPlatform = (platform: string): platform is PublishingOAuthPlatform =>
  Object.prototype.hasOwnProperty.call(labels, platform);

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
    .filter(isPublishingOAuthPlatform)
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

export function buildPublishingReadinessSnapshot(input: {
  required: boolean;
  targetPlatforms: string[];
  connectedPlatforms: string[];
  clients: PublishingOAuthClients;
}): PublishingReadinessSnapshot {
  const targetPlatforms = [...new Set(input.targetPlatforms)]
    .filter(isPublishingOAuthPlatform);
  const targetSet = new Set(targetPlatforms);
  const connectedPlatforms = [...new Set(input.connectedPlatforms)]
    .filter(isPublishingOAuthPlatform)
    .filter(platform => targetSet.has(platform));
  if (!input.required) {
    return {
      required: false,
      ready: true,
      status: 'not_required',
      targetPlatforms,
      connectedPlatforms,
      missingOAuthPlatforms: [],
      missingAccountPlatforms: [],
      summary: '本周计划不包含平台发布任务',
      actionPage: 'accountManagement',
    };
  }
  const missingOAuthPlatforms = missingPublishingOAuthConfiguration({
    targetPlatforms,
    connectedPlatforms,
    clients: input.clients,
  });
  const connected = new Set(connectedPlatforms);
  const missingAccountPlatforms = targetPlatforms.filter(platform => !connected.has(platform));
  const ready = missingOAuthPlatforms.length === 0 && missingAccountPlatforms.length === 0;
  return {
    required: true,
    ready,
    status: ready ? 'ready' : 'action_required',
    targetPlatforms,
    connectedPlatforms,
    missingOAuthPlatforms,
    missingAccountPlatforms,
    summary: ready
      ? '本周目标平台授权与真实发布账号均已就绪'
      : [
          publishingOAuthConfigurationMessage(missingOAuthPlatforms),
          publishingAccountConnectionMessage(missingAccountPlatforms),
        ].filter(message => !/已配置|均已连接/.test(message)).join('；'),
    actionPage: 'accountManagement',
  };
}
