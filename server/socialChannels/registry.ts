import {
  SOCIAL_CHANNEL_CAPABILITIES,
  SOCIAL_CHANNEL_IDS,
  normalizeSocialChannelId,
  type ChannelCapabilityDecision,
  type ChannelCapabilityMatrix,
  type SocialChannelCapability,
  type SocialChannelId,
} from '../../shared/contracts/socialChannels.js';
import type {
  ChannelAdapter,
  ChannelArtifactInput,
  ChannelCapabilityEvaluationContext,
} from './adapter.js';
import { ChannelAdapterError } from './adapter.js';
import { createDouyinChannelAdapter, type DouyinChannelAdapterOptions } from './douyinAdapter.js';

const available = (
  capability: SocialChannelCapability,
  source: ChannelCapabilityDecision['source'],
  verifiedAt?: string,
): ChannelCapabilityDecision => ({ capability, availability: 'available', source, ...(verifiedAt ? { verifiedAt } : {}) });

const unavailable = (
  capability: SocialChannelCapability,
  source: ChannelCapabilityDecision['source'],
  reasonCode: string,
  requirements: string[] = [],
): ChannelCapabilityDecision => ({ capability, availability: 'unconfigured', source, reasonCode, requirements });

function genericChecks(input: ChannelArtifactInput): ReturnType<ChannelAdapter['validateArtifact']> {
  const checks: ReturnType<ChannelAdapter['validateArtifact']> = [];
  checks.push({
    code: 'content_hash',
    status: /^[a-f0-9]{32,128}$/i.test(input.contentHash) ? 'passed' : 'failed',
    message: '作品版本必须带有效内容哈希。',
  });
  checks.push({
    code: 'primary_media',
    status: input.assets.some(asset => asset.kind === 'video' || asset.kind === 'image') ? 'passed' : 'failed',
    message: '至少需要一个视频或图片主文件。',
  });
  checks.push({
    code: 'copy',
    status: input.copy.title.trim() || input.copy.body.trim() ? 'passed' : 'failed',
    message: '标题或正文至少填写一项。',
  });
  return checks;
}

function genericInstructions(channelId: Exclude<SocialChannelId, 'douyin_cn'>): string[] {
  const names: Record<Exclude<SocialChannelId, 'douyin_cn'>, string> = {
    tiktok_global: 'TikTok 国际版',
    instagram: 'Instagram',
    facebook: 'Facebook',
    youtube: 'YouTube',
  };
  return [
    `在 ${names[channelId]} 打开新建内容页面，并核对目标账号。`,
    '上传发布包中的冻结媒体与封面，不替换为未审批版本。',
    '复制标题、正文、标签、CTA 和替代文本，并核对可见范围。',
    '发布前由用户完成最终确认；登录、验证码、二次验证或风控必须交还用户处理。',
    '发布后回填公开链接、平台内容 ID 或平台回执；无法核实时标记为待对账。',
  ];
}

function createGenericAdapter(channelId: Exclude<SocialChannelId, 'douyin_cn'>): ChannelAdapter {
  return {
    channelId,
    capabilityMatrix(context: ChannelCapabilityEvaluationContext = {}): ChannelCapabilityMatrix {
      const now = (context.evaluatedAt ?? new Date()).toISOString();
      const assisted = context.assistedBrowserE2E === 'passed'
        ? available('assisted_browser_publish', 'assisted_browser', now)
        : unavailable('assisted_browser_publish', 'assisted_browser', 'assisted_browser_e2e_required', ['real_account_e2e']);
      const decisions = Object.fromEntries(SOCIAL_CHANNEL_CAPABILITIES.map(capability => [
        capability,
        capability === 'publication_package'
          ? available(capability, 'built_in', now)
          : capability === 'assisted_browser_publish'
            ? assisted
            : unavailable(capability, 'official_api', 'official_adapter_not_configured', ['tenant_authorization', 'approved_scope', 'real_account_e2e']),
      ])) as Record<SocialChannelCapability, ChannelCapabilityDecision>;
      return { schemaVersion: 'social-channel-capabilities.v1', channelId, evaluatedAt: now, decisions };
    },
    validateArtifact: genericChecks,
    buildPublishingInstructions: () => genericInstructions(channelId),
  };
}

export class ChannelAdapterRegistry {
  private readonly adapters = new Map<SocialChannelId, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.channelId)) {
      throw new ChannelAdapterError('channel_adapter_duplicate', 500);
    }
    this.adapters.set(adapter.channelId, adapter);
  }

  get(channel: unknown): ChannelAdapter {
    const channelId = normalizeSocialChannelId(channel);
    if (!channelId) throw new ChannelAdapterError('social_channel_invalid');
    const adapter = this.adapters.get(channelId);
    if (!adapter) throw new ChannelAdapterError('social_channel_adapter_missing', 503);
    return adapter;
  }

  matrices(context: ChannelCapabilityEvaluationContext = {}): ChannelCapabilityMatrix[] {
    return SOCIAL_CHANNEL_IDS.map(channelId => this.get(channelId).capabilityMatrix(context));
  }
}

export function createDefaultChannelRegistry(
  options: { douyin?: DouyinChannelAdapterOptions } = {},
): ChannelAdapterRegistry {
  const registry = new ChannelAdapterRegistry();
  registry.register(createDouyinChannelAdapter(options.douyin));
  registry.register(createGenericAdapter('tiktok_global'));
  registry.register(createGenericAdapter('instagram'));
  registry.register(createGenericAdapter('facebook'));
  registry.register(createGenericAdapter('youtube'));
  return registry;
}

export const socialChannelRegistry = createDefaultChannelRegistry();
