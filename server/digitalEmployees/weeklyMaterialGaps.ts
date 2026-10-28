import type { VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';
import type { FixedYieldLocalMaterialRequirement } from './productionOnboardingPreflight.js';

export interface WeeklyMaterialGap {
  requirementId: string;
  video: string;
  product: string;
  shot: number;
  footage: string;
  minimumSeconds: number;
  productId: string | null;
  materialType: FixedYieldLocalMaterialRequirement['materialType'];
  referenceThumbnailUrl: string | null;
  referenceVideoUrl: string | null;
  shotFirstFrameRef: string | null;
  shotStartSeconds: number;
}

const fallback: Record<string, string> = {
  P2A_HANDHELD_PRODUCT_WALL: '手持产品实拍', P2B_PRODUCT_SHELF: '产品陈列实拍',
  P2C_PACKAGE_DETAIL: '包装细节实拍', P2D_PRODUCT_MOTION: '产品运镜实拍',
  P3A_WORKER_PROCESS: '工人操作实拍', P3B_MACHINE_CLOSEUP: '设备特写实拍',
  P3C_QC_PACKING: '质检或包装实拍', P3D_FACTORY_ESTABLISH: '工厂环境实拍',
  P4A_USAGE_SETUP: '产品使用前场景', P4B_USAGE_ACTION: '产品使用过程', P4C_USAGE_RESULT: '产品使用效果',
  P5A_EXHIBITION: '展会或展位实拍', P5B_CUSTOMER_CASE: '客户案例实拍',
  P5C_LOGISTICS_WAREHOUSE: '仓储或发货实拍', P5D_VERIFIED_FACT: '可证明企业事实的实拍',
  P5E_BRAND_CTA: '品牌结尾实拍',
};

export function weeklyMaterialGaps(
  plans: VideoCreationPlan[], requirements: FixedYieldLocalMaterialRequirement[],
): WeeklyMaterialGap[] {
  return requirements.flatMap(item => {
    const plan = plans[item.planIndex];
    const shot = plan?.benchmarkAnalysis?.shots[item.shotIndex];
    if (!plan || !shot) return [];
    const visual = String(shot.visual || '').replace(/\s+/g, ' ').trim();
    const category = fallback[item.archetypeId] || '对应场景实拍';
    const footage = visual && !/^(暂无|未知|未分析|待分析|unknown)/i.test(visual)
      ? `${category}（参考画面：${visual.slice(0, 80)}）` : category;
    return [{
      requirementId: item.requirementId,
      video: `视频 ${item.planIndex + 1}：${String(plan.theme || plan.publication?.title || '未命名视频').trim().slice(0, 68)}`,
      product: String(plan.productName || '').trim().slice(0, 60),
      shot: item.shotIndex + 1,
      footage: footage.slice(0, 120),
      minimumSeconds: Math.ceil(item.requiredDurationSeconds),
      productId: plan.productId || null,
      materialType: item.materialType,
      referenceThumbnailUrl: plan.preproduction?.benchmark.thumbnailUrl
        || plan.planningEvidence?.referenceThumbnailUrl
        || (plan.referenceId ? `/api/overseas/videos/${encodeURIComponent(plan.referenceId)}/thumbnail` : null),
      referenceVideoUrl: plan.referenceId
        ? `/api/overseas/videos/${encodeURIComponent(plan.referenceId)}/media-url` : null,
      shotFirstFrameRef: shot.firstFrameRef || null,
      shotStartSeconds: typeof shot.start === 'number' && Number.isFinite(shot.start) ? Math.max(0, shot.start) : 0,
    }];
  });
}
