import { normalizeImageLayerBlueprints, type ImagePostEvidenceAnalysis } from './qwenContracts.js';

export const OPENAI_IMAGE_EVIDENCE_MODEL = () => String(
  process.env.SOCIAL_IMAGE_ANALYSIS_REVIEW_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini',
).trim();

function endpoint(): string {
  const base = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base)) throw new Error('OPENAI_BASE_URL is not trusted');
  return `${base}/chat/completions`;
}

function parseJson(raw: unknown): Partial<ImagePostEvidenceAnalysis> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new Error('OpenAI image evidence review returned no content');
  try { return JSON.parse(text) as Partial<ImagePostEvidenceAnalysis>; }
  catch { throw new Error('OpenAI image evidence review returned invalid JSON'); }
}

export async function reviewImagePostEvidenceWithOpenAI(opts: {
  images: Array<{ base64: string; mimeType: string; imageIndex: number }>;
  title?: string;
  caption?: string;
  platform?: string;
  tags?: string[];
  primary?: ImagePostEvidenceAnalysis;
  reviewReasons: string[];
  fetcher?: typeof fetch;
}): Promise<ImagePostEvidenceAnalysis> {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured for image evidence review');
  if (!opts.images.length) throw new Error('OpenAI image evidence review requires at least one image');
  const model = OPENAI_IMAGE_EVIDENCE_MODEL();
  const instruction = `You review a low-cost vision model's analysis of social marketing images. Return corrected JSON only. Ground every field in visible pixels or supplied caption. Do not infer popularity, efficacy, certifications, price, MOQ, audience, or business facts. Focus on mask contour/opacity and back-to-front layer order. Coordinates must be normalized 0..1; zIndex increases toward the viewer. Omit masks that cannot be seen reliably.
Required schema: {"version":2,"status":"analyzed","observedFacts":[{"imageIndex":1,"subjects":[],"scene":"","composition":"","colors":[],"visibleText":[],"confidence":0}],"carouselFlow":[{"imageIndex":1,"role":"attention|product|detail|proof|process|cta|unknown","evidence":"","confidence":0}],"copyEvidence":{"hooks":[],"sellingPoints":[],"cta":[]},"reusableModules":[],"layerBlueprints":[{"imageIndex":1,"layers":[{"id":"background","role":"background|mask|product|text|logo|decoration","zIndex":0,"bounds":{"x":0,"y":0,"width":1,"height":1},"confidence":0}],"masks":[{"id":"mask-1","shape":"rectangle|rounded_rectangle|ellipse|polygon|linear_gradient","bounds":{"x":0,"y":0,"width":1,"height":1},"opacity":0,"color":"#000000","cornerRadius":0,"feather":0,"angle":0,"points":[],"zIndex":1,"confidence":0}]}],"uncertainties":[]}`;
  const metadata = JSON.stringify({ title: opts.title || '', caption: opts.caption || '', platform: opts.platform || '', tags: opts.tags || [], reviewReasons: opts.reviewReasons, primaryDraft: opts.primary || null }).slice(0, 45_000);
  const content = [
    { type: 'text', text: `Untrusted source metadata and primary draft:\n${metadata}` },
    ...[...opts.images].sort((a, b) => a.imageIndex - b.imageIndex).map(image => ({
      type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64.replace(/^data:[^,]+,/, '')}`, detail: 'high' },
    })),
  ];
  const response = await (opts.fetcher || fetch)(endpoint(), {
    method: 'POST', signal: AbortSignal.timeout(60_000),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: instruction }, { role: 'user', content }], response_format: { type: 'json_object' }, max_tokens: 7000 }),
  });
  if (!response.ok) throw new Error(`OpenAI image evidence review rejected: HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const parsed = parseJson(payload.choices?.[0]?.message?.content);
  if (!Array.isArray(parsed.observedFacts) || !parsed.observedFacts.length) throw new Error('OpenAI image evidence review returned no image facts');
  return {
    version: 2, status: 'analyzed', observedFacts: parsed.observedFacts.slice(0, opts.images.length),
    carouselFlow: Array.isArray(parsed.carouselFlow) ? parsed.carouselFlow.slice(0, opts.images.length) : [],
    copyEvidence: { hooks: Array.isArray(parsed.copyEvidence?.hooks) ? parsed.copyEvidence.hooks.slice(0, 8) : [], sellingPoints: Array.isArray(parsed.copyEvidence?.sellingPoints) ? parsed.copyEvidence.sellingPoints.slice(0, 12) : [], cta: Array.isArray(parsed.copyEvidence?.cta) ? parsed.copyEvidence.cta.slice(0, 6) : [] },
    reusableModules: Array.isArray(parsed.reusableModules) ? parsed.reusableModules.slice(0, 12) : [],
    layerBlueprints: normalizeImageLayerBlueprints(parsed.layerBlueprints, opts.images.length),
    uncertainties: Array.isArray(parsed.uncertainties) ? parsed.uncertainties.map(String).slice(0, 12) : [],
  };
}
