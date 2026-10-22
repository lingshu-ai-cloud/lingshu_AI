import type { DataStore, Record_ } from '../storage/datastore.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { quoteSocialPaidOperationTariff, type SocialPaidOperationIntent, type SocialVerifiedAccountTariff } from '../lib/socialContentTaskBudgetAuthority.js';
import { buildOpenAiImageEvidenceRequest, type OpenAiImageEvidenceInput } from '../agents/openaiImageEvidence.js';
import { imageEvidenceReviewReasons, type ImagePostEvidenceAnalysis } from '../agents/qwenContracts.js';
import { imagePostSourceHash } from './imagePostReanalysis.js';
import { approveImageEvidenceReview, imageEvidenceReviewApprovalId } from './imageEvidenceReviewApproval.js';

type ReviewImage = OpenAiImageEvidenceInput['images'][number];
type TrustedPreparationPorts = {
  /** Returns a verified account identity; never read these fields from an HTTP body. */
  readProviderBinding(): Promise<{ model: string; accountRef: string }>;
  /** Reads exactly the source URLs supplied by the server-owned record. */
  readSourceImages(record: Record_, urls: string[]): Promise<ReviewImage[]>;
  /** Trusted model-aware upper bound for the full text-and-image request. */
  measureInputTokenUpperBound(body: Record<string, unknown>): Promise<number>;
  readVerifiedTariff(intent: SocialPaidOperationIntent): Promise<SocialVerifiedAccountTariff | null>;
};

function tagsOf(value: unknown): string[] {
  try {
    const tags = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 30) : [];
  } catch { return []; }
}

/** Freezes one existing image record and an exact request before writing human approval. */
export async function prepareAndApproveImageEvidenceReview(input: {
  store: DataStore;
  tenantId: string;
  recordId: string;
  approvedBy: string;
  maximumCny: number;
  expiresAt: string;
  ports: TrustedPreparationPorts;
  now?: () => number;
}) {
  const record = await input.store.getById<Record_>('trend_videos', input.recordId);
  if (!record || record.id !== input.recordId || record.tenantId !== input.tenantId)
    throw Error('image_evidence_review_source_not_found');
  const analysis = videoAnalysisOf(record);
  if (record.contentFormat !== 'image' && analysis.contentFormat !== 'image')
    throw Error('image_evidence_review_source_not_image');
  if (['queued', 'processing', 'unknown'].includes(String(analysis.imageAnalysisQueueState || '')))
    throw Error('image_evidence_review_source_unsettled');
  const urls = [...new Set((Array.isArray(analysis.imageUrls) && analysis.imageUrls.length
    ? analysis.imageUrls : [record.thumbnailUrl]).filter((url): url is string => typeof url === 'string' && Boolean(url.trim())))]
    .slice(0, 10);
  if (!urls.length) throw Error('image_evidence_review_source_images_missing');
  const recordSha256 = imagePostSourceHash(record);
  const images = await input.ports.readSourceImages(structuredClone(record), [...urls]);
  if (images.length !== urls.length || images.some((image, index) => image.imageIndex !== index + 1))
    throw Error('image_evidence_review_images_incomplete');
  const candidate = analysis.imageEvidence && typeof analysis.imageEvidence === 'object'
    ? analysis.imageEvidence as Partial<ImagePostEvidenceAnalysis> : null;
  const primary = candidate && Array.isArray(candidate.observedFacts)
    && Array.isArray(candidate.carouselFlow) && Array.isArray(candidate.reusableModules)
    && Array.isArray(candidate.uncertainties)
    && (candidate.layerBlueprints === undefined || Array.isArray(candidate.layerBlueprints))
    ? candidate as ImagePostEvidenceAnalysis : undefined;
  const reviewReasons = primary ? imageEvidenceReviewReasons(primary, images.length) : ['primary_evidence_unavailable'];
  if (!reviewReasons.length) throw Error('image_evidence_review_not_required');
  const binding = await input.ports.readProviderBinding();
  if (!binding?.model?.trim() || !binding.accountRef?.trim())
    throw Error('image_evidence_review_account_unverified');
  const request: OpenAiImageEvidenceInput = { images, title: String(record.title || ''),
    caption: String(analysis.caption || ''), platform: String(record.platform || ''),
    tags: tagsOf(record.tags), primary, reviewReasons };
  const { body, requestSha256 } = buildOpenAiImageEvidenceRequest(request, binding.model);
  const inputTokens = await input.ports.measureInputTokenUpperBound(structuredClone(body));
  if (!Number.isSafeInteger(inputTokens) || inputTokens <= 0)
    throw Error('image_evidence_review_input_token_bound_missing');
  const approvalId = imageEvidenceReviewApprovalId(input.tenantId, input.recordId, recordSha256);
  const intent: SocialPaidOperationIntent = { operationId: `image-evidence-review:${approvalId}`,
    provider: 'openai', model: binding.model, accountRef: binding.accountRef,
    stage: 'image_post_evidence_review', shotId: null, inputContractHash: requestSha256,
    maximumUnits: { inputTokens, outputTokens: 7000 } };
  const tariff = await input.ports.readVerifiedTariff(intent);
  const quote = quoteSocialPaidOperationTariff(intent, tariff);
  if (!Number.isFinite(input.maximumCny) || quote.upperBoundCny > input.maximumCny)
    throw Error('image_evidence_review_budget_insufficient');
  const current = await input.store.getById<Record_>('trend_videos', input.recordId);
  if (!current || current.tenantId !== input.tenantId || imagePostSourceHash(current) !== recordSha256)
    throw Error('image_evidence_review_source_changed');
  const approval = await approveImageEvidenceReview({ store: input.store, tenantId: input.tenantId,
    recordId: input.recordId, recordSha256, intent, maximumCny: input.maximumCny,
    approvedBy: input.approvedBy, expiresAt: input.expiresAt, now: input.now });
  return { approval, requestSha256, reviewReasons, quotedUpperBoundCny: quote.upperBoundCny };
}
