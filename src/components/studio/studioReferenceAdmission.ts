import { normalizeBenchmarkAnalysisSnapshot } from '../../../shared/benchmarkAnalysis';
import { productionReferenceAdmission } from '../../../shared/productionReferenceAdmission';
import type { VideoKickoff } from './studioVideoKickoff';
import { parseCueRange } from './studioVoiceoverRules';

export function referenceAnalysisEnd(kickoff: VideoKickoff | null): number {
  return (kickoff?.referenceAnalysis?.details || []).reduce((max, item) => {
    const range = parseCueRange(item.time);
    return Math.max(max, range?.end || 0);
  }, 0);
}

export function studioReferenceAnalysisBlockers(kickoff: VideoKickoff | null): string[] {
  const canonical = normalizeBenchmarkAnalysisSnapshot(kickoff?.referenceAnalysis?.benchmarkAnalysis);
  if (canonical) return productionReferenceAdmission(canonical).blockers;
  const sourceDuration = Number(kickoff?.video?.duration || 0);
  const analyzedUntil = referenceAnalysisEnd(kickoff);
  const details = kickoff?.referenceAnalysis?.details || [];
  const blockers: string[] = [];
  if (!details.length) blockers.push('参考视频缺少逐镜分析');
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) blockers.push('参考视频时长尚未确认');
  if (blockers.length) return blockers;
  const ranges = details
    .map(item => parseCueRange(item.time))
    .filter((item): item is { start: number; end: number } => Boolean(item))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (ranges.length !== details.length) blockers.push('有镜头缺少有效起止时间');
  if (ranges[0]?.start != null && ranges[0].start > 0.75) blockers.push('开场时间线未覆盖');
  if (sourceDuration > 0 && analyzedUntil + 1 < sourceDuration) blockers.push('逐镜分析没有覆盖完整原片');
  if (ranges.some((range, index) => {
    const next = ranges[index + 1];
    return Boolean(next && next.start - range.end > 0.75)
      || Boolean(next && range.end - next.start > 0.75);
  })) blockers.push('逐镜时间线存在缺口或重叠');
  if (details.some(item => /分析超时|缺少真实片段/.test(`${item.note || ''} ${item.visual || ''}`))) blockers.push('有镜头缺少真实片段证据');
  return [...new Set(blockers)];
}

export function hasIncompleteReferenceAnalysis(kickoff: VideoKickoff | null): boolean {
  return studioReferenceAnalysisBlockers(kickoff).length > 0;
}

export type MigrationMode = 'fidelity' | 'structure' | 'mechanism';

export interface MigrationRecommendation {
  mode: MigrationMode;
  label: string;
  reason: string;
  preserve: string[];
  rebuild: string[];
}

export function recommendMigration(kickoff: VideoKickoff | null, productInfo: string): MigrationRecommendation {
  const reference = [
    kickoff?.video?.title || '',
    kickoff?.referenceAnalysis?.visualStyle || '',
    ...(kickoff?.referenceAnalysis?.details || []).flatMap(item => [item.environment || '', item.visual || '', item.purpose || '']),
  ].join(' ').toLowerCase();
  const product = String(productInfo || '').toLowerCase();
  const groups = [
    /truck|lorry|卡车|货车|牵引车|底盘/,
    /cream|serum|cosmetic|skincare|lip gloss|lipstick|唇蜜|口红|面霜|精华|美妆|护肤/,
    /lighting|light fixture|track light|灯具|照明|轨道灯|筒灯/,
    /package|packaging|paper bag|paper box|包装|纸袋|纸盒|礼盒/,
    /furniture|sofa|chair|家具|沙发|椅子/,
    /apparel|garment|fabric|dress|服装|面料|连衣裙/,
  ];
  const referenceGroup = groups.findIndex(group => group.test(reference));
  const productGroup = groups.findIndex(group => group.test(product));
  const details = kickoff?.referenceAnalysis?.details || [];
  const preserve = [
    details.length ? `保留 ${details.length} 段原片镜头顺序与时长比例` : '保留开场钩子与信息揭示顺序',
    '保留可迁移的构图、切镜密度和音画节奏',
  ];
  if (!kickoff || !details.length) return {
    mode: 'mechanism', label: '机制借鉴', reason: '对标视频缺少完整逐镜证据，不宜直接复刻分镜。', preserve,
    rebuild: ['根据企业产品和现有素材重建场景、动作和证明内容'],
  };
  if (referenceGroup >= 0 && referenceGroup === productGroup) return {
    mode: 'fidelity', label: '高保真复刻', reason: '对标内容与所选产品展示逻辑接近，可保留大部分分镜。', preserve,
    rebuild: ['替换竞品品牌、型号、参数和不支持的卖点'],
  };
  if (referenceGroup >= 0 && productGroup >= 0 && referenceGroup !== productGroup) return {
    mode: 'structure', label: '结构迁移', reason: '对标视频与所选产品跨品类，直接替换会产生不可执行画面。', preserve,
    rebuild: ['产品场景、主体动作和细节证明', '所有竞品品牌、型号和原品类对象'],
  };
  return {
    mode: 'structure', label: '结构迁移', reason: '可保留原片的钩子、证明顺序和节奏，画面按企业产品重建更稳妥。', preserve,
    rebuild: ['产品场景、动作和证明内容', '竞品专属事实与话术'],
  };
}
