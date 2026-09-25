import { FirstFrameProviderError, validateFirstFrameRequest, type FirstFrameGenerator, type FirstFrameRequest, type FirstFrameResult } from './firstFrameGenerator.js';

type SeedreamPayload = { data?: Array<{ b64_json?: string; url?: string }>; model?: string; error?: { message?: string }; message?: string };

function dataUrl(reference: FirstFrameRequest['references'][number]): string {
  return `data:${reference.mimeType};base64,${reference.bytes.toString('base64')}`;
}

function seedreamSize(ratio: FirstFrameRequest['ratio']): string {
  if (ratio === '9:16') return '1440x2560';
  if (ratio === '16:9') return '2560x1440';
  return '2048x2048';
}

function mimeFromResponse(contentType: string | null): FirstFrameResult['mimeType'] {
  if (/webp/i.test(contentType || '')) return 'image/webp';
  if (/jpe?g/i.test(contentType || '')) return 'image/jpeg';
  return 'image/png';
}

export class SeedreamFirstFrameGenerator implements FirstFrameGenerator {
  readonly provider = 'seedream' as const;
  readonly model: string;
  readonly estimatedCostCny: number;
  constructor(private readonly options: { apiKey?: string; baseUrl?: string; model?: string; estimatedCostCny?: number; transport?: typeof fetch } = {}) {
    this.model = options.model || process.env.SEEDREAM_IMAGE_MODEL || 'doubao-seedream-5-0-pro-260628';
    this.estimatedCostCny = options.estimatedCostCny ?? Number(process.env.SEEDREAM_FIRST_FRAME_ESTIMATED_CNY || 0.22);
  }

  async generate(input: FirstFrameRequest): Promise<FirstFrameResult> {
    validateFirstFrameRequest(input);
    const apiKey = String(this.options.apiKey || process.env.SEEDREAM_API_KEY || process.env.SEEDANCE_API_KEY || '').trim();
    if (!apiKey) throw new FirstFrameProviderError('Seedream 未配置方舟 API Key', 'rejected');
    if (!Number.isFinite(this.estimatedCostCny) || this.estimatedCostCny <= 0) throw new FirstFrameProviderError('Seedream 首帧预计费用配置无效', 'rejected');
    const base = String(this.options.baseUrl || process.env.SEEDREAM_BASE_URL || process.env.SEEDANCE_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
    const fetcher = this.options.transport || fetch;
    let response: Response;
    try {
      response = await fetcher(`${base}/images/generations`, { method: 'POST', headers: {
        Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': input.idempotencyKey,
      }, body: JSON.stringify({ model: this.model, prompt: input.prompt.trim(), image: input.references.map(dataUrl), size: seedreamSize(input.ratio),
        sequential_image_generation: 'disabled', response_format: 'b64_json', output_format: 'jpeg', watermark: false }), signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      throw new FirstFrameProviderError(`Seedream 请求状态未知：${error instanceof Error ? error.message : 'network_error'}`, 'uncertain', input.idempotencyKey);
    }
    const requestId = response.headers.get('x-request-id') || response.headers.get('x-tt-logid') || input.idempotencyKey;
    const payload = await response.json().catch(() => ({})) as SeedreamPayload;
    if (!response.ok) throw new FirstFrameProviderError(`Seedream ${response.status}: ${String(payload.error?.message || payload.message || response.statusText).slice(0, 300)}`, 'rejected', requestId);
    const item = payload.data?.[0];
    let bytes: Buffer; let mimeType: FirstFrameResult['mimeType'] = 'image/jpeg';
    if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
    else if (/^https:\/\//i.test(String(item?.url || ''))) {
      let download: Response;
      try { download = await fetcher(String(item!.url), { signal: AbortSignal.timeout(90_000) }); }
      catch (error) { throw new FirstFrameProviderError(`Seedream 已生成但产物下载状态未知：${error instanceof Error ? error.message : 'network_error'}`, 'uncertain', requestId); }
      if (!download.ok) throw new FirstFrameProviderError(`Seedream 已生成但产物下载失败：HTTP ${download.status}`, 'uncertain', requestId);
      mimeType = mimeFromResponse(download.headers.get('content-type')); bytes = Buffer.from(await download.arrayBuffer());
    } else throw new FirstFrameProviderError('Seedream 返回成功但缺少图片产物', 'uncertain', requestId);
    if (!bytes.length) throw new FirstFrameProviderError('Seedream 返回空图片', 'uncertain', requestId);
    return { bytes, mimeType, provider: this.provider, model: payload.model || this.model, providerRequestId: requestId, estimatedCostCny: this.estimatedCostCny };
  }
}
