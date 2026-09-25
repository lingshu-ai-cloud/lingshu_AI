import { getPbUrl, pbListStrict } from '../storage/pb.js';
import { processRoleStartsBackgroundJobs, type ProcessRole } from './processRole.js';

export type RuntimeCapability =
  | 'text_generation'
  | 'qwen_generation'
  | 'tts'
  | 'video_generation'
  | 'digital_human'
  | 'starter_workers'
  | 'scheduled_publishing'
  | 'quote'
  | 'platform_ads';

export interface CapabilityState {
  ready: boolean;
  reason?: string;
}

/**
 * Prerequisites for the local, per-sentence replication worker. This is kept
 * deliberately configuration-only: it never validates a credential with a
 * provider and never returns a configured value.
 */
export interface SentenceReplicationReadiness {
  ready: boolean;
  missing: string[];
  reason?: string;
}

const KNOWN_CAPABILITIES: RuntimeCapability[] = [
  'text_generation',
  'qwen_generation',
  'tts',
  'video_generation',
  'digital_human',
  'starter_workers',
  'scheduled_publishing',
  'quote',
  'platform_ads',
];

const enabled = (name: string) => process.env[name] === 'true';
const present = (name: string) => Boolean(String(process.env[name] || '').trim());

const envEnabled = (env: NodeJS.ProcessEnv, name: string) => String(env[name] || '').trim().toLowerCase() === 'true';
const envPresent = (env: NodeJS.ProcessEnv, name: string) => Boolean(String(env[name] || '').trim());
const positiveFinite = (env: NodeJS.ProcessEnv, name: string) => {
  const value = Number(String(env[name] || '').trim());
  return Number.isFinite(value) && value > 0;
};

export interface DigitalHumanProviderReadiness {
  heygen: CapabilityState;
  custom: CapabilityState;
  runwayActTwo: CapabilityState;
  seedanceReference: CapabilityState;
}

/**
 * Configuration-only provider audit. It deliberately performs no network or
 * paid supplier call and never returns credential values.
 */
export function digitalHumanProviderReadiness(
  env: NodeJS.ProcessEnv = process.env,
): DigitalHumanProviderReadiness {
  const objectStorageReady = (envPresent(env, 'OBJECT_STORAGE_ENDPOINT') || envPresent(env, 'R2_ACCOUNT_ID') || envPresent(env, 'COS_ENDPOINT') || envPresent(env, 'COS_REGION'))
    && (envPresent(env, 'OBJECT_STORAGE_ACCESS_KEY_ID') || envPresent(env, 'R2_ACCESS_KEY_ID') || envPresent(env, 'COS_SECRET_ID'))
    && (envPresent(env, 'OBJECT_STORAGE_SECRET_ACCESS_KEY') || envPresent(env, 'R2_SECRET_ACCESS_KEY') || envPresent(env, 'COS_SECRET_KEY'))
    && (envPresent(env, 'OBJECT_STORAGE_BUCKET_NAME') || envPresent(env, 'R2_BUCKET_NAME') || envPresent(env, 'COS_BUCKET'));
  const state = (missing: string[]): CapabilityState => ({
    ready: missing.length === 0,
    ...(missing.length ? { reason: `missing:${missing.join(',')}` } : {}),
  });
  return {
    heygen: state([
      ...(!envEnabled(env, 'HEYGEN_GENERATION_ENABLED') ? ['HEYGEN_GENERATION_ENABLED=true'] : []),
      ...(!envPresent(env, 'HEYGEN_API_KEY') ? ['HEYGEN_API_KEY'] : []),
    ]),
    custom: state([
      ...(!envPresent(env, 'DIGITAL_HUMAN_API_URL') ? ['DIGITAL_HUMAN_API_URL'] : []),
      ...(!envPresent(env, 'DIGITAL_HUMAN_API_KEY') ? ['DIGITAL_HUMAN_API_KEY'] : []),
    ]),
    runwayActTwo: state([
      ...(!envEnabled(env, 'RUNWAY_ACT_TWO_ENABLED') ? ['RUNWAY_ACT_TWO_ENABLED=true'] : []),
      ...(!envPresent(env, 'RUNWAYML_API_SECRET') ? ['RUNWAYML_API_SECRET'] : []),
      ...(!objectStorageReady ? ['object_storage'] : []),
      ...(!positiveFinite(env, 'RUNWAY_ACT_TWO_CNY_PER_CREDIT') ? ['RUNWAY_ACT_TWO_CNY_PER_CREDIT'] : []),
      ...(!positiveFinite(env, 'RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND') ? ['RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND'] : []),
      ...(!positiveFinite(env, 'DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT') ? ['DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT'] : []),
      ...(!positiveFinite(env, 'DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY') ? ['DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY'] : []),
    ]),
    seedanceReference: state([
      ...(!envEnabled(env, 'SEEDANCE_REFERENCE_ENABLED') ? ['SEEDANCE_REFERENCE_ENABLED=true'] : []),
      ...(!envPresent(env, 'SEEDANCE_API_KEY') ? ['SEEDANCE_API_KEY'] : []),
      ...(!envPresent(env, 'SEEDANCE_MODEL') ? ['SEEDANCE_MODEL'] : []),
      ...(!objectStorageReady ? ['object_storage'] : []),
      ...(!positiveFinite(env, 'SEEDANCE_REFERENCE_ESTIMATED_CNY_PER_SECOND') ? ['SEEDANCE_REFERENCE_ESTIMATED_CNY_PER_SECOND'] : []),
      ...(!positiveFinite(env, 'DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT') ? ['DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT'] : []),
      ...(!positiveFinite(env, 'DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY') ? ['DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY'] : []),
    ]),
  };
}

