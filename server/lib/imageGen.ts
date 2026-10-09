import { createHash } from 'node:crypto';
import {
  currentContentProviderReceipt,
  recordCurrentContentProviderReceipt,
} from '../contentExecution/context.js';

export interface ReferenceImage {
  mimeType: string;
  base64: string;
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
  source: 'qwen';
  model: string;
}

/** A definitive client-side provider rejection: no image task was accepted. */
export class ImageProviderRejectedError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}

function normalizeMime(mimeType?: string): string {
  if (!mimeType) return 'image/png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'image/jpeg';
  if (mimeType.includes('webp')) return 'image/webp';
  return 'image/png';
}

function extFromMime(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}

export function imageExt(mimeType: string): string {
  return extFromMime(mimeType);
}

function qwenImageEndpoint(): string {
  const configured = String(process.env.DASHSCOPE_IMAGE_BASE_URL || process.env.DASHSCOPE_BASE_URL || '').trim();
  const base = (configured || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
  if (!/\/compatible-mode\/v1$/i.test(base)) throw new Error('DASHSCOPE_IMAGE_BASE_URL 必须是百炼 OpenAI 兼容端点（…/compatible-mode/v1）');
  return `${base}/images/generations`;
}

function qwenSizeFor(ratio: string): string {
  const normalized = String(ratio || '').trim();
  if (normalized === '9:16' || normalized === '720:1280') return '1024*1792';
  if (normalized === '16:9' || normalized === '1280:720') return '1792*1024';
  return '1024*1024';
}

function qwenImageUrl(payload: any): string {
  const item = Array.isArray(payload?.data) ? payload.data[0] : undefined;
  const url = String(item?.url || payload?.output?.choices?.[0]?.message?.content?.[0]?.image || '').trim();
  if (!/^https:\/\//i.test(url)) throw new Error('Qwen Image 返回结果缺少 HTTPS 图片地址');
  return url;
}

async function generateQwenImage(input: {
  prompt: string;
  ratio: string;
  references?: ReferenceImage[];
  idempotencyKey?: string;
  recoveryOnly?: boolean;
}): Promise<GeneratedImage> {
  const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY is not configured');
  const model = (process.env.QWEN_IMAGE_MODEL || 'qwen-image-3.0').trim();
  const requestId = createHash('sha256').update(input.idempotencyKey ? JSON.stringify({operationKey:input.idempotencyKey,model,ratio:input.ratio,prompt:input.prompt,references:(input.references||[]).slice(0,3).map(ref=>({mimeType:normalizeMime(ref.mimeType),sha256:createHash('sha256').update(Buffer.from(ref.base64,'base64')).digest('hex')}))}) : `${model}\0${input.ratio}\0${input.prompt}`).digest('hex');
  const prior = currentContentProviderReceipt({ provider: 'qwen_image', requestId });
  if (prior && ['submitting', 'unknown'].includes(prior.state)) {
    throw new Error('provider_submission_unknown:qwen_image:requires_manual_reconciliation');
  }
  if(prior&&['accepted','completed'].includes(prior.state)&&!/^https:\/\//i.test(String(prior.metadata.outputUrl||'')))throw new Error('provider_submission_unknown:qwen_image:accepted_output_reference_missing');
  // Qwen Image accepts at most three ordered reference images.
  const refs = (input.references || []).slice(0, 3);
  let url = String(prior?.metadata.outputUrl || '');
  if (!/^https:\/\//i.test(url)) {
    if(input.recoveryOnly)throw new Error('provider_submission_unknown:qwen_image:recovery_requires_existing_output');
    await recordCurrentContentProviderReceipt({
      provider: 'qwen_image', requestId, state: 'submitting', metadata: { model },
    });
    let response: Response;
    try {
      response = await fetch(qwenImageEndpoint(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: input.prompt, ...(refs.length ? { image: refs.map(ref => `data:${normalizeMime(ref.mimeType)};base64,${ref.base64}`) } : {}), n: 1, size: qwenSizeFor(input.ratio) }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      await recordCurrentContentProviderReceipt({ provider: 'qwen_image', requestId, state: 'unknown', metadata: { model } });
      throw new Error('provider_submission_unknown:qwen_image:transport_outcome_uncertain');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const definitive=[400,401,403,404,422].includes(response.status);
      await recordCurrentContentProviderReceipt({ provider: 'qwen_image', requestId, state: definitive?'failed':'unknown', metadata: { model, statusCode: response.status } });
      const message = `Qwen Image ${response.status}: ${String(payload?.message || payload?.error?.message || response.statusText).slice(0, 500)}`;
      if ([400, 401, 403, 404, 422].includes(response.status)) throw new ImageProviderRejectedError(response.status, message);
      throw new Error('provider_submission_unknown:qwen_image:response_outcome_uncertain');
    }
    try{url=qwenImageUrl(payload);}catch{await recordCurrentContentProviderReceipt({provider:'qwen_image',requestId,state:'unknown',metadata:{model}});throw new Error('provider_submission_unknown:qwen_image:output_reference_missing');}
    await recordCurrentContentProviderReceipt({
      provider: 'qwen_image', requestId, state: 'accepted', metadata: { model, outputUrl: url },
    });
  }
  const image = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!image.ok) throw new Error(`Qwen Image 产物下载失败：HTTP ${image.status}`);
  const result = { bytes: Buffer.from(await image.arrayBuffer()), mimeType: normalizeMime(image.headers.get('content-type') || 'image/png'), source: 'qwen' as const, model };
  await recordCurrentContentProviderReceipt({
    provider: 'qwen_image', requestId, state: 'completed', metadata: { model, outputUrl: url, mimeType: result.mimeType },
  });
  return result;
}

export async function generatePosterImage(input: {
  prompt: string;
  ratio: string;
  references?: ReferenceImage[];
  idempotencyKey?: string;
  recoveryOnly?: boolean;
}): Promise<GeneratedImage> {
  // Provider choice is explicit at the product route. A failed paid request must
  // never fan out to another supplier and create an unreviewed second charge.
  return generateQwenImage(input);
}
