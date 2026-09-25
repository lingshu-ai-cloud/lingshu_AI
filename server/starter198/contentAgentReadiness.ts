import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ContentAgentDependencyId =
  | 'qwen'
  | 'tts'
  | 'object_storage'
  | 'apify'
  | 'heygen'
  | 'runway'
  | 'seedance'
  | 'authorized_shared_inventory';

export type ContentAgentVerification = {
  status: 'not_run' | 'passed' | 'failed';
  checkedAt: string | null;
  evidenceRef: string | null;
  reason: string | null;
};

export interface ContentAgentDependencyReadiness {
  id: ContentAgentDependencyId;
  label: string;
  implementationPresent: boolean;
  credentialConfigured: boolean;
  enabled: boolean;
  configurationReady: boolean;
  operationallyVerified: boolean;
  productionReady: boolean;
  state: 'unavailable' | 'configured' | 'configuration_ready' | 'verified' | 'degraded';
  configuredModes: string[];
  missingRequirements: string[];
  notes: string[];
  verification: ContentAgentVerification;
}

export interface ContentAgentReadinessReport {
  schemaVersion: 'content-agent-readiness.v1';
  generatedAt: string;
  networkChecksPerformed: false;
  dependencies: ContentAgentDependencyReadiness[];
  summary: {
    configurationReady: ContentAgentDependencyId[];
    productionReady: ContentAgentDependencyId[];
    blocked: ContentAgentDependencyId[];
  };
}

export interface AuthorizedSharedInventoryItem {
  id: string;
  authorizationRef?: string | null;
  usable?: boolean;
}

export interface BuildContentAgentReadinessInput {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** Results from explicit, non-synthetic health or E2E checks. Credentials alone never create these. */
  verifications?: Partial<Record<ContentAgentDependencyId, ContentAgentVerification>>;
  /** Tenant-filtered inventory only. Omit rather than passing cross-tenant records. */
  authorizedSharedInventory?: AuthorizedSharedInventoryItem[];
  fileExists?: (filePath: string) => boolean;
}

const blankVerification = (): ContentAgentVerification => ({
  status: 'not_run', checkedAt: null, evidenceRef: null, reason: null,
});

function text(env: NodeJS.ProcessEnv, key: string): string {
  return String(env[key] || '').trim();
}

function enabled(env: NodeJS.ProcessEnv, key: string): boolean {
  return text(env, key).toLowerCase() === 'true' || text(env, key) === '1';
}

function verificationFor(
  input: BuildContentAgentReadinessInput,
  id: ContentAgentDependencyId,
): ContentAgentVerification {
  return structuredClone(input.verifications?.[id] ?? blankVerification());
}

function dependency(input: {
  id: ContentAgentDependencyId;
  label: string;
  credentialConfigured: boolean;
  enabled: boolean;
  configurationReady: boolean;
  configuredModes?: string[];
  missingRequirements?: string[];
  notes?: string[];
  verification: ContentAgentVerification;
}): ContentAgentDependencyReadiness {
  const operationallyVerified = input.verification.status === 'passed';
  const productionReady = input.configurationReady && operationallyVerified;
  const state = input.verification.status === 'failed' ? 'degraded'
    : productionReady ? 'verified'
      : input.configurationReady ? 'configuration_ready'
        : input.credentialConfigured ? 'configured' : 'unavailable';
  return {
    id: input.id,
    label: input.label,
    implementationPresent: true,
    credentialConfigured: input.credentialConfigured,
    enabled: input.enabled,
    configurationReady: input.configurationReady,
    operationallyVerified,
    productionReady,
    state,
    configuredModes: input.configuredModes ?? [],
    missingRequirements: input.missingRequirements ?? [],
    notes: input.notes ?? [],
    verification: input.verification,
  };
}

/**
 * Produces a read-only readiness snapshot. It performs no network calls and
 * never exposes secret values. A configured key means configuration only;
 * productionReady additionally requires caller-supplied verification evidence.
 */
