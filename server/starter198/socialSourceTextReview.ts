/** Visible source text is a review hint, not proof of burned captions or overlap.
 * Unknown position must never cause automatic erasure, relocation or rejection. */
export interface SocialSourceTextReview {
  sceneId: string;
  assetId: string;
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
  text: string;
  source: 'analysis_on_screen_text' | 'measured_caption_occupancy';
  spatialStatus: 'unmeasured' | 'measured';
  status: 'review_required' | 'avoided';
  boxes?: Array<{x:number;y:number;width:number;height:number}>;
  placementDecision?: 'default' | 'upper' | 'unresolved';
  evidenceVersion?: string;
}

type Asset = {id: string; segments: Array<Record<string, unknown>>};
type Scene = {sceneId: string; source: {assetId: string; sourceStart: number; sourceEnd: number}};
type Clip = {sceneId: string; targetStart: number; targetEnd: number; trimStart?: number; trimEnd?: number};

export function socialSourceTextReview(input: {assets: Asset[]; scenes: Scene[]; timeline: Clip[];
  captionCues: Array<{start: number; end: number; text: string}>}): SocialSourceTextReview[] {
  return input.timeline.flatMap(clip => {
    const scene = input.scenes.find(value => value.sceneId === clip.sceneId);
    if (!scene) return [];
    const asset = input.assets.find(value => value.id === scene.source.assetId);
    const start = clip.trimStart ?? scene.source.sourceStart, end = clip.trimEnd ?? scene.source.sourceEnd;
    if (!asset || ![start, end, clip.targetStart, clip.targetEnd].every(Number.isFinite)
      || end <= start || clip.targetEnd <= clip.targetStart) return [];
    const durationScale = (clip.targetEnd - clip.targetStart) / (end - start);
    return asset.segments.flatMap(segment => {
      const evidence = segment.sourceTextEvidence as Record<string, unknown> | undefined;
      if (!evidence || evidence.source !== 'analysis_on_screen_text' || evidence.spatialStatus !== 'unmeasured'
        || typeof evidence.text !== 'string' || !evidence.text.trim()) return [];
      // Missing range is unknown, not an instruction to flag the whole asset.
      const from = segment.start, to = segment.end;
      if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to)) return [];
      const sourceStart = Math.max(start, from), sourceEnd = Math.min(end, to);
      if (sourceEnd <= sourceStart) return [];
      const targetStart = clip.targetStart + (sourceStart - start) * durationScale;
      const targetEnd = clip.targetStart + (sourceEnd - start) * durationScale;
      if (!input.captionCues.some(cue => cue.text.trim() && cue.start < targetEnd && cue.end > targetStart)) return [];
      return [{sceneId: scene.sceneId, assetId: asset.id, sourceStart, sourceEnd, targetStart, targetEnd,
        text: evidence.text.trim(), source: 'analysis_on_screen_text' as const,
        spatialStatus: 'unmeasured' as const, status: 'review_required' as const}];
    });
  });
}

/** Conservative layout hint for text-bearing source clips. Spatial evidence
 * is unavailable, so this does not assert that the upper band is clear. */
export function placeCaptionsAwayFromSourceText<T extends {start:number;end:number;text:string}>(
  cues:T[], reviews:SocialSourceTextReview[]):Array<T&{placement?:'upper'}> {
  return cues.map(cue => {
    const overlaps=reviews.filter(review=>cue.start<review.targetEnd&&cue.end>review.targetStart);
    const measured=overlaps.filter(review=>review.spatialStatus==='measured');
    if(overlaps.some(review=>review.status==='review_required'))return {...cue,placement:'upper' as const};
    if(measured.some(review=>review.placementDecision==='upper'))return {...cue,placement:'upper' as const};
    if(measured.length&&measured.every(review=>review.placementDecision==='default'))return cue;
    return cue;
  });
}
