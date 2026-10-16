import type { VideoCreationPlan } from './videoCreationPlan';
import { balancedWeeklyPublishSlots } from '../../shared/contracts/weeklyPublishSchedule';

export function scheduleWeeklyVideos(plans: VideoCreationPlan[], startsAt: string, endsAt: string): VideoCreationPlan[] {
  const hasCompleteExplicitSchedule = plans.length > 0 && plans.every(plan => {
    if (!plan.plannedPublishAt || !Number.isFinite(Date.parse(plan.plannedPublishAt))) return false;
    return Boolean(plan.plannedPublishDate && plan.plannedPublishDate >= startsAt && plan.plannedPublishDate <= endsAt);
  });
  if (hasCompleteExplicitSchedule) return plans.map(plan => ({ ...plan }));
  const slots = balancedWeeklyPublishSlots(
    startsAt,
    endsAt,
    plans.map(plan => `${plan.platform}:${plan.matrix?.accountId || 'planned'}`),
  );
  return plans.map((plan, index) => ({
    ...plan,
    plannedPublishDate: slots[index]?.date || '',
    plannedPublishAt: slots[index]?.scheduledAt || '',
  }));
}
export function weeklyPipelineCards(startsAt: string, endsAt: string, count: number) {
  return [
    { id: 'goal', title: '确认经营与产出目标', agent: 'business' as const, owner: '客户 · 经营 Agent', date: startsAt, output: `确认目标市场、重点产品、账号与每周 ${count} 条视频的产出目标`, dependsOn: [] },
    { id: 'configuration', title: '检查本地与必要服务配置', agent: 'business' as const, owner: '经营 Agent', date: startsAt, output: '核验采集、模型、存储、预算与执行环境；缺项进入补齐任务', dependsOn: ['goal'] },
    { id: 'accounts', title: '检查平台账号与发布授权', agent: 'business' as const, owner: '经营 Agent · 客户', date: startsAt, output: '核对账号归属、连接状态、时区与发布授权；未授权账号等待接入', dependsOn: ['configuration'] },
    { id: 'knowledge', title: '检查企业知识库与产品配置', agent: 'business' as const, owner: '经营 Agent · 客户', date: startsAt, output: '核对企业事实、产品资料、真实素材与使用权，确认语言和承接入口', dependsOn: ['goal'] },
    { id: 'director', title: '采集对标与编导方案', agent: 'director' as const, owner: '编导 Agent', date: startsAt, output: '按目标采集、筛选、分析参考视频，形成脚本和分镜；参考不足继续采集', dependsOn: ['configuration', 'knowledge'] },
    { id: 'production', title: '批量制作成片', agent: 'content' as const, owner: '内容 Agent · 客户', date: startsAt, output: `交付 ${count} 条已完成配音、字幕和剪辑的待验收成片，按最近发布日期优先制作`, dependsOn: ['director'] },
    { id: 'publishing', title: '按平台排期分发', agent: 'business' as const, owner: '经营 Agent', date: startsAt, output: '完成已验收成片的账号匹配与分发排期；每条实际发布任务在下方按平台、账号和时间单独展示', dependsOn: ['production', 'accounts'] },
    { id: 'review', title: '数据追踪与周复盘', agent: 'business' as const, owner: '经营 Agent · 客服 Agent', date: endsAt, output: '逐条追踪发布后 24 小时与 7 天数据、询盘归因，形成周复盘并持续回填延迟数据', dependsOn: ['publishing'] },
  ];
}