export function buildContentAgentReadiness(
  input: BuildContentAgentReadinessInput = {},
): ContentAgentReadinessReport {
  const env = input.env ?? process.env;
  const exists = input.fileExists ?? fs.existsSync;
  const qwenKeyFile = text(env, 'DASHSCOPE_API_KEY_FILE')
    || path.join(os.homedir(), '.config/lingshu/dashscope.key');
  const qwenCredential = Boolean(text(env, 'DASHSCOPE_API_KEY')) || exists(qwenKeyFile);

  const objectEndpoint = Boolean(text(env, 'OBJECT_STORAGE_ENDPOINT') || text(env, 'R2_ACCOUNT_ID'));
  const objectAccess = Boolean(text(env, 'OBJECT_STORAGE_ACCESS_KEY_ID') || text(env, 'R2_ACCESS_KEY_ID'));
  const objectSecret = Boolean(text(env, 'OBJECT_STORAGE_SECRET_ACCESS_KEY') || text(env, 'R2_SECRET_ACCESS_KEY'));
  const objectBucket = Boolean(text(env, 'OBJECT_STORAGE_BUCKET_NAME') || text(env, 'R2_BUCKET_NAME'));
  const objectReady = objectEndpoint && objectAccess && objectSecret && objectBucket;

  const qwenTts = qwenCredential;
  const minimaxTts = Boolean(text(env, 'MINIMAX_API_KEY') || text(env, 'MINIMAX_API_TOKEN'));
  const xttsPath = text(env, 'XTTS_BIN') || text(env, 'COQUI_TTS_BIN');
  const xtts = Boolean(xttsPath && exists(xttsPath));
  const ttsModes = [qwenTts && 'qwen', minimaxTts && 'minimax', xtts && 'xtts_local'].filter(Boolean) as string[];

  const apifyCredential = Boolean(text(env, 'APIFY_TOKEN'));
  const apifyModes = [
    enabled(env, 'APIFY_TIKTOK_CRAWL_FALLBACK_ENABLED') && 'tiktok_crawl',
    enabled(env, 'APIFY_TIKTOK_VIDEO_FALLBACK_ENABLED') && 'tiktok_video',
    enabled(env, 'APIFY_INSTAGRAM_CRAWL_FALLBACK_ENABLED') && 'instagram_crawl',
    enabled(env, 'APIFY_INSTAGRAM_VIDEO_FALLBACK_ENABLED') && 'instagram_video',
    enabled(env, 'APIFY_FACEBOOK_CRAWL_FALLBACK_ENABLED') && 'facebook_crawl',
  ].filter(Boolean) as string[];

  const heygenCredential = Boolean(text(env, 'HEYGEN_API_KEY'));
  const heygenEnabled = enabled(env, 'HEYGEN_GENERATION_ENABLED');
  const heygenSocialEnabled = enabled(env, 'SOCIAL_CONTENT_HEYGEN_ENABLED');
  const studioBudgetLimit = Number(text(env, 'STUDIO_PAID_BUDGET_CNY'));
  const studioBudgetUsed = Number(text(env, 'STUDIO_PAID_OPENING_USED_CNY'));
  const heygenReserve = Number(text(env, 'STUDIO_HEYGEN_RESERVE_CNY'));
  const heygenBudgetReady = Number.isFinite(studioBudgetLimit) && studioBudgetLimit > 0
    && Number.isFinite(studioBudgetUsed) && studioBudgetUsed >= 0
    && Number.isFinite(heygenReserve) && heygenReserve > 0
    && studioBudgetUsed + heygenReserve <= studioBudgetLimit;
  const runwayCredential = Boolean(text(env, 'RUNWAYML_API_SECRET'));
  const runwayEnabled = enabled(env, 'RUNWAY_ACT_TWO_ENABLED');
  const runwayCosts = Boolean(Number(text(env, 'RUNWAY_ACT_TWO_CNY_PER_CREDIT')) > 0
    && Number(text(env, 'RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND')) > 0);
  const runwayBudget = Boolean(Number(text(env, 'DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT')) > 0
    && Number(text(env, 'DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY')) > 0);
  const configuredRunwayHosts = text(env, 'RUNWAY_OUTPUT_HOST_SUFFIXES').split(',').map(value => value.trim()).filter(Boolean);
  const runwayHostsValid = configuredRunwayHosts.every(value => /^(?:\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/i.test(value)
    && value.includes('.') && !value.includes('..'));

  const seedanceCredential = Boolean(text(env, 'SEEDANCE_API_KEY'));
  const seedanceModes = [
    enabled(env, 'SEEDANCE_VIDEO_ENABLED') && 'video',
    enabled(env, 'SEEDANCE_REFERENCE_ENABLED') && 'reference',
    enabled(env, 'SEEDANCE_SENTENCE_ENABLED') && 'sentence',
  ].filter(Boolean) as string[];
  const seedanceModel = Boolean(text(env, 'SEEDANCE_MODEL'));
  const seedanceReferenceNeedsStorage = seedanceModes.includes('reference') || seedanceModes.includes('sentence');
  const seedanceConfigurationReady = seedanceCredential && seedanceModes.length > 0 && seedanceModel
    && (!seedanceReferenceNeedsStorage || objectReady);

  const inventory = input.authorizedSharedInventory;
  const usableAuthorizedInventory = inventory?.filter(item => item.usable !== false && Boolean(item.authorizationRef?.trim())) ?? [];
  const inventoryKnown = inventory !== undefined;

  const dependencies: ContentAgentDependencyReadiness[] = [
    dependency({
      id: 'qwen', label: 'Qwen / DashScope', credentialConfigured: qwenCredential, enabled: qwenCredential,
      configurationReady: qwenCredential, configuredModes: qwenCredential ? ['text', 'vision', 'asr'] : [],
      missingRequirements: qwenCredential ? [] : ['DASHSCOPE_API_KEY 或可读的 DASHSCOPE_API_KEY_FILE'],
      notes: exists(qwenKeyFile) && !text(env, 'DASHSCOPE_API_KEY') ? ['凭据来自共享密钥文件；报告未读取或暴露密钥内容'] : [],
      verification: verificationFor(input, 'qwen'),
    }),
    dependency({
      id: 'tts', label: '语音合成', credentialConfigured: ttsModes.length > 0, enabled: ttsModes.length > 0,
      configurationReady: ttsModes.length > 0, configuredModes: ttsModes,
      missingRequirements: ttsModes.length ? [] : ['DASHSCOPE_API_KEY、MINIMAX_API_KEY 或有效 XTTS_BIN 至少一项'],
      verification: verificationFor(input, 'tts'),
    }),
    dependency({
      id: 'object_storage', label: '对象存储', credentialConfigured: objectAccess && objectSecret,
      enabled: objectReady, configurationReady: objectReady,
      configuredModes: objectReady ? ['private_object_io', ...(text(env, 'R2_PUBLIC_URL') ? ['public_delivery'] : [])] : [],
      missingRequirements: [!objectEndpoint && '对象存储 endpoint/account', !objectAccess && 'access key', !objectSecret && 'secret key', !objectBucket && 'bucket'].filter(Boolean) as string[],
      verification: verificationFor(input, 'object_storage'),
    }),
    dependency({
      id: 'apify', label: 'Apify 采集', credentialConfigured: apifyCredential, enabled: apifyModes.length > 0,
      configurationReady: apifyCredential && apifyModes.length > 0, configuredModes: apifyModes,
      missingRequirements: [!apifyCredential && 'APIFY_TOKEN', !apifyModes.length && '至少一个 APIFY_*_FALLBACK_ENABLED 开关'].filter(Boolean) as string[],
      verification: verificationFor(input, 'apify'),
    }),
    dependency({
      id: 'heygen', label: 'HeyGen 数字人', credentialConfigured: heygenCredential, enabled: heygenEnabled,
      configurationReady: heygenCredential && heygenEnabled && heygenSocialEnabled && objectReady && heygenBudgetReady,
      configuredModes: heygenEnabled && heygenSocialEnabled ? ['talking_avatar', 'social_presenter_bridge'] : [],
      missingRequirements: [!heygenCredential && 'HEYGEN_API_KEY', !heygenEnabled && 'HEYGEN_GENERATION_ENABLED=true',
        !heygenSocialEnabled && 'SOCIAL_CONTENT_HEYGEN_ENABLED=true', !objectReady && '对象存储',
        !heygenBudgetReady && 'STUDIO_PAID_BUDGET_CNY、STUDIO_PAID_OPENING_USED_CNY、STUDIO_HEYGEN_RESERVE_CNY（且余额充足）'].filter(Boolean) as string[],
      notes: ['供应商输出仅接受无认证信息、无自定义端口的 heygen.ai / heygen.com HTTPS 域名'],
      verification: verificationFor(input, 'heygen'),
    }),
    dependency({
      id: 'runway', label: 'Runway Act-Two', credentialConfigured: runwayCredential, enabled: runwayEnabled,
      configurationReady: runwayCredential && runwayEnabled && objectReady && runwayCosts && runwayBudget && runwayHostsValid,
      configuredModes: runwayEnabled ? ['act_two'] : [],
      missingRequirements: [!runwayCredential && 'RUNWAYML_API_SECRET', !runwayEnabled && 'RUNWAY_ACT_TWO_ENABLED=true', !objectReady && '对象存储',
        !runwayCosts && 'RUNWAY_ACT_TWO_CNY_PER_CREDIT、RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND',
        !runwayBudget && 'DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT、DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY',
        !runwayHostsValid && 'RUNWAY_OUTPUT_HOST_SUFFIXES 含无效域名后缀'].filter(Boolean) as string[],
      notes: [configuredRunwayHosts.length
        ? `输出仅接受配置的 ${configuredRunwayHosts.length} 个 HTTPS 域名后缀`
        : 'RUNWAY_OUTPUT_HOST_SUFFIXES 留空时仅接受 CloudFront HTTPS 输出'],
      verification: verificationFor(input, 'runway'),
    }),
    dependency({
      id: 'seedance', label: 'Seedance', credentialConfigured: seedanceCredential, enabled: seedanceModes.length > 0,
      configurationReady: seedanceConfigurationReady, configuredModes: seedanceModes,
      missingRequirements: [!seedanceCredential && 'SEEDANCE_API_KEY', !seedanceModes.length && '至少一个 Seedance 启用开关', !seedanceModel && 'SEEDANCE_MODEL', seedanceReferenceNeedsStorage && !objectReady && '参考/逐句模式所需对象存储'].filter(Boolean) as string[],
      notes: seedanceCredential ? ['API Key 已识别；这不代表模型权限、任务提交、产物下载或质量验收成功'] : [],
      verification: verificationFor(input, 'seedance'),
    }),
    dependency({
      id: 'authorized_shared_inventory', label: '授权共享素材库存', credentialConfigured: inventoryKnown,
      enabled: inventoryKnown, configurationReady: usableAuthorizedInventory.length > 0,
      configuredModes: usableAuthorizedInventory.length ? ['tenant_filtered_authorized_assets'] : [],
      missingRequirements: !inventoryKnown ? ['租户过滤后的共享库存快照']
        : usableAuthorizedInventory.length ? [] : ['至少一条可用且带 authorizationRef 的共享素材'],
      notes: inventoryKnown ? [`已审计 ${inventory!.length} 条，符合授权要求 ${usableAuthorizedInventory.length} 条`] : [],
      verification: inventoryKnown && usableAuthorizedInventory.length > 0
        ? { status: 'passed', checkedAt: (input.now ?? new Date()).toISOString(), evidenceRef: 'authorized_shared_inventory_snapshot', reason: null }
        : verificationFor(input, 'authorized_shared_inventory'),
    }),
  ];

  return {
    schemaVersion: 'content-agent-readiness.v1',
    generatedAt: (input.now ?? new Date()).toISOString(),
    networkChecksPerformed: false,
    dependencies,
    summary: {
      configurationReady: dependencies.filter(item => item.configurationReady).map(item => item.id),
      productionReady: dependencies.filter(item => item.productionReady).map(item => item.id),
      blocked: dependencies.filter(item => !item.productionReady).map(item => item.id),
    },
  };
}
