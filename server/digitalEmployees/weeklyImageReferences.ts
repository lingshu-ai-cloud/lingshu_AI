import type { WeeklyMixedContentSlot } from '../../shared/contracts/weeklyMixedContentPlan.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';

type ImageReferenceRecord = { id: string; contentFormat?: unknown; status?: unknown; title?: unknown;
  sourceUrl?: unknown; thumbnailUrl?: unknown; aiAnalysis?: unknown };

export function usableWeeklyImageReference(record: ImageReferenceRecord): boolean {
  if (record.contentFormat !== 'image' || record.status !== 'analyzed') return false;
  const analysis = videoAnalysisOf(record);
  const evidence = analysis.imageEvidence && typeof analysis.imageEvidence === 'object'
    ? analysis.imageEvidence as { status?: unknown; observedFacts?: unknown } : null;
  return analysis.contentFormat === 'image' && analysis.imageAnalysisStatus === 'analyzed'
    && evidence?.status === 'analyzed' && Array.isArray(evidence.observedFacts) && evidence.observedFacts.length > 0
    && Array.isArray(analysis.imageUrls) && analysis.imageUrls.some(url => typeof url === 'string' && url.trim())
    && Boolean(String(record.sourceUrl || '').trim()) && Boolean(String(record.title || analysis.caption || '').trim());
}

/** Bind one distinct analyzed image post per original image, independent of publication accounts. */
export function bindWeeklyImageReferences(pack: WeeklyPackage, records: ImageReferenceRecord[]): WeeklyPackage {
  if (!pack.mixedContentSlots?.some(slot => slot.kind === 'image' && slot.productionRole === 'original')) return pack;
  // An original single-image slot should prefer a single-image reference;
  // a carousel remains available only when there are not enough single-image posts.
  const candidates = records.filter(usableWeeklyImageReference).sort((left, right) => {
    const leftSingle = (videoAnalysisOf(left).imageUrls as unknown[]).length === 1;
    const rightSingle = (videoAnalysisOf(right).imageUrls as unknown[]).length === 1;
    return Number(rightSingle) - Number(leftSingle);
  });
  const byId = new Map(candidates.map(record => [record.id, record]));
  const used = new Set<string>();
  const slots: WeeklyMixedContentSlot[] = pack.mixedContentSlots.map(slot => {
    if (slot.kind !== 'image' || slot.productionRole !== 'original') return slot;
    const existing = slot.referenceId && byId.get(slot.referenceId);
    const selected = existing && !used.has(existing.id) ? existing : candidates.find(record => !used.has(record.id));
    if (!selected) return { ...slot, referenceId: undefined, referenceTitle: undefined,
      referenceSourceUrl: undefined, referenceThumbnailUrl: undefined };
    used.add(selected.id);
    const imageUrls = videoAnalysisOf(selected).imageUrls;
    return { ...slot, referenceId: selected.id,
      referenceTitle: String(selected.title || videoAnalysisOf(selected).caption || '').trim(),
      referenceSourceUrl: String(selected.sourceUrl || '').trim(),
      referenceThumbnailUrl: String(selected.thumbnailUrl || (Array.isArray(imageUrls)
        ? imageUrls.find(url => typeof url === 'string' && url.trim()) : '') || '').trim() };
  });
  return { ...pack, mixedContentSlots: slots };
}
