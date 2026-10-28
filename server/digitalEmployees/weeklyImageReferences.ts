import type { WeeklyMixedContentSlot } from '../../shared/contracts/weeklyMixedContentPlan.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';

type ImageReferenceRecord = { id: string; contentFormat?: unknown; status?: unknown; title?: unknown;
  sourceUrl?: unknown; thumbnailUrl?: unknown; aiAnalysis?: unknown };

/** Use the three focus-ordered enterprise products; four original images cycle through them. */
export function bindWeeklyImageProducts(pack: WeeklyPackage, products: Array<{ id: string; name: string }>): WeeklyPackage {
  if (!pack.mixedContentSlots) return pack;
  const focus = products.filter((product, index, all) => product.id.trim() && product.name.trim()
    && all.findIndex(candidate => candidate.id === product.id) === index).slice(0, 3);
  if (!focus.length) return { ...pack, mixedContentSlots: pack.mixedContentSlots.map(slot =>
    slot.kind === 'image' && slot.productionRole === 'original'
      ? { ...slot, productId: undefined, productName: undefined, contentTheme: undefined } : slot) };
  let imageIndex = 0;
  return { ...pack, mixedContentSlots: pack.mixedContentSlots.map(slot => {
    if (slot.kind !== 'image' || slot.productionRole !== 'original') return slot;
    const product = focus[imageIndex++ % focus.length];
    return product ? { ...slot, productId: product.id, productName: product.name }
      : { ...slot, productId: undefined, productName: undefined, contentTheme: undefined };
  }) };
}

export function weeklyImageProductShortage(pack: WeeklyPackage): number {
  const originals = (pack.mixedContentSlots || []).filter(slot => slot.kind === 'image' && slot.productionRole === 'original');
  if (!originals.length) return 0;
  return Math.max(0, 3 - new Set(originals.map(slot => slot.productId).filter(Boolean)).size);
}

export function usableWeeklyImageReference(record: ImageReferenceRecord): boolean {
  if (record.contentFormat !== 'image' || record.status !== 'analyzed') return false;
  const analysis = videoAnalysisOf(record);
  const evidence = analysis.imageEvidence && typeof analysis.imageEvidence === 'object'
    ? analysis.imageEvidence as { status?: unknown; observedFacts?: unknown } : null;
  return analysis.contentFormat === 'image' && analysis.imageAnalysisStatus === 'analyzed'
    && evidence?.status === 'analyzed' && Array.isArray(evidence.observedFacts) && evidence.observedFacts.length > 0
    && Array.isArray(analysis.imageUrls) && analysis.imageUrls.length === 1
    && typeof analysis.imageUrls[0] === 'string' && Boolean(analysis.imageUrls[0].trim())
    && !/\.gif(?:$|[?#])/i.test(analysis.imageUrls[0])
    && Boolean(String(record.sourceUrl || '').trim()) && Boolean(String(record.title || analysis.caption || '').trim());
}

/** Bind one distinct analyzed image post per original image, independent of publication accounts. */
export function bindWeeklyImageReferences(pack: WeeklyPackage, records: ImageReferenceRecord[]): WeeklyPackage {
  if (!pack.mixedContentSlots?.some(slot => slot.kind === 'image' && slot.productionRole === 'original')) return pack;
  // A single-image production slot must not silently fall back to a carousel or GIF.
  const candidates = records.filter(usableWeeklyImageReference);
  const byId = new Map(candidates.map(record => [record.id, record]));
  const used = new Set<string>();
  const slots: WeeklyMixedContentSlot[] = pack.mixedContentSlots.map(slot => {
    if (slot.kind !== 'image' || slot.productionRole !== 'original') return slot;
    const existing = slot.referenceId && byId.get(slot.referenceId);
    const selected = existing && !used.has(existing.id) ? existing : candidates.find(record => !used.has(record.id));
    if (!selected) return { ...slot, referenceId: undefined, referenceTitle: undefined,
      referenceSourceUrl: undefined, referenceThumbnailUrl: undefined, contentTheme: undefined };
    used.add(selected.id);
    const imageUrls = videoAnalysisOf(selected).imageUrls;
    return { ...slot, referenceId: selected.id,
      referenceTitle: String(selected.title || videoAnalysisOf(selected).caption || '').trim(),
      referenceSourceUrl: String(selected.sourceUrl || '').trim(),
      referenceThumbnailUrl: String(selected.thumbnailUrl || (Array.isArray(imageUrls)
        ? imageUrls.find(url => typeof url === 'string' && url.trim()) : '') || '').trim(),
      contentTheme: slot.productName ? `借鉴所选爆款单图的视觉结构，制作${slot.productName}的原创产品单图` : undefined };
  });
  return { ...pack, mixedContentSlots: slots };
}