export function sentenceReplicationReadiness(env: NodeJS.ProcessEnv = process.env): SentenceReplicationReadiness {
  const configured = (name: string) => Boolean(String(env[name] || '').trim());
  const switchedOn = (name: string) => String(env[name] || '').trim().toLowerCase() === 'true';
  const objectEndpoint = configured('OBJECT_STORAGE_ENDPOINT') || configured('R2_ACCOUNT_ID') || configured('COS_ENDPOINT') || configured('COS_REGION');
  const objectAccessKey = configured('OBJECT_STORAGE_ACCESS_KEY_ID') || configured('R2_ACCESS_KEY_ID') || configured('COS_SECRET_ID');
  const objectSecret = configured('OBJECT_STORAGE_SECRET_ACCESS_KEY') || configured('R2_SECRET_ACCESS_KEY') || configured('COS_SECRET_KEY');
  const objectBucket = configured('OBJECT_STORAGE_BUCKET_NAME') || configured('R2_BUCKET_NAME') || configured('COS_BUCKET');
  const missing = [
    !switchedOn('SEEDANCE_SENTENCE_ENABLED') && 'SEEDANCE_SENTENCE_ENABLED=true',
    !configured('SEEDANCE_API_KEY') && 'SEEDANCE_API_KEY',
    !configured('SEEDANCE_MODEL') && 'SEEDANCE_MODEL',
    !(configured('SEEDREAM_API_KEY') || configured('SEEDANCE_API_KEY')) && 'SEEDREAM_API_KEY 或 SEEDANCE_API_KEY（Seedream 目标人物首帧生成）',
    switchedOn('DIGITAL_HUMAN_SEMANTIC_QA_ENABLED') && !(configured('DASHSCOPE_API_KEY') || configured('DASHSCOPE_API_KEY_FILE')) && 'DASHSCOPE_API_KEY 或 DASHSCOPE_API_KEY_FILE（独立语义质检）',
    switchedOn('DIGITAL_HUMAN_SEMANTIC_QA_ENABLED') && !configured('QWEN_DIGITAL_HUMAN_QA_MODEL') && 'QWEN_DIGITAL_HUMAN_QA_MODEL',
    !objectEndpoint && '对象存储 endpoint/account',
    !objectAccessKey && '对象存储 access key',
    !objectSecret && '对象存储 secret key',
    !objectBucket && '对象存储 bucket',
  ].filter(Boolean) as string[];
  return {
    ready: missing.length === 0,
    missing,
    ...(missing.length ? { reason: `逐句复刻尚不可执行，缺少：${missing.join('、')}` } : {}),
  };
}

function textGenerationCapability(): CapabilityState {
  const backend = String(process.env.OVERSEAS_LLM_BACKEND || 'qwen').trim().toLowerCase();
  if (backend === 'gemini') {
    const ready = present('GEMINI_API_KEY');
    return { ready, reason: ready ? undefined : 'selected_text_model_key_missing:gemini' };
  }
  if (backend === 'qwen') {
    const ready = present('DASHSCOPE_API_KEY');
    return { ready, reason: ready ? undefined : 'selected_text_model_key_missing:qwen' };
  }
  return { ready: false, reason: `unsupported_text_model_backend:${backend || 'empty'}` };
}

