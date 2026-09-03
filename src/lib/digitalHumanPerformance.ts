export type PerformanceIntent = 'hook' | 'problem' | 'benefit' | 'proof' | 'transition' | 'cta';
export type PerformanceEmotion = 'neutral' | 'friendly' | 'confident' | 'concerned' | 'excited';
export type PerformanceExpression = 'neutral' | 'slight_smile' | 'brow_raise' | 'concern' | 'firm';
export type PerformanceGesture = 'none' | 'open_palm' | 'emphasis' | 'point_left' | 'point_right'
  | 'count_one' | 'count_two' | 'count_three' | 'product_hold' | 'cta';
export type PerformanceCamera = 'locked' | 'push_in' | 'pull_out' | 'pan_left' | 'pan_right';

export interface DigitalHumanPerformanceBeat {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  intent: PerformanceIntent;
  emotion: PerformanceEmotion;
  intensity: number;
  expression: PerformanceExpression;
  head: 'hold' | 'nod_once' | 'tilt' | 'turn';
  gaze: 'camera' | 'left' | 'right' | 'product';
  gesture: PerformanceGesture;
  actionPeakMs: number;
  motionClipId?: string;
}

export interface DigitalHumanPerformancePlan {
  version: 'performance-v1';
  preset: 'natural' | 'professional' | 'commerce';
  durationMs: number;
  variationSeed?: number;
  beats: DigitalHumanPerformanceBeat[];
  scene: {
    mode: 'source' | 'chroma' | 'segmented';
    camera: PerformanceCamera;
    composition: 'full_frame' | 'presenter_card_left' | 'presenter_card_right';
    backgroundMaterialId?: string;
  };
}

export interface AvatarMotionClip {
  id: string;
  avatarId: string;
  materialId: string;
  gesture: Exclude<PerformanceGesture, 'none'> | 'idle';
  emotion: PerformanceEmotion;
  intensity: number;
  shotSize: 'close' | 'medium' | 'full';
  gaze: 'camera' | 'left' | 'right' | 'product';
  safeStartMs: number;
  safeEndMs: number;
  rightsStatus: 'internal_test' | 'commercial_cleared' | 'restricted';
  version: number;
  sourceHash: string;
}

const normalizeSegments = (script: string): string[] => {
  const chunks = script.replace(/\s+/g, ' ').trim().split(/(?<=[。！？!?；;])/u).map(value => value.trim()).filter(Boolean);
  return chunks.length ? chunks : [];
};

