import { showActionSuccess } from '../lib/actionFeedback';
import {
  initialOperatingPlanFingerprint,
  initialPlanMatrixRows,
  initialPlanVideoPlans,
  type InitialOperatingPlan,
} from '../lib/initialOperatingPlan';
import {
  digitalEmployeeApi,
  type DigitalEmployeeConfig,
  type DigitalEmployeeOverview,
  type WeeklyGoal,
} from '../lib/digitalEmployees';
import { EMPTY_GOAL } from './smartBusiness/WeeklyGoalPanel';
import type { EnterpriseOnboardingConfirmation } from '../../shared/contracts/enterpriseOnboarding';

type ConfigurationApi = Pick<typeof digitalEmployeeApi,
  'completeOnboarding' | 'initialPreparation' | 'overview' | 'createGoal' | 'savePackage' | 'startInitialPreparation'>;

interface ConfigurationActionContext {
  data: DigitalEmployeeOverview | null;
  activeRun: boolean;
  overviewRequestVersionRef: { current: number };
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  setData: (value: DigitalEmployeeOverview) => void;
  setWorkspaceView: (value: 'today') => void;
  setNewGoal: (value: boolean) => void;
  setWeeklyPlanOpen: (value: boolean) => void;
  setOnboardingWelcomeOpen: (value: boolean) => void;
  recoverEnterpriseFactsChanged: (error: unknown, staleGoal: Pick<WeeklyGoal, 'id' | 'version'> | null | undefined) => Promise<boolean>;
  api?: ConfigurationApi;
}

export type OnboardingConfigurationInput = DigitalEmployeeConfig & {
  minimalOnboarding?: true;
  brandName?: string;
  initialPlan?: InitialOperatingPlan;
  onboardingConfirmation?: EnterpriseOnboardingConfirmation;
};

export function createDigitalEmployeeConfigurationAction(context: ConfigurationActionContext) {
  const api = context.api || digitalEmployeeApi;
  return async function saveConfig(config: OnboardingConfigurationInput): Promise<boolean> {
    const firstLogin = !context.data?.config;
    const createInitialPlan = Boolean(config.initialPlan && firstLogin && !context.data?.goal && !context.activeRun);
    let recoveryGoal = context.data?.goal;
    context.setBusy(createInitialPlan ? 'initial-plan' : 'config');
    context.setError('');
    context.overviewRequestVersionRef.current += 1;
    try {
      const next = await api.completeOnboarding(config);
      recoveryGoal = next.goal || recoveryGoal;
      if (createInitialPlan && config.initialPlan) {
        const plan = config.initialPlan;
        const planFingerprint = initialOperatingPlanFingerprint(plan);
        const fingerprintConstraint = `首次计划校验：${planFingerprint}`;
        if (!next.config) throw new Error('新手引导配置尚未保存，无法创建首次计划');
        if (next.goal) {
          if (!next.goal.constraints.includes(fingerprintConstraint)) {
            throw new Error('已存在另一版首次计划，不能用当前修改覆盖。请恢复原计划后重试，或在经营页面新建计划。');
          }
          const existingPreparation = await api.initialPreparation(next.goal.id);
          if (existingPreparation.preparation) {
            const resumed = await api.overview(next.goal.id);
            context.overviewRequestVersionRef.current += 1;
            context.setData(resumed);
            context.setWorkspaceView('today');
            context.setNewGoal(false);
            context.setWeeklyPlanOpen(false);
            context.setOnboardingWelcomeOpen(false);
            return true;
          }
        }
        const videoPlans = initialPlanVideoPlans(plan, next.config);
        const created = next.goal ? next : await api.createGoal({
          ...EMPTY_GOAL,
          businessLine: 'content_growth',
          title: '首次推荐经营计划',
          objective: `为 ${plan.products.join('、')} 制作 ${plan.count} 条面向 ${plan.market} 的视频`,
          contentPlatforms: plan.platforms,
          target: plan.count,
          unit: '条',
          scope: plan.market,
          endsAt: plan.deliveryDate,
          constraints: [`制作预算上限：${plan.budgetCapCny} 元`, '真实发布前绑定账号并取得授权', fingerprintConstraint],
          videoPlans,
        });
        recoveryGoal = created.goal || recoveryGoal;
        if (!created.goal) throw new Error('推荐计划创建失败');
        const draftPackage = created.plan?.businessPackage;
        if (!draftPackage?.directorPlan) throw new Error('推荐计划缺少可执行任务包或编导预算');
        const saved = await api.savePackage(created.goal.id, {
          ...draftPackage,
          matrixPlan: initialPlanMatrixRows(plan, next.config),
          tasks: draftPackage.tasks.map(task => task.templateId === 'production' ? { ...task, videoPlans } : task),
          directorPlan: {
            ...draftPackage.directorPlan,
            originalTarget: videoPlans.length,
            platformVersionTarget: videoPlans.length,
            publishTarget: videoPlans.length,
            productionBudget: plan.budgetCapCny,
            productionBudgetMax: plan.budgetCapCny,
            productionBudgetMin: Math.min(draftPackage.directorPlan.productionBudgetMin || 0, plan.budgetCapCny),
          },
        });
        const savedRevision = saved.plan?.businessPackage?.revision;
        if (!savedRevision) throw new Error('已确认计划版本未保存');
        const initialRequestId = `initial-${created.goal.id.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 80)}`;
        await api.startInitialPreparation(created.goal.id, savedRevision, plan, initialRequestId);
        const refreshed = await api.overview(created.goal.id);
        context.overviewRequestVersionRef.current += 1;
        context.setData(refreshed);
        context.setWorkspaceView('today');
        context.setNewGoal(false);
        context.setWeeklyPlanOpen(false);
        context.setOnboardingWelcomeOpen(false);
        return true;
      }
      context.overviewRequestVersionRef.current += 1;
      context.setData(next);
      if (firstLogin) {
        context.setWorkspaceView('today');
        context.setNewGoal(!next.goal);
        context.setOnboardingWelcomeOpen(true);
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('lingshu-assistant-say', {
          detail: { message: '欢迎加入灵枢！准备工作已经完成，接下来我会陪你和四位数字员工一起开始经营。', durationMs: 10_000 },
        })), 350);
      } else {
        showActionSuccess('设置已保存', '新的经营设置会从下一轮计划开始生效。');
      }
      return true;
    } catch (configError) {
      if (await context.recoverEnterpriseFactsChanged(configError, recoveryGoal)) {
        if (config.minimalOnboarding) throw configError;
        return false;
      }
      context.setError(configError instanceof Error ? configError.message : createInitialPlan ? '推荐计划制作准备失败' : '设置保存失败');
      if (config.minimalOnboarding) throw configError;
      return false;
    } finally {
      context.setBusy('');
    }
  };
}
