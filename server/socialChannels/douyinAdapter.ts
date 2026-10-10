import { createHash } from 'node:crypto';
import {
  SOCIAL_CHANNEL_CAPABILITIES,
  type AccountContentSyncPage,
  type ChannelCapabilityDecision,
  type ChannelCapabilityMatrix,
  type DouyinApplicationType,
  type DouyinCapabilityContext,
  type SocialChannelCapability,
} from '../../shared/contracts/socialChannels.js';
import {
  ChannelAdapterError,
  type AccountContentSyncInput,
  type ChannelAdapter,
  type ChannelArtifactInput,
  type OfficialPublishInput,
  type OfficialPublishReceipt,
} from './adapter.js';

export const DOUYIN_OFFICIAL_PUBLISH_SCOPE = 'video.create.bind';

export interface DouyinReadCapabilityRule {
  /** Intentionally required from deployed configuration; no legacy scope is assumed. */
  scope: string;
  allowedApplicationTypes: DouyinApplicationType[];
}

export interface DouyinOfficialApiPort {
  createVideo?(input: OfficialPublishInput): Promise<OfficialPublishReceipt>;
  listAccountContent?(input: AccountContentSyncInput): Promise<AccountContentSyncPage>;
}

export interface DouyinChannelAdapterOptions {
  officialApi?: DouyinOfficialApiPort;
  officialPublishApplicationTypes?: DouyinApplicationType[];
  contentList?: DouyinReadCapabilityRule;
  contentMetrics?: DouyinReadCapabilityRule;
  accountMetrics?: DouyinReadCapabilityRule;
}

function containsCredentialField(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => (
    /(access[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie|authorization)/i.test(key)
    || containsCredentialField(child)
  ));
}

