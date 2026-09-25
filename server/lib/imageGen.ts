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
}): Promise<GeneratedImage> {
  const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY is not configured');
  const model = (process.env.QWEN_IMAGE_MODEL || 'qwen-image-3.0').trim();
  // Qwen Image accepts at most three ordered reference images.
  const refs = (input.references || []).slice(0, 3);
  const response = await fetch(qwenImageEndpoint(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: input.prompt, ...(refs.length ? { image: refs.map(ref => `data:${normalizeMime(ref.mimeType)};base64,${ref.base64}`) } : {}), n: 1, size: qwenSizeFor(input.ratio) }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Qwen Image ${response.status}: ${String(payload?.message || payload?.error?.message || response.statusText).slice(0, 500)}`);
  const url = qwenImageUrl(payload);
  const image = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!image.ok) throw new Error(`Qwen Image 产物下载失败：HTTP ${image.status}`);
  return { bytes: Buffer.from(await image.arrayBuffer()), mimeType: normalizeMime(image.headers.get('content-type') || 'image/png'), source: 'qwen', model };
}

export async function generatePosterImage(input: {
  prompt: string;
  ratio: string;
  references?: ReferenceImage[];
}): Promise<GeneratedImage> {
  // Provider choice is explicit at the product route. A failed paid request must
  // never fan out to another supplier and create an unreviewed second charge.
  return generateQwenImage(input);
}
