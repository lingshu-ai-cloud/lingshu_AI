export type DigitalHumanProviderId = 'heygen' | 'local-worker' | 'local-direct';
export type DigitalHumanProviderEngine = 'avatar_v' | 'avatar_iv' | 'local';

export interface DigitalHumanProviderBinding {
  heygen?: {
    avatarId: string;
    voiceId: string;
    supportedEngines?: Array<'avatar_v' | 'avatar_iv'>;
  };
  local?: { assetId?: string };
}

export interface DigitalHumanProviderSelection {
  provider: DigitalHumanProviderId;
  engine: DigitalHumanProviderEngine;
  externalAvatarId?: string;
  externalVoiceId?: string;
  estimatedCostCredits?: number;
  routingReason: string;
}

export class DigitalHumanProviderConfigurationError extends Error {
  constructor(readonly code: string, message: string, readonly missing: string[] = []) {
    super(message);
    this.name = 'DigitalHumanProviderConfigurationError';
  }
}

export function parseDigitalHumanProviderBinding(value: unknown): DigitalHumanProviderBinding {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const heygenRaw = record.heygen && typeof record.heygen === 'object' && !Array.isArray(record.heygen)
    ? record.heygen as Record<string, unknown> : undefined;
  const localRaw = record.local && typeof record.local === 'object' && !Array.isArray(record.local)
    ? record.local as Record<string, unknown> : undefined;
  const supported = Array.isArray(heygenRaw?.supportedEngines)
    ? heygenRaw.supportedEngines.map(String).filter((item): item is 'avatar_v' | 'avatar_iv' => item === 'avatar_v' || item === 'avatar_iv')
    : undefined;
  return {
    ...(heygenRaw ? { heygen: {
      avatarId: String(heygenRaw.avatarId || '').trim(),
      voiceId: String(heygenRaw.voiceId || '').trim(),
      ...(supported?.length ? { supportedEngines: [...new Set(supported)] } : {}),
    } } : {}),
    ...(localRaw ? { local: { assetId: String(localRaw.assetId || '').trim() || undefined } } : {}),
  };
}

export function selectDigitalHumanProvider(input: {
  mode: 'fast' | 'quality';
  binding?: DigitalHumanProviderBinding;
  heygenApiKey?: string;
  localPullWorkerReady: boolean;
  localDirectConfigured: boolean;
  durationSeconds?: number;
}): DigitalHumanProviderSelection {
  if (input.mode === 'quality') {
    const heygen = input.binding?.heygen;
    const missing: string[] = [];
    if (!String(input.heygenApiKey || '').trim()) missing.push('HEYGEN_API_KEY');
    if (!heygen?.avatarId) missing.push('人物 providerBindings.heygen.avatarId');
    if (!heygen?.voiceId) missing.push('人物 providerBindings.heygen.voiceId');
    if (missing.length) {
      throw new DigitalHumanProviderConfigurationError(
        'HEYGEN_NOT_CONFIGURED',
        `高质量数字人需要配置 HeyGen，缺少：${missing.join('、')}。任务未降级到本地引擎。`,
        missing,
      );
    }
    const supported = heygen!.supportedEngines || [];
    const engine: 'avatar_v' | 'avatar_iv' = supported.includes('avatar_v') ? 'avatar_v' : 'avatar_iv';
    return {
      provider: 'heygen', engine,
      externalAvatarId: heygen!.avatarId,
      externalVoiceId: heygen!.voiceId,
      estimatedCostCredits: Math.max(0, Number(input.durationSeconds || 0)) * 0.1,
      routingReason: engine === 'avatar_v' ? 'quality_mode_avatar_v_supported' : 'quality_mode_avatar_v_unavailable_use_avatar_iv',
    };
  }
  if (input.localPullWorkerReady) return { provider: 'local-worker', engine: 'local', routingReason: 'fast_mode_local_pull_worker' };
  if (input.localDirectConfigured) return { provider: 'local-direct', engine: 'local', routingReason: 'fast_mode_local_direct' };
  throw new DigitalHumanProviderConfigurationError(
    'LOCAL_PROVIDER_NOT_CONFIGURED',
    '极速数字人需要可用的本地 GPU Worker 或本地直连服务。',
    ['DIGITAL_HUMAN_PULL_WORKER_ENABLED/Worker', 'DIGITAL_HUMAN_API_URL'],
  );
}

export interface DigitalHumanProviderSubmitInput {
  externalJobId: string;
  script: string;
  language: string;
  title?: string;
  selection: DigitalHumanProviderSelection;
  localPayload?: unknown;
}

export interface DigitalHumanProviderTask {
  id: string;
  status: 'pending' | 'processing' | 'quality_check' | 'completed' | 'failed' | 'cancelled';
  stage?: string;
  progress?: number;
  outputUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  raw?: unknown;
}

export interface DigitalHumanProvider {
  readonly id: DigitalHumanProviderId;
  submit(input: DigitalHumanProviderSubmitInput): Promise<DigitalHumanProviderTask>;
  get(taskId: string): Promise<DigitalHumanProviderTask>;
  cancel(taskId: string): Promise<void>;
}

type FetchLike = typeof fetch;

async function jsonResponse(response: Response): Promise<Record<string, any>> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.error?.message || payload?.message || payload?.error || `Provider HTTP ${response.status}`));
  return payload && typeof payload === 'object' ? payload as Record<string, any> : {};
}

