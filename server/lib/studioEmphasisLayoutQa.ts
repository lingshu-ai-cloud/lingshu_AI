export type NormalizedRect = { x: number; y: number; width: number; height: number };
export type NormalizedPoint = { x: number; y: number };
export type LayoutRole = 'surround' | 'point_to' | 'adjacent' | 'corner_badge' | 'none';
export type PresentationMode = 'label' | 'graphic_only' | 'caption_emphasis' | 'none';

export type EmphasisLayoutCandidate = {
  asset: NormalizedRect;
  label?: NormalizedRect;
  visibleRegions?: NormalizedRect[];
  pointerTip?: NormalizedPoint;
  primaryDecorations?: Array<{ id: string; box: NormalizedRect }>;
};

export type EmphasisLayoutQaEvent = {
  id: string;
  startMs: number;
  endMs: number;
  text?: string;
  importance?: number;
  confidence?: number;
  presentationMode: PresentationMode;
  targetRelation: LayoutRole;
  assetId?: string;
  assetFamily?: string;
  allowedRoles?: LayoutRole[];
  semanticEvidence?: unknown;
  shotId?: string;
  subjectBox?: NormalizedRect;
  subjectAnchor?: NormalizedPoint;
  occupiedBoxes?: NormalizedRect[];
  captionBoxes?: NormalizedRect[];
  protectedBoxes?: NormalizedRect[];
  captionEditable?: boolean;
  layout?: EmphasisLayoutCandidate;
};

export type EmphasisLayoutQaResult = EmphasisLayoutQaEvent & {
  presentationMode: PresentationMode;
  targetRelation: LayoutRole;
  layout?: EmphasisLayoutCandidate;
  qa: { accepted: boolean; attempted: string[]; issues: string[] };
};

const FRAME = { x: .035, y: .035, width: .93, height: .665 };
const finiteRect = (rect: NormalizedRect | undefined): rect is NormalizedRect => Boolean(rect)
  && [rect!.x, rect!.y, rect!.width, rect!.height].every(Number.isFinite)
  && rect!.width > 0 && rect!.height > 0;