function decision(
  capability: SocialChannelCapability,
  availability: ChannelCapabilityDecision['availability'],
  source: ChannelCapabilityDecision['source'],
  reasonCode?: string,
  requirements?: string[],
  verifiedAt?: string,
): ChannelCapabilityDecision {
  return {
    capability,
    availability,
    source,
    ...(reasonCode ? { reasonCode } : {}),
    ...(requirements?.length ? { requirements } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
  };
}

function evaluateOfficial(
  capability: 'official_publish' | 'content_list' | 'content_metrics' | 'account_metrics',
  context: DouyinCapabilityContext | undefined,
  configured: boolean,
  requiredScope: string | undefined,
  allowedApplicationTypes: DouyinApplicationType[] | undefined,
  now: string,
): ChannelCapabilityDecision {
  const requirements = [
    'application_review_approved',
    ...(requiredScope ? [`scope:${requiredScope}`] : ['explicit_scope_configuration']),
    'user_access_token',
    'unexpired_access_token',
    'eligible_account',
    'real_account_e2e',
  ];
  if (!configured || !requiredScope || !allowedApplicationTypes?.length) {
    return decision(capability, 'unconfigured', 'official_api', 'douyin_official_capability_not_configured', requirements);
  }
  if (!context) return decision(capability, 'unconfigured', 'official_api', 'douyin_authorization_context_missing', requirements);
  if (context.applicationReview !== 'approved') {
    return decision(capability, 'unavailable', 'official_api', 'douyin_application_not_approved', requirements);
  }
  if (!allowedApplicationTypes.includes(context.applicationType)) {
    return decision(capability, 'unavailable', 'official_api', 'douyin_application_type_not_allowed', requirements);
  }
  if (!context.approvedScopes.includes(requiredScope)) {
    return decision(capability, 'unavailable', 'official_api', 'douyin_scope_missing', requirements);
  }
  if (context.tokenType !== 'user_access_token') {
    return decision(capability, 'unavailable', 'official_api', 'douyin_user_token_required', requirements);
  }
  if (context.tokenHealth !== 'valid') {
    return decision(capability, 'unavailable', 'official_api', 'douyin_access_token_not_valid', requirements);
  }
  if (context.accountQualification !== 'eligible') {
    return decision(capability, 'unavailable', 'official_api', 'douyin_account_not_qualified', requirements);
  }
  if (context.realAccountE2E !== 'passed') {
    return decision(capability, 'unavailable', 'official_api', 'douyin_real_account_e2e_required', requirements);
  }
  return decision(capability, 'available', 'official_api', undefined, undefined, now);
}

function douyinChecks(input: ChannelArtifactInput): ReturnType<ChannelAdapter['validateArtifact']> {
  const video = input.assets.find(asset => asset.kind === 'video');
  const cover = input.assets.find(asset => asset.kind === 'cover');
  return [
    {
      code: 'content_hash',
      status: /^[a-f0-9]{32,128}$/i.test(input.contentHash) ? 'passed' : 'failed',
      message: '作品版本必须带有效内容哈希。',
    },
    {
      code: 'douyin_video_required',
      status: video ? 'passed' : 'failed',
      message: '抖音发布包必须包含视频主文件。',
    },
    {
      code: 'douyin_cover',
      status: cover ? 'passed' : 'warning',
      message: cover ? '已包含冻结封面。' : '未提供独立封面，发布前需在抖音页面确认封面。',
    },
    {
      code: 'douyin_copy',
      status: input.copy.title.trim() || input.copy.body.trim() ? 'passed' : 'failed',
      message: '标题或正文至少填写一项。',
    },
  ];
}

export function createDouyinChannelAdapter(options: DouyinChannelAdapterOptions = {}): ChannelAdapter {
  const matrix = (context = {} as Parameters<ChannelAdapter['capabilityMatrix']>[0]): ChannelCapabilityMatrix => {
    const now = (context?.evaluatedAt ?? new Date()).toISOString();
    const douyin = context?.douyin;
    const decisions = Object.fromEntries(SOCIAL_CHANNEL_CAPABILITIES.map(capability => {
      if (capability === 'publication_package') {
        return [capability, decision(capability, 'available', 'built_in', undefined, undefined, now)];
      }
      if (capability === 'assisted_browser_publish') {
        return [capability, context?.assistedBrowserE2E === 'passed'
          ? decision(capability, 'available', 'assisted_browser', undefined, undefined, now)
          : decision(capability, 'unconfigured', 'assisted_browser', 'assisted_browser_e2e_required', ['real_account_e2e'])];
      }
      if (capability === 'official_publish') {
        return [capability, evaluateOfficial(
          capability,
          douyin,
          Boolean(options.officialApi?.createVideo),
          DOUYIN_OFFICIAL_PUBLISH_SCOPE,
          options.officialPublishApplicationTypes,
          now,
        )];
      }
      if (capability === 'content_list') {
        return [capability, evaluateOfficial(
          capability,
          douyin,
          Boolean(options.officialApi?.listAccountContent),
          options.contentList?.scope,
          options.contentList?.allowedApplicationTypes,
          now,
        )];
      }
      if (capability === 'content_metrics') {
        return [capability, evaluateOfficial(
          capability,
          douyin,
          Boolean(options.officialApi?.listAccountContent),
          options.contentMetrics?.scope,
          options.contentMetrics?.allowedApplicationTypes,
          now,
        )];
      }
      if (capability === 'account_metrics') {
        return [capability, evaluateOfficial(
          capability,
          douyin,
          Boolean(options.officialApi?.listAccountContent),
          options.accountMetrics?.scope,
          options.accountMetrics?.allowedApplicationTypes,
          now,
        )];
      }
      const webhookReady = Boolean(douyin?.webhookConfigured)
        && douyin?.applicationReview === 'approved'
        && douyin.realAccountE2E === 'passed';
      return [capability, webhookReady
        ? decision(capability, 'available', 'official_api', undefined, undefined, now)
        : decision(capability, 'unconfigured', 'official_api', 'douyin_webhook_not_ready', ['client_secret', 'real_account_e2e'])];
    })) as Record<SocialChannelCapability, ChannelCapabilityDecision>;
    return { schemaVersion: 'social-channel-capabilities.v1', channelId: 'douyin_cn', evaluatedAt: now, decisions };
  };

  return {
    channelId: 'douyin_cn',
    capabilityMatrix: matrix,
    validateArtifact: douyinChecks,
    buildPublishingInstructions: () => [
      '在国内抖音创作者页面核对目标账号；不要使用 TikTok 国际版入口或凭据。',
      '上传发布包中的冻结视频和封面，并按包内文案填写标题、标签和 CTA。',
      '核对可见范围、商业内容声明和平台规格；登录、验证码、二次验证或风控必须交还用户处理。',
      '最终发布按钮由用户本人确认，V1 辅助流程不得自动点击。',
      '发布后回填抖音内容 ID、公开链接或平台回执；无法核实时标记为待对账。',
    ],
    async publishOfficially(input) {
      const capability = matrix(input.capabilityContext).decisions.official_publish;
      if (capability.availability !== 'available' || !options.officialApi?.createVideo) {
        throw new ChannelAdapterError(capability.reasonCode ?? 'douyin_official_publish_unavailable', 409);
      }
      const receipt = await options.officialApi.createVideo(input);
      if (!['provider_accepted', 'reconciliation_required', 'rejected'].includes(receipt.status)
        || !/^[a-f0-9]{32,128}$/i.test(receipt.receiptHash)
        || containsCredentialField(receipt)) {
        throw new ChannelAdapterError('douyin_official_receipt_invalid', 502);
      }
      return {
        status: receipt.status,
        ...(receipt.providerRequestId ? { providerRequestId: receipt.providerRequestId } : {}),
        ...(receipt.externalContentId ? { externalContentId: receipt.externalContentId } : {}),
        receiptHash: receipt.receiptHash.toLowerCase(),
        ...(receipt.acceptedAt ? { acceptedAt: receipt.acceptedAt } : {}),
        ...(receipt.reasonCode ? { reasonCode: receipt.reasonCode } : {}),
      };
    },
    async syncAccountContent(input) {
      const capability = matrix(input.capabilityContext).decisions.content_list;
      if (capability.availability !== 'available' || !options.officialApi?.listAccountContent) {
        throw new ChannelAdapterError(capability.reasonCode ?? 'douyin_content_list_unavailable', 409);
      }
      const result = await options.officialApi.listAccountContent(input);
      if (result.source !== 'official_api'
        || containsCredentialField(result)
        || result.cursor.tenantId !== input.tenantId
        || result.cursor.channelId !== 'douyin_cn'
        || result.cursor.accountId !== input.accountId
        || result.items.some(item => item.channelId !== 'douyin_cn' || item.tenantId !== input.tenantId)
        || result.metricSnapshots.some(item => item.channelId !== 'douyin_cn' || item.tenantId !== input.tenantId)) {
        throw new ChannelAdapterError('douyin_official_response_invalid', 502);
      }
      return result;
    },
  };
}

export function digestDouyinProviderReceipt(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
