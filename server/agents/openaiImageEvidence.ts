import { createHash } from 'node:crypto';
import type { SocialPaidOperationIntent } from '../lib/socialContentTaskBudgetAuthority.js';
import type { PaidOperationSubmission } from '../lib/socialContentPaidOperationPermit.js';
import { normalizeImageLayerBlueprints, type ImagePostEvidenceAnalysis } from './qwenContracts.js';

/** The caller must obtain this from a durable, approved and reserved task plan. */
export interface OpenAiImageEvidencePaidCall {
  intent: SocialPaidOperationIntent;
  permit: {
    beforeSubmit(request: PaidOperationSubmission): Promise<unknown>;
    markOutcome(operationId: string, status: 'accepted' | 'unknown' | 'completed', receiptRef: string): Promise<unknown>;
  };
  /** Trusted model-aware upper bound for this exact multimodal request. */
  measureInputTokens(body: Record<string, unknown>): Promise<number>;
  /** Durable receipt must be readable for recovery before marking completed. */
  persistProviderReceipt(input: { requestSha256: string; response: unknown }): Promise<string>;
}

export interface OpenAiImageEvidenceOptions {
  images: Array<{ base64: string; mimeType: string; imageIndex: number }>;
  title?: string;
  caption?: string;
  platform?: string;
  tags?: string[];
  primary?: ImagePostEvidenceAnalysis;
  reviewReasons: string[];
  paidCall: OpenAiImageEvidencePaidCall;
  fetcher?: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
}

export type OpenAiImageEvidenceInput = Omit<OpenAiImageEvidenceOptions, 'paidCall' | 'fetcher' | 'apiKey' | 'baseUrl'>;

function parseResult(payload: unknown, imageCount: number): ImagePostEvidenceAnalysis {
  const row = payload && typeof payload === 'object' ? payload as { choices?: Array<{ message?: { content?: string } }> } : {};
  const content = row.choices?.[0]?.message?.content;
  if (!content) throw Error('openai_image_evidence_content_missing');
  let parsed: Partial<ImagePostEvidenceAnalysis>;
  try { parsed = JSON.parse(content) as Partial<ImagePostEvidenceAnalysis>; }
  catch { throw Error('openai_image_evidence_json_invalid'); }
  if (!Array.isArray(parsed.observedFacts) || !parsed.observedFacts.length) throw Error('openai_image_evidence_facts_missing');
  return {
    version: 2, status: 'analyzed', observedFacts: parsed.observedFacts.slice(0, imageCount),
    carouselFlow: Array.isArray(parsed.carouselFlow) ? parsed.carouselFlow.slice(0, imageCount) : [],
    copyEvidence: {
      hooks: Array.isArray(parsed.copyEvidence?.hooks) ? parsed.copyEvidence.hooks.slice(0, 8) : [],
      sellingPoints: Array.isArray(parsed.copyEvidence?.sellingPoints) ? parsed.copyEvidence.sellingPoints.slice(0, 12) : [],
      cta: Array.isArray(parsed.copyEvidence?.cta) ? parsed.copyEvidence.cta.slice(0, 6) : [],
    },
    reusableModules: Array.isArray(parsed.reusableModules) ? parsed.reusableModules.slice(0, 12) : [],
    layerBlueprints: normalizeImageLayerBlueprints(parsed.layerBlueprints, imageCount),
    uncertainties: Array.isArray(parsed.uncertainties) ? parsed.uncertainties.map(String).slice(0, 12) : [],
  };
}

/** Use the exact frozen body/hash when constructing the approved budget plan. */
export function buildOpenAiImageEvidenceRequest(opts: OpenAiImageEvidenceInput, model: string) {
  if (!opts.images.length || opts.images.length > 12) throw Error('openai_image_evidence_image_count_invalid');
  if (!model.trim()) throw Error('openai_image_evidence_model_missing');
  const instruction = `Review social marketing images against the primary vision draft. Return corrected JSON only. Ground fields in visible pixels or supplied caption. Do not infer popularity, efficacy, certifications, price, MOQ, audience or business facts. Focus on mask contour, opacity and back-to-front layer order. Coordinates are normalized 0..1; zIndex increases toward the viewer. Required JSON keys: version, status, observedFacts, carouselFlow, copyEvidence, reusableModules, layerBlueprints, uncertainties.`;
  const metadata = JSON.stringify({ title: opts.title || '', caption: opts.caption || '', platform: opts.platform || '', tags: opts.tags || [], reviewReasons: opts.reviewReasons, primaryDraft: opts.primary || null }).slice(0, 45_000);
  const content = [
    { type: 'text', text: `Untrusted metadata and primary draft:\n${metadata}` },
    ...[...opts.images].sort((a, b) => a.imageIndex - b.imageIndex).map(image => ({
      type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64.replace(/^data:[^,]+,/, '')}`, detail: 'high' },
    })),
  ];
  const body: Record<string, unknown> = { model, messages: [{ role: 'system', content: instruction }, { role: 'user', content }], response_format: { type: 'json_object' }, max_tokens: 7000 };
  const requestSha256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { body, requestSha256 };
}

/** No route calls this yet: a record-scoped approval/reservation must be wired first. */
export async function reviewImagePostEvidenceWithOpenAI(opts: OpenAiImageEvidenceOptions): Promise<ImagePostEvidenceAnalysis> {
  const apiKey = String(opts.apiKey ?? process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) throw Error('openai_image_evidence_key_missing');
  const baseUrl = String(opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl)) throw Error('openai_image_evidence_endpoint_untrusted');
  const { intent } = opts.paidCall;
  if (intent.provider !== 'openai' || intent.stage !== 'image_post_evidence_review') throw Error('openai_image_evidence_intent_invalid');
  const { body, requestSha256 } = buildOpenAiImageEvidenceRequest(opts, intent.model);
  if (intent.inputContractHash !== requestSha256) throw Error('openai_image_evidence_request_binding_invalid');
  const inputTokens = await opts.paidCall.measureInputTokens(structuredClone(body));
  if (!Number.isSafeInteger(inputTokens) || inputTokens <= 0) throw Error('openai_image_evidence_input_tokens_missing');
  const actualUnits: Record<string, number> = { inputTokens, outputTokens: 7000 };
  if ('requests' in intent.maximumUnits) actualUnits.requests = 1;
  if (JSON.stringify(Object.keys(actualUnits).sort()) !== JSON.stringify(Object.keys(intent.maximumUnits).sort())) throw Error('openai_image_evidence_usage_dimensions_invalid');
  const { maximumUnits: _, ...binding } = intent;
  await opts.paidCall.permit.beforeSubmit({ ...binding, actualUnits });
  // From this point the claim is durably unknown. Failures must never retry this operation.
  const response = await (opts.fetcher || fetch)(`${baseUrl}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(60_000),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const responseText = await response.text();
  const receiptRef = await opts.paidCall.persistProviderReceipt({ requestSha256, response: { status: response.status, body: responseText } });
  if (!receiptRef) throw Error('openai_image_evidence_receipt_missing');
  if (!response.ok) {
    await opts.paidCall.permit.markOutcome(intent.operationId, 'unknown', receiptRef);
    throw Error(`openai_image_evidence_http_${response.status}`);
  }
  await opts.paidCall.permit.markOutcome(intent.operationId, 'completed', receiptRef);
  let payload: unknown;
  try { payload = JSON.parse(responseText); }
  catch { throw Error('openai_image_evidence_response_json_invalid'); }
  return parseResult(payload, opts.images.length);
}
