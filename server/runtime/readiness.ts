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
  const digitalHumanReady = (enabled('HEYGEN_GENERATION_ENABLED') && present('HEYGEN_API_KEY'))
    || (present('DIGITAL_HUMAN_API_URL') && present('DIGITAL_HUMAN_API_KEY'));
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
