import { createHash } from 'node:crypto';
import { buildBenchmarkAnalysis, recordOf, type BenchmarkAnalysis } from '../../shared/benchmarkAnalysis.js';
import { hasReferenceMaterialOrigin, isReferenceOnlyMaterial } from '../lib/materialPolicy.js';
import { isSyntheticMaterial } from '../lib/materialTruthfulness.js';
import type { CreationShot } from '../../shared/contracts/contentCreationDialogue.js';
const text = (value: unknown, max = 700) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const observedText = (segment: Record<string, unknown>) => text(Array.isArray(segment.observedFacts) ? segment.observedFacts.filter(value => typeof value === 'string').join('；') : segment.observedFacts) || text(segment.action);
/** Shared source evidence for legacy and guided dialogue. Consumer owns its presentation limit. */
export function collectCreationShots(referenceId: string, productIds: string[], analysis: Record<string, unknown>, benchmark: BenchmarkAnalysis, inventory: { items: Record<string, unknown>[] }) {
  const shots: CreationShot[] = [], gaps: string[] = [];
  const first = benchmark.shots[0];
    if (first && !first.needsReview && first.granularity === 'shot' && first.start === 0 && first.end !== null && analysis.analysisMode === 'exact') {
      shots.push({ id: `ref:${referenceId}:${first.shotId}`, sourceId: referenceId, title: '参考视频首镜 · 钩子', description: text(first.visual),
        kind: 'hook', start: first.start, end: first.end, ...(first.clipRef ? { previewUrl: first.clipRef } : {}), evidence: `爆款库 ${referenceId} / ${first.shotId}（仅结构参考）` });
    } else gaps.push('参考首镜缺少已核验的精确逐镜证据，请在灵感爆款补齐分析/复核；不会以整条视频代替首镜。');
    for (const material of inventory.items) {
      if (material.libraryRemovedAt || material.type !== 'video' || isSyntheticMaterial(material) || isReferenceOnlyMaterial(material) || hasReferenceMaterialOrigin(material)) continue;
      const productId = text(material.productId || material.product_id, 200);
      const segments = Array.isArray(material.segments) ? material.segments : [];
      for (const raw of segments) {
        const segment = recordOf(raw);
        if (segment.needsReview !== false && segment.manualConfirmed !== true) continue;
        const start = Number(segment.start); const end = Number(segment.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
        // Classification uses analysed segment attributes, never the asset title.
        const classified = buildBenchmarkAnalysis({ analysis: { gemini: { scriptDetails15s: [{ visual: observedText(segment), environment: text(segment.environment), materialType: segment.materialType }] } } }).shots[0]?.materialType;
        const kind = classified === 'factory' ? 'factory' : productId && productIds.includes(productId) && segment.productVisible === true ? 'product' : null;
        if (!kind) continue;
        const sourceId = text(material.id, 200); const segmentId = text(segment.id, 160);
        if (!sourceId || !segmentId) continue;
        const description = observedText(segment);
        if (!description) continue;
        const url = text(material.url, 2048);
        if (!/^(https?:\/\/|\/(?:api|media|studio-media)\/)/.test(url)) gaps.push(`素材 ${sourceId} 缺少可播放地址；仅保留分析记录，未确认可生产。`);
        shots.push({ id: `mat:${createHash('sha256').update(`${sourceId}:${segmentId}`).digest('hex').slice(0, 32)}`, sourceId, segmentId, title: text(material.name || material.title, 200) || '已分析素材', description,
          kind, start, end, ...(/^(https?:\/\/|\/(?:api|media|studio-media)\/)/.test(url) ? { previewUrl: url } : {}), evidence: `素材库 ${sourceId} / ${segmentId}` });
      }
    }
    shots.sort((a, b) => ['hook', 'factory', 'product'].indexOf(a.kind) - ['hook', 'factory', 'product'].indexOf(b.kind));
    if (!shots.some(shot => shot.kind === 'factory')) gaps.push('暂无经核验的工厂分镜；不会编造工厂能力或画面。');
    if (!shots.some(shot => shot.kind === 'product')) gaps.push('暂无关联所选产品的已核验视频分镜，请补充产品素材分析。');
  return { shots, gaps };
}
