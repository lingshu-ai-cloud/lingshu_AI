import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import { socialContentCurrentArtifacts } from './socialContentModel';

export interface SocialContentWeeklyPlan {
  targetCount: number;
  completedCount: number;
  reviewCount: number;
  needUserAction: string;
  budgetLabel: string;
  materialCount: number;
  referenceCount: number;
  shootingGap: boolean;
  shootingLabel: string;
  productionLanes: Array<{ label: string; status: string }>;
}

function money(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

export function buildSocialContentWeeklyPlan(task: SocialContentTaskDetail): SocialContentWeeklyPlan {
  const artifacts = socialContentCurrentArtifacts(task.artifacts);
  const activeSources = task.sources.filter(source => source.status === 'active');
  const materialCount = activeSources.filter(source => source.kind === 'material').length;
  const referenceCount = activeSources.filter(source => source.kind === 'reference_link').length;
  const reviewCount = artifacts.filter(artifact => artifact.status === 'review_required').length;
  const completedCount = artifacts.filter(artifact => artifact.status === 'approved').length;
  const targetCount = task.brief.requestedOutputCount ?? Math.max(artifacts.length, 1);
  const shootingGap = materialCount === 0;

  let needUserAction = '当前无需处理';
  if (!task.readiness.complete) needUserAction = `补充 ${task.readiness.missing.length} 项资料`;
  else if (reviewCount > 0) needUserAction = `验收 ${reviewCount} 项内容`;
  else if (artifacts.some(artifact => artifact.status === 'changes_requested')) needUserAction = '查看本批修改进度';
  else if (shootingGap && ['plan_review', 'producing', 'attention'].includes(task.status)) needUserAction = '处理集中补拍';

  const weeklyBudget = task.brief.weeklyBudgetCny ?? null;
  const budgetLabel = weeklyBudget === null
    ? '待设置'
    : `${money(weeklyBudget)} 上限`;
  const shootingLabel = shootingGap
    ? task.brief.shootingWindowMinutes == null
      ? '需确认一次集中补拍'
      : `可安排 ${task.brief.shootingWindowMinutes} 分钟集中拍摄`
    : '现有素材可先行生产';

  return {
    targetCount,
    completedCount,
    reviewCount,
    needUserAction,
    budgetLabel,
    materialCount,
    referenceCount,
    shootingGap,
    shootingLabel,
    productionLanes: [
      { label: '现有素材制作', status: materialCount > 0 ? `已关联 ${materialCount} 项素材` : '等待产品素材' },
      { label: '产品展示内容', status: task.brief.productRef ? '纳入本周计划' : '等待产品信息' },
      { label: '结构变体测试', status: referenceCount > 0 ? `分析 ${referenceCount} 条参考` : '按历史表现安排' },
    ],
  };
}
