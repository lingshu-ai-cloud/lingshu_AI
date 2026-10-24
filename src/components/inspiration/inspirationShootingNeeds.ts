import type { Material } from '../../lib/studioApi';
import type { ScriptDetail15s, ShootingNeed, TrendVideo } from '../../lib/inspirationTypes';
import { getAnalysis } from './inspirationAnalysisProjection';
import { matchMaterialsToFrames, shortenText } from './inspirationFrameMatching';

function frameStartsEarly(time: string): boolean {
  const match = String(time).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) <= 3 : false;
}

function shootingNeedTitle(detail: ScriptDetail15s): string {
  const text = `${detail.visual} ${detail.subtitle}`.toLowerCase();
  if (/face|脸|skin|肤|acne|dry|保湿|护肤|洁面|妆|唇|lip/.test(text)) return '真人上脸/使用场景';
  if (/package|包装|logo|brand|瓶|罐|产品|product|texture|质地/.test(text)) return '产品包装/质地特写';
  if (/factory|工厂|warehouse|生产|发货|ship|proof|证明/.test(text)) return '工厂履约/发货证明';
  return '通用转场/场景补充';
}

export function buildShootingNeeds(videos: TrendVideo[], materials: Material[]): ShootingNeed[] {
  const grouped = new Map<string, ShootingNeed>();
  for (const video of videos) {
    const analysis = getAnalysis(video);
    if (!analysis) continue;
    const matches = matchMaterialsToFrames(analysis.scriptDetails15s, materials);
    for (const match of matches) {
      if (match.material) continue;
      const title = shootingNeedTitle(match.detail);
      const key = `${video.platform}-${title}-${match.suggestion}`;
      const existing = grouped.get(key);
      const sourceTitle = shortenText(video.title, 42);
      if (existing) {
        existing.count += 1;
        if (video.crawledAt && (!existing.createdAt || Date.parse(video.crawledAt) < Date.parse(existing.createdAt))) existing.createdAt = video.crawledAt;
        if (!existing.sourceVideos.includes(sourceTitle)) existing.sourceVideos.push(sourceTitle);
        if (frameStartsEarly(match.detail.time)) existing.priority = '高';
        continue;
      }
      grouped.set(key, {
        id: key,
        createdAt: video.crawledAt,
        priority: frameStartsEarly(match.detail.time) ? '高' : '中',
        title,
        suggestion: match.suggestion,
        count: 1,
        sourceVideos: [sourceTitle],
        platform: video.platform,
        ratio: video.platform === 'youtube' ? '16:9' : '9:16',
        example: match.detail,
      });
    }
  }
  return Array.from(grouped.values())
    .map((item): ShootingNeed => ({ ...item, priority: item.priority === '高' || item.count >= 3 ? '高' : item.count >= 2 ? '中' : '低' }))
    .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
}

export function shootingCreationDate(value?: string): string {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '待补录';
}

export const pendingShootingTaskCount = (tasks: ReadonlyArray<{ uploadedMaterialIds: readonly string[] }>) => tasks.filter(task => task.uploadedMaterialIds.length === 0).length;
