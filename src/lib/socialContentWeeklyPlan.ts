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
  managedSupplyActive: boolean;
  assetSupplyLabel: string;
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
  const managedSupplyActive = materialCount === 0;

  let needUserAction = '当前无需处理';
  if (!task.readiness.complete) needUserAction = `补充 ${task.readiness.missing.length} 项资料`;
  else if (reviewCount > 0) needUserAction = `验收 ${reviewCount} 项内容`;
  else if (artifacts.some(artifact => artifact.status === 'changes_requested')) needUserAction = '查看本批修改进度';

  const weeklyBudget = task.brief.weeklyBudgetCny ?? null;
  const budgetLabel = weeklyBudget === null
    ? '待设置'
    : `${money(weeklyBudget)} 上限`;
  const assetSupplyLabel = managedSupplyActive
    ? '系统将用数字人、合规素材、信息图或生成画面自动补齐，无需补拍'
    : '优先保护并加工客户现有素材';

  return {
    targetCount,
    completedCount,
    reviewCount,
    needUserAction,
    budgetLabel,
    materialCount,
    referenceCount,
    managedSupplyActive,
    assetSupplyLabel,
    productionLanes: [
      { label: '画面供给', status: materialCount > 0 ? `已关联 ${materialCount} 项客户素材` : '零素材托管生成，无需补拍' },
      { label: '产品与事实', status: task.brief.productRef ? '纳入本周计划' : '只使用通用安全表达' },
      { label: '脚本与结构', status: referenceCount > 0 ? `逐镜分析 ${referenceCount} 条参考` : '由编导 Agent 按主题组织' },
    ],
  };
}