export class HeyGenV3Provider implements DigitalHumanProvider {
  readonly id = 'heygen' as const;
  constructor(
    private readonly config: { apiKey: string; baseUrl?: string; timeoutMs?: number },
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!config.apiKey.trim()) throw new DigitalHumanProviderConfigurationError('HEYGEN_API_KEY_MISSING', 'HEYGEN_API_KEY 未配置', ['HEYGEN_API_KEY']);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, any>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(10_000, this.config.timeoutMs || 30_000));
    try {
      const response = await this.fetchImpl(`${(this.config.baseUrl || 'https://api.heygen.com').replace(/\/+$/, '')}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': this.config.apiKey, ...(init.headers || {}) },
      });
      return await jsonResponse(response);
    } finally { clearTimeout(timer); }
  }

  async submit(input: DigitalHumanProviderSubmitInput): Promise<DigitalHumanProviderTask> {
    const { selection } = input;
    if (!selection.externalAvatarId || !selection.externalVoiceId) throw new Error('HeyGen avatar_id/voice_id 未绑定');
    // Validate the binding against the v3 Looks catalogue before spending
    // credits. Legacy v2 avatar ids may look valid but cannot render on v3.
    const lookPayload = await this.request(`/v3/avatars/looks/${encodeURIComponent(selection.externalAvatarId)}`);
    const look = lookPayload.data || {};
    const supported = Array.isArray(look.supported_api_engines) ? look.supported_api_engines.map(String) : [];
    const requestedEngine = selection.engine === 'avatar_v' ? 'avatar_v' : 'avatar_iv';
    const engine = supported.includes(requestedEngine)
      ? requestedEngine
      : supported.includes('avatar_v') ? 'avatar_v'
        : supported.includes('avatar_iv') ? 'avatar_iv' : undefined;
    if (!engine) throw new DigitalHumanProviderConfigurationError(
      'HEYGEN_AVATAR_ENGINE_UNSUPPORTED',
      '人物绑定不是可用于 HeyGen v3 的 Avatar Look，或未开放 Avatar IV/V。',
      ['providerBindings.heygen.avatarId(v3 look id)'],
    );
    const payload = await this.request('/v3/videos', { method: 'POST', body: JSON.stringify({
      type: 'avatar', avatar_id: selection.externalAvatarId, voice_id: selection.externalVoiceId,
      script: input.script, title: input.title || `Lingshu ${input.externalJobId}`,
      resolution: '1080p', aspect_ratio: '9:16', output_format: 'mp4',
      engine: { type: engine },
    }) });
    const id = String(payload.data?.video_id || '').trim();
    if (!id) throw new Error('HeyGen 创建响应缺少 data.video_id');
    return { id, status: 'pending', stage: 'heygen_queued', progress: 1, raw: payload };
  }

  async get(taskId: string): Promise<DigitalHumanProviderTask> {
    const payload = await this.request(`/v3/videos/${encodeURIComponent(taskId)}`);
    const data = payload.data || {};
    const status = String(data.status || 'processing');
    if (status === 'completed') return { id: taskId, status: 'completed', stage: 'heygen_completed', progress: 95, outputUrl: String(data.video_url || ''), raw: payload };
    if (status === 'failed') return { id: taskId, status: 'failed', stage: 'heygen_failed', errorCode: String(data.failure_code || 'HEYGEN_FAILED'), errorMessage: String(data.failure_message || 'HeyGen 生成失败'), raw: payload };
    return { id: taskId, status: status === 'pending' ? 'pending' : 'processing', stage: `heygen_${status}`, progress: status === 'pending' ? 3 : 35, raw: payload };
  }

  async cancel(taskId: string): Promise<void> {
    // v3 currently documents create/poll and webhook flows but no portable
    // cancellation endpoint. Mark the Lingshu job cancelled and ignore late output.
    void taskId;
  }
}

export class LocalDirectProvider implements DigitalHumanProvider {
  readonly id = 'local-direct' as const;
  constructor(
    private readonly config: { baseUrl: string; apiKey?: string; timeoutMs?: number },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private headers() { return { 'content-type': 'application/json', ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}) }; }
  private async request(path: string, init: RequestInit = {}) {
    const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, '')}${path}`, { ...init, headers: { ...this.headers(), ...(init.headers || {}) } });
    return jsonResponse(response);
  }
  async submit(input: DigitalHumanProviderSubmitInput): Promise<DigitalHumanProviderTask> {
    const payload = await this.request('/v1/jobs', { method: 'POST', body: JSON.stringify(input.localPayload) });
    const id = String(payload.id || '').trim();
    if (!id) throw new Error('本地 Provider 创建响应缺少 id');
    return { id, status: 'processing', stage: String(payload.stage || 'inference'), progress: Number(payload.progress || 5), raw: payload };
  }
  async get(taskId: string): Promise<DigitalHumanProviderTask> {
    const payload = await this.request(`/v1/jobs/${encodeURIComponent(taskId)}`);
    return { id: taskId, status: String(payload.status || 'processing') as DigitalHumanProviderTask['status'], stage: String(payload.stage || 'inference'), progress: Number(payload.progress || 5), outputUrl: String(payload.outputUrl || ''), errorCode: String(payload.errorCode || ''), errorMessage: String(payload.error || ''), raw: payload };
  }
  async cancel(taskId: string): Promise<void> { await this.request(`/v1/jobs/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }); }
}