export function runtimeCapabilities(role: ProcessRole): Record<RuntimeCapability, CapabilityState> {
  const background = processRoleStartsBackgroundJobs(role);
  const textGeneration = textGenerationCapability();
  const qwenReady = present('DASHSCOPE_API_KEY');
  const ttsReady = present('MINIMAX_API_KEY') || present('PIPER_BIN') || present('XTTS_BIN');
  const videoReady = (enabled('SEEDANCE_VIDEO_ENABLED') && present('SEEDANCE_API_KEY'))
    || (enabled('GEMINI_VIDEO_ENABLED') && present('GEMINI_API_KEY'));
  const digitalHumanProviders = digitalHumanProviderReadiness();
  const digitalHumanReady = Object.values(digitalHumanProviders).some(provider => provider.ready);
  const starterWorkersReady = background
    && enabled('STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED')
    && enabled('STARTER_QUOTE_ARTIFACT_WORKER_ENABLED')
    && enabled('STARTER_198_ORCHESTRATOR_WORKER_ENABLED');

  return {
    text_generation: textGeneration,
    qwen_generation: { ready: qwenReady, reason: qwenReady ? undefined : 'dashscope_key_missing' },
    tts: { ready: ttsReady, reason: ttsReady ? undefined : 'no_tts_provider_configured' },
    video_generation: { ready: videoReady, reason: videoReady ? undefined : 'video_provider_disabled_or_unconfigured' },
    digital_human: { ready: digitalHumanReady, reason: digitalHumanReady ? undefined : 'digital_human_provider_disabled_or_unconfigured' },
    starter_workers: { ready: starterWorkersReady, reason: starterWorkersReady ? undefined : background ? 'starter_workers_not_explicitly_enabled' : 'background_jobs_not_running_in_this_role' },
    scheduled_publishing: { ready: background && enabled('PUBLISH_SCHEDULER_ENABLED'), reason: background && enabled('PUBLISH_SCHEDULER_ENABLED') ? undefined : 'publishing_worker_not_enabled' },
    quote: { ready: process.env.NODE_ENV !== 'production' || enabled('QUOTE_SKILL_ENABLED'), reason: process.env.NODE_ENV !== 'production' || enabled('QUOTE_SKILL_ENABLED') ? undefined : 'quote_skill_not_enabled' },
    platform_ads: { ready: present('TENANT_PLATFORM_APP_KEY'), reason: present('TENANT_PLATFORM_APP_KEY') ? undefined : 'tenant_platform_encryption_key_missing' },
  };
}

export function requiredCapabilityIssues(capabilities: Record<RuntimeCapability, CapabilityState>): string[] {
  const required = String(process.env.REQUIRED_CAPABILITIES || '')
    .split(/[\s,;]+/)
    .map(value => value.trim())
    .filter(Boolean);
  const known = new Set<string>(KNOWN_CAPABILITIES);
  const issues: string[] = [];
  for (const name of required) {
    if (!known.has(name)) {
      issues.push(`unknown_required_capability:${name}`);
      continue;
    }
    const state = capabilities[name as RuntimeCapability];
    if (!state.ready) issues.push(`capability_unavailable:${name}:${state.reason || 'not_ready'}`);
  }
  return issues;
}

export async function runtimeReadiness(input: {
  role: ProcessRole;
  startupIssues?: string[];
  checkPocketBase?: () => Promise<void>;
}) {
  const capabilities = runtimeCapabilities(input.role);
  const issues = [...(input.startupIssues || []), ...requiredCapabilityIssues(capabilities)];
  try {
    if (input.checkPocketBase) {
      await input.checkPocketBase();
    } else {
      const health = await fetch(`${getPbUrl()}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (!health.ok) throw new Error(`health_${health.status}`);
      // This collection is the product entitlement authority and proves the
      // starter migration set has reached the connected database.
      await pbListStrict('starter_198_access', { page: 1, perPage: 1 });
    }
  } catch (error) {
    issues.push(`pocketbase_unavailable_or_unmigrated:${error instanceof Error ? error.message : 'unknown'}`);
  }
  return {
    status: issues.length ? 'degraded' as const : 'ready' as const,
    role: input.role,
    capabilities,
    issues,
  };
}

export function readinessCacheTtlMs(): number {
  const configured = Number(process.env.READINESS_CACHE_TTL_MS ?? 2_000);
  return Number.isFinite(configured)
    ? Math.min(Math.max(Math.floor(configured), 250), 10_000)
    : 2_000;
}

/**
 * Keep load balancer probes from multiplying PocketBase reads. The result is
 * cached only briefly and concurrent misses share one dependency check.
 */
export function createRuntimeReadinessProbe(input: {
  role: ProcessRole;
  startupIssues?: string[];
  checkPocketBase?: () => Promise<void>;
  now?: () => number;
}) {
  type Report = Awaited<ReturnType<typeof runtimeReadiness>>;
  const now = input.now ?? Date.now;
  let cached: { report: Report; expiresAt: number } | null = null;
  let inFlight: Promise<Report> | null = null;
  return async (): Promise<Report> => {
    const timestamp = now();
    if (cached && cached.expiresAt > timestamp) return cached.report;
    if (inFlight) return inFlight;
    const request = runtimeReadiness(input);
    inFlight = request;
    try {
      const report = await request;
      cached = { report, expiresAt: now() + readinessCacheTtlMs() };
      return report;
    } finally {
      if (inFlight === request) inFlight = null;
    }
  };
}
