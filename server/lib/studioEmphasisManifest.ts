import {
  emphasisBudgetForDuration,
  EMPHASIS_PROFILES,
  normalizeCaptionSegments,
  normalizeEmphasisPlan,
  type CaptionSegment,
  type EmphasisEvent,
  type EmphasisPlanV1,
  type EmphasisProfile,
  type EmphasisPlacementWindow,
} from '../../shared/contracts/emphasisTimeline.js';

export type StudioEmphasisPlan = EmphasisPlanV1;

type Cue = { start?: unknown; end?: unknown; text?: unknown; kind?: unknown; speakerId?: unknown; keywords?: unknown };
type TimelineShot = {
  name?: unknown;
  purpose?: unknown;
  caption?: unknown;
  targetVisual?: unknown;
  action?: unknown;
  targetStart?: unknown;
  targetEnd?: unknown;
  targetDuration?: unknown;
};
export type StudioEmphasisPlanInput = {
  profile?: unknown;
  captions?: unknown;
  events?: unknown;
  placementWindows?: unknown;
  maxEvents?: unknown;
};

const text = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const metadataField = /(?:环境|景别|运镜|构图|镜头功能|画面|配乐|台词|字幕)[：:]/;

function shortTimelineLabel(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  const subtitle = raw.match(/字幕[：:]\s*(.+)$/)?.[1]?.trim();
  if (subtitle) return subtitle.slice(0, 48);
  const overlay = raw.match(/(?:后期)?叠加文字[‘'“"]([^’'”"]{2,48})[’'”"]/)?.[1]?.trim();
  if (overlay) return overlay;
  const purpose = raw.match(/镜头功能[：:]\s*(.+?)(?=\s+(?:环境|景别|运镜|构图|画面|配乐|台词|字幕)[：:]|$)/)?.[1]?.trim();
  if (purpose) return purpose.slice(0, 32);
  return raw.length <= 48 && !metadataField.test(raw) ? raw : '';
}

function semanticTimelineEvent(label: string): { type: EmphasisEvent['type']; text: string; importance: 1 | 2 | 3 } | null {
  const quantity = label.match(/(?:起订量[^，。！？!?]{0,10})?(\d+)\s*(件|支|套|个|盒)\s*(?:起订)?/i);
  if (quantity && /起订|MOQ|最低|只要/i.test(label)) {
    return { type: 'key_fact', text: `${quantity[1]}${quantity[2]}起订`, importance: 3 };
  }
  if (/私信|咨询|联系|扫码|点击|留言|戳我|contact|shop now|learn more/i.test(label)) {
    const messenger = label.match(/Messenger[^，。！？!?]{0,12}/i)?.[0];
    return { type: 'cta', text: messenger || label.slice(0, 24), importance: 3 };
  }
  if (/马上配货|立即发货|成品效果|前后对比|完成|亮灯|开灯|揭晓|reveal|result/i.test(label)) {
    const concise = label.match(/马上配货|立即发货|成品效果|前后对比|亮灯看效果|开灯看效果|揭晓效果/i)?.[0];
    return { type: 'reveal', text: concise || label.slice(0, 24), importance: 2 };
  }
  return null;
}

export function recommendStudioSubtitleProfile(input: { script?: unknown; cues?: Cue[]; timeline?: TimelineShot[] }): EmphasisProfile {
  const corpus = [text(input.script), ...(input.cues || []).map(cue => text(cue.text)), ...(input.timeline || []).map(shot => text(shot.name))].join(' ');
  if (/工厂|厂区|车间|产线|流水线|设备|加工|质检|仓库|机械|machine|factory|production line/i.test(corpus)) return 'factory_process';
  if (/剧情|角色|柜姐|对话|种草|正装|优惠|折扣|到手价|买[一二两\d].*送|限时|疯狂|爆闪|氛围感/i.test(corpus)) return 'd2c_dialogue';
  if (/产品|材质|尺寸|规格|功能|成品|实拍|展厅|台面|结构|颜色|product|material|size/i.test(corpus)) return 'product_showcase';
  return 'talking_head';
}

function captionsFromCues(cues: Cue[], durationMs: number): CaptionSegment[] {
  return normalizeCaptionSegments(cues.map((cue, index) => ({
    id: `caption-${index + 1}`,
    startMs: Number(cue.start) * 1_000,
    endMs: Number(cue.end) * 1_000,
    text: text(cue.text),
    speakerId: cue.speakerId,
    keywords: cue.keywords,
  })), durationMs);
}

