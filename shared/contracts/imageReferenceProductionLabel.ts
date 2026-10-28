export type ImageReferenceProductionKind = 'product_only' | 'shoot_required' | 'unknown';
export type ImageReferenceStyleElement = 'soft_light' | 'hard_light' | 'high_key' | 'low_key' | 'centered' | 'asymmetric' | 'close_up' | 'minimal' | 'layered';
export interface ImageReferenceProductionLabel {
  imageIndex: number;
  kind: ImageReferenceProductionKind;
  /** Visually observed product presence, independent of whether a real-world shoot is required. */
  productPresence?: 'present' | 'absent' | 'unknown';
  evidence: string;
  confidence: number;
  /** Hash of the exact analyzed image bytes; absent when the source could not be read. */
  sourceSha256: string | null;
  /** Model observations are suggestions, not verified permission to generate or publish. */
  verification: 'unverified';
  style?: { kind: 'advertising' | 'imitable' | 'unknown'; confidence: number; evidence: string; elements: ImageReferenceStyleElement[] };
}

/** Reject missing, duplicate or weak model observations instead of inferring a safe class. */
export function normalizeImageReferenceProductionLabels(raw: unknown, sources: Array<{ imageIndex: number; sourceSha256: string | null }>): ImageReferenceProductionLabel[] {
  const items = Array.isArray(raw) ? raw : [];
  return sources.map(source => {
    const candidates = items.filter(value => value && typeof value === 'object' && !Array.isArray(value)
      && (value as Record<string, unknown>).imageIndex === source.imageIndex) as Array<Record<string, unknown>>;
    const value = candidates.length === 1 ? candidates[0] : undefined;
    const confidence = typeof value?.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1 ? value.confidence : 0;
    const evidence = typeof value?.evidence === 'string' ? value.evidence.trim().slice(0, 1000) : '';
    const kind = value?.kind === 'product_only' || value?.kind === 'shoot_required' ? value.kind : 'unknown';
    const productPresence = value?.productPresence === 'present' || value?.productPresence === 'absent'
      ? value.productPresence : kind === 'product_only' ? 'present' : 'unknown';
    const hash = source.sourceSha256 && /^[a-f0-9]{64}$/.test(source.sourceSha256) ? source.sourceSha256 : null;
    const usable = Boolean(hash && evidence && confidence >= .8 && kind !== 'unknown');
    const presenceUsable = Boolean(hash && evidence && confidence >= .8 && productPresence !== 'unknown');
    const styleRaw = value?.style && typeof value.style === 'object' && !Array.isArray(value.style) ? value.style as Record<string, unknown> : {};
    const styleConfidence = typeof styleRaw.confidence === 'number' && Number.isFinite(styleRaw.confidence) && styleRaw.confidence >= 0 && styleRaw.confidence <= 1 ? styleRaw.confidence : 0;
    const styleEvidence = typeof styleRaw.evidence === 'string' ? styleRaw.evidence.trim().slice(0, 1000) : '';
    const allowed = new Set<ImageReferenceStyleElement>(['soft_light','hard_light','high_key','low_key','centered','asymmetric','close_up','minimal','layered']);
    const elements = Array.isArray(styleRaw.elements) ? [...new Set(styleRaw.elements.filter((element): element is ImageReferenceStyleElement => allowed.has(element as ImageReferenceStyleElement)))] : [];
    const styleKind = styleRaw.kind === 'advertising' || styleRaw.kind === 'imitable' ? styleRaw.kind : 'unknown';
    const styleUsable = Boolean(hash && styleEvidence && styleConfidence >= .8 && styleKind !== 'unknown' && (styleKind !== 'imitable' || elements.length));
    return { imageIndex: source.imageIndex, kind: usable ? kind : 'unknown', productPresence: presenceUsable ? productPresence : 'unknown', evidence: usable || presenceUsable ? evidence : '', confidence: usable || presenceUsable ? confidence : 0, sourceSha256: hash, verification: 'unverified',
      style: styleUsable ? { kind: styleKind, confidence: styleConfidence, evidence: styleEvidence, elements } : { kind:'unknown', confidence:0, evidence:'', elements:[] } };
  });
}
