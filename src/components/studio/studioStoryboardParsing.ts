import { recognizePresenterShot, salesPresenterRecognition } from '../../../shared/contracts/presenterShotRecognition';
import { type StoryboardSlot } from './studioTimelineFitting';


export function inferPersonShot(value: string): boolean | undefined {
  const text=String(value||'').toLowerCase();
  if(/人物|真人|女性|男性|女人|男人|女士|男士|出镜|口播|讲解|主持|主播|模特|面部|半身|全身|woman|man|person|presenter|speaker|talking/.test(text)) return true;
  if(/产品|机器|设备|工厂|车间|包装|细节|特写|信息图|文字卡|场景空镜|b-?roll|product|factory|machine|diagram/.test(text)) return false;
  return undefined;
}

export function referencePersonShotForDetail(item: {
  visual?: string;
  environment?: string;
  observedPresenterRole?: import('../../../shared/contracts/presenterShotRecognition').ObservedPresenterRole;
  personContinuityId?: string;
  salesPresenterConfirmed?: boolean;
  needsReview?: boolean;
}): boolean | undefined {
  const recognition = salesPresenterRecognition(item);
  if (recognition === 'confirmed') return true;
  if (item.observedPresenterRole === 'background' || item.observedPresenterRole === 'none') return false;
  if (item.needsReview || item.salesPresenterConfirmed !== undefined || item.observedPresenterRole !== undefined) return undefined;
  return inferPersonShot(`${item.visual || ''} ${item.environment || ''}`);
}

export function visualShotRoute(slot: Pick<StoryboardSlot, 'title' | 'detail'>): 'presenter' | 'motion' | 'material' {
  return recognizePresenterShot(slot);
}

export function parseTimeRangeLabel(value: string): { label: string; start: number; end: number } | null {
  // Gemini occasionally emits the first range as `[start-4.5s]` instead of
  // `[0-4.5s]`. Treat `start`/`开始` as zero so the first storyboard is not
  // dropped and the following shot is not incorrectly promoted to slot 1.
  const normalized = value
    .replace(/秒/g, 's')
    .replace(/\bstart\b|开始/gi, '0');
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*s?\s*[-–]\s*(\d+(?:\.\d+)?)\s*s?/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const safeEnd = Math.max(start + 0.5, end);
  return { label: `${start.toFixed(1)}s-${safeEnd.toFixed(1)}s`, start, end: safeEnd };
}

export function parseStandaloneTimeRangeLabel(value: string): { label: string; start: number; end: number } | null {
  // A plain, unbracketed timestamp must occupy the beginning of the line and
  // end there (or be followed by a colon). Product specifications such as
  // "0–50 kN" inside narration are data, not new storyboard boundaries.
  const standaloneRange = /^\s*(?:(?:start|开始)|\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*(?:[:：]|$)/i;
  return standaloneRange.test(value) ? parseTimeRangeLabel(value) : null;
}

export function parseStoryboardSlots(value: string, totalDuration: number): StoryboardSlot[] {
  const lines = String(value || '').split('\n');
  const slots: StoryboardSlot[] = [];
  let current: { range: { label: string; start: number; end: number }; lines: string[] } | null = null;
  const push = () => {
    if (!current) return;
    const joined = current.lines.join(' ').replace(/\s+/g, ' ').trim();
    const title = joined.match(/(?:景别|Shot)\s*[：:]\s*([^；;。]+)/i)?.[1]
      || joined.match(/(?:画面|Visual)\s*[：:]\s*([^；;。]+)/i)?.[1]
      || joined.split(/[；;。]/)[0]
      || '分镜';
    slots.push({
      id: `slot-${slots.length + 1}`,
      time: current.range.label,
      start: current.range.start,
      end: current.range.end,
      title: title.trim().slice(0, 24),
      detail: joined || '按当前时间戳放入对应素材',
    });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bracket = line.match(/\[([^\]]*?(?:(?:start|开始)|\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*)\]/i);
    const scene = line.match(/Scene\s+\d+\s*\(([^)]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^)]*)\)/i);
    const inline = !bracket && !scene ? parseStandaloneTimeRangeLabel(line) : null;
    const range = bracket ? parseTimeRangeLabel(bracket[1]) : scene ? parseTimeRangeLabel(scene[1]) : inline;
    if (range) {
      push();
      current = { range, lines: [line.replace(bracket?.[0] || scene?.[0] || '', '').trim()].filter(Boolean) };
    } else if (current) {
      current.lines.push(line);
    }
  }
  push();

  if (slots.length) return slots;
  // 没有真实时间戳脚本时不伪造等分分镜，选材页明确显示“暂无分镜”。
  return [];
}

export function studioSpecHasCompiledStoryboard(spec: Record<string, unknown>): boolean {
  const script = typeof spec.script === 'string' ? spec.script.trim() : '';
  if (!script) return false;
  const analysisResults = spec.analysisResults && typeof spec.analysisResults === 'object'
    ? spec.analysisResults as Record<string, unknown>
    : {};
  const storyboard = analysisResults.storyboard && typeof analysisResults.storyboard === 'object'
    ? analysisResults.storyboard as Record<string, unknown>
    : {};
  return parseStoryboardSlots(script, Number(spec.duration) || 0).length > 0
    || (Array.isArray(storyboard.slots) && storyboard.slots.length > 0)
    || (Array.isArray(spec.shootingSlots) && spec.shootingSlots.length > 0);
}