function inferredCandidates(captions: CaptionSegment[], cues: Cue[]): EmphasisEvent[] {
  if (!captions.length) return [];
  const candidates: EmphasisEvent[] = [{
    id: 'auto-hook', type: 'hook', startMs: captions[0]!.startMs,
    endMs: Math.min(captions[0]!.endMs, captions[0]!.startMs + 2_400), text: captions[0]!.text,
    importance: 3, confidence: .86, source: 'transcript',
  }];
  captions.forEach((caption, index) => {
    const cue = cues[index];
    if (/\d|价格|优惠|折扣|免费|规格|尺寸|产能|交付|质保|认证|price|free|%/i.test(caption.text)) {
      candidates.push({ id: `auto-fact-${index + 1}`, type: 'key_fact', startMs: caption.startMs,
        endMs: caption.endMs, text: caption.text, importance: 2, confidence: .8, source: 'transcript' });
    }
    if (/私信|咨询|到店|下单|购买|联系我们|立即|扫码|点击|留言|contact|shop now|learn more/i.test(caption.text)) {
      candidates.push({ id: `auto-cta-${index + 1}`, type: 'cta', startMs: caption.startMs,
        endMs: caption.endMs, text: caption.text, importance: 2, confidence: .82, source: 'transcript' });
    }
    if (String(cue?.kind || '') === 'screen') {
      candidates.push({ id: `auto-section-${index + 1}`, type: 'section_label', startMs: caption.startMs,
        endMs: caption.endMs, text: caption.text, importance: 1, confidence: .8, source: 'metadata' });
    }
  });
  return candidates;
}

function timelineCandidates(shots: TimelineShot[]): EmphasisEvent[] {
  let cursorMs = 0;
  return shots.flatMap((shot, index) => {
    const startMs = Number.isFinite(Number(shot.targetStart)) ? Number(shot.targetStart) * 1_000 : cursorMs;
    const durationMs = Number.isFinite(Number(shot.targetDuration)) ? Number(shot.targetDuration) * 1_000 : 2_000;
    const endMs = Number.isFinite(Number(shot.targetEnd)) ? Number(shot.targetEnd) * 1_000 : startMs + durationMs;
    cursorMs = Math.max(cursorMs, endMs);
    const label = shortTimelineLabel(shot.caption || shot.purpose);
    const visual = text(shot.targetVisual || shot.action || shot.name);
    const events: EmphasisEvent[] = [];
    const semantic = label && !/^(无|none)$/i.test(label) ? semanticTimelineEvent(label) : null;
    if (semantic) {
      const semanticStart = semantic.type === 'key_fact' && startMs === 0
        ? Math.min(Math.max(startMs, endMs - 1_800), startMs + 3_600)
        : startMs;
      events.push({
        id: `auto-shot-${semantic.type}-${index + 1}`, type: semantic.type,
        startMs: semanticStart, endMs: Math.min(endMs, semanticStart + 1_800),
        text: semantic.text, importance: semantic.importance, confidence: .84, source: 'metadata',
      });
    }
    if (visual && /成品|效果|前后对比|完成|亮灯|开灯|揭晓|reveal|result/i.test(visual)) events.push({
      id: `auto-shot-reveal-${index + 1}`, type: 'reveal', startMs, endMs: Math.min(endMs, startMs + 2_000),
      text: label || visual, importance: 2, confidence: .76, source: 'vision',
    });
    return events;
  });
}

export function buildStudioEmphasisPlan(input: {
  durationSeconds: number;
  script?: unknown;
  subtitles?: { cues?: Cue[] };
  timeline?: TimelineShot[];
  emphasisPlan?: StudioEmphasisPlanInput;
}): StudioEmphasisPlan {
  const durationMs = Math.max(0, Math.round(Number(input.durationSeconds || 0) * 1_000));
  const cues = Array.isArray(input.subtitles?.cues) ? input.subtitles!.cues! : [];
  const supplied = input.emphasisPlan || {};
  const captions = normalizeCaptionSegments(supplied.captions, durationMs);
  const normalizedCaptions = captions.length ? captions : captionsFromCues(cues, durationMs);
  const profile = EMPHASIS_PROFILES.includes(String(supplied.profile) as EmphasisProfile)
    ? supplied.profile as EmphasisProfile
    : recommendStudioSubtitleProfile({ script: input.script, cues, timeline: input.timeline });
  const candidates = Array.isArray(supplied.events) && supplied.events.length
    ? supplied.events : [...inferredCandidates(normalizedCaptions, cues), ...timelineCandidates(input.timeline || [])];
  const defaultBudget = emphasisBudgetForDuration(durationMs);
  const requestedMax = Number(supplied.maxEvents);
  const maxEvents = Number.isFinite(requestedMax)
    ? Math.max(0, Math.min(40, Math.round(requestedMax))) : defaultBudget.max;
  const placementWindows = Array.isArray(supplied.placementWindows)
    ? supplied.placementWindows as EmphasisPlacementWindow[] : undefined;
  return normalizeEmphasisPlan({ profile, captions: normalizedCaptions, events: candidates, maxEvents }, durationMs, placementWindows);
}
