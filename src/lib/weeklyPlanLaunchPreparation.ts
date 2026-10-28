import { digitalEmployeeApi } from './digitalEmployeeApi';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import { weeklyStartResultNeedsReconciliation } from './weeklyStartValidation';

export type WeeklyPlanLaunchPreparationApi = Pick<
  typeof digitalEmployeeApi,
  'generatePackageDetails' | 'overview'
>;

export type WeeklyPlanLaunchPreparationOptions = {
  api?: WeeklyPlanLaunchPreparationApi;
  onObserved?: (overview: DigitalEmployeeOverview) => void;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  maxWaitMs?: number;
};

function preparationFailureMessage(
  overview: DigitalEmployeeOverview,
  goalId: string,
  fallback?: unknown,
): string {
  const detail = overview.goal?.id === goalId
    ? overview.plan?.businessPackage?.detailGeneration
    : undefined;
  if (detail?.status === 'generating') {
    return '任务包正在准备，尚未启动本周任务；请稍后再次确认，系统会复用已保存的准备结果。';
  }
  if (detail?.status === 'blocked') {
    return `任务包准备未通过：${detail.blockers.join('；') || '请先补齐制作条件'}。本周任务尚未启动。`;
  }
  return fallback instanceof Error
    ? fallback.message
    : '任务包准备结果待确认，本周任务尚未启动。';
}

/**
 * Produces and verifies the persisted video preparation required by the server
 * before a weekly run can exist. Every UI entry point must use this boundary so
 * an approval can never race ahead of the prepared package revision.
 */
export async function prepareWeeklyPlanForLaunch(
  source: DigitalEmployeeOverview,
  options: WeeklyPlanLaunchPreparationOptions = {},
): Promise<DigitalEmployeeOverview> {
  const goal = source.goal;
  const pack = source.plan?.businessPackage;
  if (!goal) throw new Error('尚未创建本周目标，请先完成目标设置。');
  if (!pack) throw new Error('本周计划尚未生成完整，请刷新后重试。');

  const masterPlans = (pack.tasks || [])
    .find(task => task.templateId === 'production')?.videoPlans
    ?.filter(plan => plan.productionRole !== 'platform_adaptation') || [];
  if (!masterPlans.length) return source;
  if (pack.referenceSourcePolicy === 'existing_library_only') {
    const clonePlans = masterPlans.filter(plan => plan.route === 'clone');
    const missing = clonePlans.filter(plan => !plan.referenceId);
    if (missing.length) {
      throw new Error(`本周 ${clonePlans.length} 条复刻视频中有 ${missing.length} 条尚未绑定通过逐镜精确分析的爆款参考，不能开始生产。请先到灵感集市完成参考分析，再重新匹配本周计划；本次未提交付费制作。`);
    }
  }

  const api = options.api || digitalEmployeeApi;
  const wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const now = options.now || Date.now;
  const deadline = now() + (options.maxWaitMs ?? 30 * 60_000);
  let prepared: DigitalEmployeeOverview;
  try {
    prepared = await api.generatePackageDetails(goal.id);
  } catch (preparationError) {
    if (!weeklyStartResultNeedsReconciliation(preparationError)) throw preparationError;
    try {
      prepared = await api.overview(goal.id);
    } catch {
      throw new Error('任务包准备请求已经发出，但暂未取得可确认的结果；本周任务尚未启动，请稍后再次确认。');
    }
    if (!prepared.plan?.businessPackage?.detailGeneration) throw new Error(preparationFailureMessage(prepared, goal.id, preparationError));
  }

  while (true) {
    if (prepared.goal?.id !== goal.id || !prepared.plan?.businessPackage) {
      throw new Error('任务包准备结果与当前周目标不一致，本周任务尚未启动。');
    }
    if (prepared.plan.businessPackage.revision !== pack.revision) {
      throw new Error('周计划已被修改，请重新确认方案和预算，本周任务尚未启动。');
    }
    const detail = prepared.plan.businessPackage.detailGeneration;
    if (detail?.status === 'ready') return prepared;
    options.onObserved?.(prepared);
    if (detail?.status !== 'generating') throw new Error(preparationFailureMessage(prepared, goal.id));
    if (now() >= deadline) throw new Error('任务包仍在准备，本周任务尚未启动。请稍后查看进度；系统不会重复提交准备请求。');
    await wait(2_000);
    try {
      prepared = await api.overview(goal.id);
    } catch {
      throw new Error('任务包正在准备，但暂时无法读取进度。本周任务尚未启动，请稍后查看；系统不会重复提交准备请求。');
    }
  }
}