const intersects = (a: NormalizedRect, b: NormalizedRect) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (outer: NormalizedRect, inner: NormalizedRect) => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const pointDistance = (a: NormalizedPoint, b: NormalizedPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (rect: NormalizedRect): NormalizedPoint => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const intervalOverlaps = (a: EmphasisLayoutQaEvent, b: EmphasisLayoutQaEvent) => a.startMs < b.endMs && a.endMs > b.startMs;

function rectDistance(a: NormalizedRect, b: NormalizedRect): number {
  const x = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
  const y = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
  return Math.hypot(x, y);
}

const occupied = (event: EmphasisLayoutQaEvent) => [
  ...(event.occupiedBoxes || []), ...(event.captionBoxes || []), ...(event.protectedBoxes || []),
].filter(finiteRect);

function commonLayoutIssues(event: EmphasisLayoutQaEvent, includeLabel: boolean): string[] {
  const layout = event.layout;
  if (!layout || !finiteRect(layout.asset)) return ['missing_layout'];
  const rectangles = [layout.asset, ...(includeLabel && finiteRect(layout.label) ? [layout.label] : [])];
  const issues: string[] = [];
  if (includeLabel && !finiteRect(layout.label)) issues.push('missing_label');
  if (rectangles.some(rect => !contains(FRAME, rect))) issues.push('outside_safe_frame');
  if (rectangles.some(rect => occupied(event).some(box => intersects(rect, box)))) issues.push('occupied_collision');
  if (event.targetRelation !== 'surround' && finiteRect(event.subjectBox)
    && rectangles.some(rect => intersects(rect, event.subjectBox!))) issues.push('subject_collision');
  if (includeLabel && finiteRect(layout.label) && intersects(layout.asset, layout.label)) issues.push('asset_label_collision');
  if ((layout.primaryDecorations?.length || 1) > 1) issues.push('multiple_primary_decorations');
  return issues;
}

function relationIssues(event: EmphasisLayoutQaEvent): string[] {
  const layout = event.layout;
  if (!layout) return ['missing_layout'];
  const subject = event.subjectBox;
  if (event.assetFamily === 'rays' && event.targetRelation !== 'surround') return ['rays_require_surround'];
  if (event.allowedRoles?.length && !event.allowedRoles.includes(event.targetRelation)) return ['semantic_asset_role_mismatch'];
  if (event.targetRelation === 'surround') {
    if (!finiteRect(subject)) return ['surround_missing_target'];
    if (event.assetFamily && event.assetFamily !== 'rays' && event.assetFamily !== 'outline') return ['surround_asset_mismatch'];
    const regions = (layout.visibleRegions || []).filter(finiteRect);
    const sides = new Set(regions.flatMap(region => {
      const result: string[] = [];
      if (region.x + region.width <= subject.x + .025) result.push('left');
      if (region.x >= subject.x + subject.width - .025) result.push('right');
      if (region.y + region.height <= subject.y + .025) result.push('top');
      if (region.y >= subject.y + subject.height - .025) result.push('bottom');
      return result;
    }));
    if (sides.size < 2) return ['surround_not_distributed_on_outer_edges'];
    if (regions.some(region => intersects(region, { x: subject.x + subject.width * .25, y: subject.y + subject.height * .25,
      width: subject.width * .5, height: subject.height * .5 }))) return ['surround_covers_target_center'];
  }
  if (event.targetRelation === 'point_to') {
    if (!finiteRect(subject) || !event.subjectAnchor) return ['point_to_missing_target'];
    if (!layout.pointerTip || pointDistance(layout.pointerTip, event.subjectAnchor) > .05) return ['point_to_misses_target'];
  }
  if (event.targetRelation === 'adjacent') {
    if (!finiteRect(subject)) return ['adjacent_missing_target'];
    const distance = rectDistance(layout.asset, subject);
    if (intersects(layout.asset, subject) || distance < .03 - 1e-9 || distance > .10 + 1e-9) return ['adjacent_distance_invalid'];
  }
  if (event.targetRelation === 'corner_badge') {
    const c = centre(layout.asset);
    const cornerDistance = Math.min(Math.hypot(c.x, c.y), Math.hypot(1 - c.x, c.y), Math.hypot(c.x, 1 - c.y), Math.hypot(1 - c.x, 1 - c.y));
    if (cornerDistance > .32) return ['corner_badge_not_in_corner'];
    if (finiteRect(subject) && intersects(layout.asset, subject)) return ['corner_badge_target_collision'];
  }
  return [];
}

function priority(event: EmphasisLayoutQaEvent): number {
  return (Number(event.importance) || 0) * 100 + (Number(event.confidence) || 0) * 10;
}

export function validateAndDegradeEmphasisLayouts(events: EmphasisLayoutQaEvent[], cooldownMs = 4_000): EmphasisLayoutQaResult[] {
  const winners: EmphasisLayoutQaEvent[] = [];
  const suppression = new Map<string, string>();
  for (const event of [...events].sort((a, b) => priority(b) - priority(a) || a.startMs - b.startMs || a.id.localeCompare(b.id))) {
    if (!['label', 'graphic_only'].includes(event.presentationMode)) continue;
    const conflict = winners.find(winner => intervalOverlaps(event, winner));
    if (conflict) { suppression.set(event.id, `same_screen_conflict:${conflict.id}`); continue; }
    const repeated = event.assetId && winners.find(winner => winner.assetId === event.assetId
      && Math.abs(event.startMs - winner.startMs) < cooldownMs);
    if (repeated) { suppression.set(event.id, `asset_cooldown:${repeated.id}`); continue; }
    winners.push(event);
  }

  return events.map(event => {
    const attempted = [`relation:${event.targetRelation}`];
    const issues = [
      ...(!event.semanticEvidence ? ['missing_semantic_evidence'] : []),
      ...(!event.shotId ? ['missing_shot_window'] : []),
      ...(suppression.has(event.id) ? [suppression.get(event.id)!] : []),
      ...commonLayoutIssues(event, event.presentationMode === 'label'),
      ...relationIssues(event),
    ];
    if (event.presentationMode === 'none' || event.presentationMode === 'caption_emphasis') {
      return { ...event, qa: { accepted: true, attempted: [event.presentationMode], issues: [] } };
    }
    if (!issues.length) return { ...event, qa: { accepted: true, attempted, issues } };

    attempted.push('graphic_only');
    const graphicIssues = commonLayoutIssues({ ...event, targetRelation: 'none' }, false);
    const detachedRays = event.assetFamily === 'rays';
    const missingEvidence = !event.semanticEvidence || !event.shotId;
    if (!suppression.has(event.id) && !missingEvidence && !detachedRays && !graphicIssues.length) {
      return { ...event, presentationMode: 'graphic_only', targetRelation: 'none',
        layout: event.layout && { ...event.layout, label: undefined },
        qa: { accepted: true, attempted, issues } };
    }
    attempted.push('caption_emphasis');
    if (event.captionEditable !== false && String(event.text || '').trim()) {
      return { ...event, presentationMode: 'caption_emphasis', targetRelation: 'none', layout: undefined,
        qa: { accepted: true, attempted, issues } };
    }
    attempted.push('none');
    return { ...event, presentationMode: 'none', targetRelation: 'none', layout: undefined,
      qa: { accepted: false, attempted, issues } };
  });
}