function classify(text: string, index: number): Omit<DigitalHumanPerformanceBeat, 'id' | 'text' | 'startMs' | 'endMs' | 'actionPeakMs'> {
  const explicitCta = /私信|联系|领取|咨询|预约|现在|立即|点击|message|contact|download|\bdm\b|escr[ií]b|contacta|reserva/i.test(text);
  // The planner is also called for one storyboard paragraph at a time. Never
  // turn the last sentence of a multi-sentence hook into a CTA unless its own
  // language explicitly carries CTA intent.
  if (explicitCta) {
    return { intent: 'cta', emotion: 'friendly', intensity: 0.62, expression: 'slight_smile', head: 'nod_once', gaze: 'camera', gesture: 'cta' };
  }
  if (/三大|三个|3个|三点|三项|three|\b3\b|tres/i.test(text)) {
    return { intent: 'proof', emotion: 'confident', intensity: 0.68, expression: 'brow_raise', head: 'nod_once', gaze: 'camera', gesture: 'count_three' };
  }
  if (/地铁|位置|距离|旁边|周边|配套|这里|commute|property|verify|location|trayecto|inmueble|confirma/i.test(text)) {
    return { intent: 'proof', emotion: 'confident', intensity: 0.58, expression: 'firm', head: 'turn', gaze: 'right', gesture: 'point_right' };
  }
  if (/别急|别只|担心|问题|预算|总价|痛点|不要|risk|budget|price|do not|don['’]t|compare|presupuesto|precio|no compares/i.test(text)) {
    return { intent: index === 0 ? 'hook' : 'problem', emotion: 'concerned', intensity: 0.48, expression: 'concern', head: 'tilt', gaze: 'camera', gesture: 'open_palm' };
  }
  return { intent: index === 0 ? 'hook' : 'benefit', emotion: 'confident', intensity: 0.55, expression: index === 0 ? 'brow_raise' : 'slight_smile', head: 'nod_once', gaze: 'camera', gesture: index === 0 ? 'emphasis' : 'open_palm' };
}

export function planDigitalHumanPerformance(input: {
  script: string;
  durationMs: number;
  preset?: DigitalHumanPerformancePlan['preset'];
  sceneIndex?: number;
  variationSeed?: number;
}): DigitalHumanPerformancePlan {
  const segments = normalizeSegments(input.script);
  const durationMs = Math.max(1000, Math.round(input.durationMs));
  const weights = segments.map(text => Math.max(1, text.replace(/\W/gu, '').length));
  const totalWeight = Math.max(1, weights.reduce((sum, value) => sum + value, 0));
  let cursor = 0;
  let previousGesture: PerformanceGesture = 'none';
  const fallbackGestures: PerformanceGesture[] = ['emphasis', 'open_palm', 'point_right', 'cta'];
  const preset = input.preset || 'natural';
  const variationSeed = Math.max(0, Math.floor(input.variationSeed || 0));
  const beats = segments.map((text, index) => {
    const startMs = cursor;
    const endMs = index === segments.length - 1 ? durationMs : Math.round(cursor + durationMs * weights[index]! / totalWeight);
    cursor = endMs;
    const classified = classify(text, index);
    if (preset === 'natural') classified.intensity = Math.max(0.35, +(classified.intensity * 0.82).toFixed(2));
    if (preset === 'professional') classified.intensity = Math.min(0.58, classified.intensity);
    if (variationSeed > 0 && classified.intent !== 'cta') {
      const alternatives: PerformanceGesture[] = ['open_palm', 'count_three', 'emphasis', 'point_right'];
      classified.gesture = alternatives[(index + variationSeed) % alternatives.length]!;
    }
    if (classified.gesture === previousGesture) classified.gesture = fallbackGestures.find(item => item !== previousGesture) || 'none';
    previousGesture = classified.gesture;
    return {
      id: `beat-${index + 1}`,
      text,
      startMs,
      endMs,
      ...classified,
      actionPeakMs: Math.round(startMs + (endMs - startMs) * 0.55),
    };
  });
  const sceneIndex = Math.max(0, input.sceneIndex || 0);
  const compositions: DigitalHumanPerformancePlan['scene']['composition'][] = ['full_frame', 'presenter_card_left', 'presenter_card_right'];
  const cameras: PerformanceCamera[] = ['locked', 'push_in', 'pan_left'];
  return {
    version: 'performance-v1',
    preset,
    durationMs,
    variationSeed: variationSeed || undefined,
    beats,
    scene: { mode: 'source', camera: cameras[sceneIndex % cameras.length]!, composition: compositions[sceneIndex % compositions.length]! },
  };
}

export function selectMotionClips(plan: DigitalHumanPerformancePlan, clips: AvatarMotionClip[], allowInternalTest = false, avoidClipIds: string[] = []) {
  const eligible = clips.filter(clip => clip.rightsStatus === 'commercial_cleared' || (allowInternalTest && clip.rightsStatus === 'internal_test'));
  const avoid = new Set(avoidClipIds);
  const nonAvoided = eligible.filter(clip => !avoid.has(clip.id));
  const candidates = nonAvoided.length ? nonAvoided : eligible;
  let previousId = '';
  return plan.beats.map(beat => {
    const ranked = candidates
      .filter(clip => clip.id !== previousId)
      .map(clip => ({ clip, score: (clip.gesture === beat.gesture ? 100 : clip.gesture === 'idle' ? 5 : 0) + (clip.emotion === beat.emotion ? 20 : 0) - Math.abs(clip.intensity - beat.intensity) * 10 }))
      .sort((a, b) => b.score - a.score || a.clip.id.localeCompare(b.clip.id));
    const selected = ranked[0]?.clip;
    if (selected) previousId = selected.id;
    return { beatId: beat.id, motionClipId: selected?.id, score: ranked[0]?.score ?? -1 };
  });
}

export function performancePlanFingerprint(plan: DigitalHumanPerformancePlan): string {
  return JSON.stringify({ version: plan.version, preset: plan.preset, durationMs: plan.durationMs, variationSeed: plan.variationSeed || 0, beats: plan.beats, scene: plan.scene });
}
