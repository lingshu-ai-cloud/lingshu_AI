import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';

const value = (input: unknown) => String(input || '').trim();

function operatingScope(overview: DigitalEmployeeOverview | null): string {
  const products = value(overview?.config?.focusProducts);
  const markets = value(overview?.config?.targetMarkets);
  return [products && `主推产品「${products}」`, markets && `目标市场「${markets}」`].filter(Boolean).join('、');
}

export function industrySignalsReply(overview: DigitalEmployeeOverview | null): string {
  const signals = overview?.industryTrends?.status === 'available'
    ? overview.industryTrends.signals.slice(0, 3)
    : [];
  const scope = operatingScope(overview);
  if (!signals.length) {
    return `总体结论：当前本地工作区还没有可追溯的行业或社媒信号${scope ? `，暂时无法针对${scope}给出事实判断` : ''}。我不会用无来源内容补齐。\n\n下一步：先在爆款库补充或采集带原始链接的真实内容；政策调整需要单独联网核验后再行动。`;
  }
  const evidence = signals.map((signal, index) => {
    const platform = value(signal.platform) || '公开来源';
    const summary = value(signal.summary) || '请打开原始来源复核完整内容';
    const source = value(signal.sourceUrl) ? `\n[查看原始来源](${signal.sourceUrl})` : '';
    return `${index + 1}. **${value(signal.title) || '社媒行业信号'}**（${platform}）\n${summary}${source}`;
  }).join('\n\n');
  return `总体结论：当前本地记录有 ${signals.length} 条可追溯社媒信号，可作为${scope || '本周内容'}的选题参考；本地数据没有已核验的政策调整，因此不把社媒热度包装成政策结论。\n\n${evidence}\n\n建议行动：先逐条打开原始来源复核，从中只选择一条与${scope || '当前产品和市场'}直接相关的信号做小规模内容测试，再根据真实互动与询盘反馈决定是否扩大。`;
}

export function operatingStrategyReply(overview: DigitalEmployeeOverview | null): string {
  if (!overview?.plan) {
    return '总体结论：当前还没有已确认的周经营策略，我不能把建议冒充成现行计划。\n\n下一步：先确认本周目标、主推产品、目标平台和可用预算，再生成可审核的周计划。';
  }
  const goal = overview.goal?.title ? `本周目标：${overview.goal.title}。` : '本周目标尚未读取到。';
  const run = overview.run?.status ? `执行状态：${overview.run.status}。` : '执行尚未启动。';
  return `总体结论：${overview.plan.strategy || '本周策略已建立，但没有可展示的策略摘要。'}\n\n${goal}\n${run}\n成功标准：${overview.plan.successCriteria?.length ? overview.plan.successCriteria.join('；') : '当前计划没有可展示的成功标准。'}\n\n下一步：优先处理计划中尚未完成的首个真实任务；浏览此回复不会自动启动、发布或扣费。`;
}

export function weeklyTaskReply(overview: DigitalEmployeeOverview | null): string {
  if (!overview?.goal || !overview.plan) {
    return '当前还没有已确认的周经营任务。请先告诉我本周希望达成的业务目标、重点产品和主要平台；生成计划后仍需你确认，才会进入执行。';
  }
  const completed = overview.tasks.filter(task => task.status === 'completed').length;
  const blocked = overview.tasks.filter(task => ['blocked', 'failed'].includes(task.status)).length;
  const preparation = overview.plan.businessPackage?.detailGeneration;
  const missing = preparation?.status === 'blocked' ? preparation.blockers || [] : [];
  const nextStep = missing.some(item => /数字人物|口播|声音/.test(item))
    ? '下一步请先授权可用的数字人物并配置声音；如果不需要口播，也可以调整内容方案。'
    : missing.some(item => /素材|片段/.test(item))
      ? '下一步请先补充已授权的同类视频片段，或调整需要这些片段的镜头。'
      : missing.length ? '下一步请先核对企业、产品及生产资料，补齐后让我重新核验。' : '';
  const readiness = missing.length && !overview.run ? `\n\n目前还没有进入生产，缺少 ${missing.length} 项制作条件。${nextStep}补齐后再逐项核验；不会自动重复启动。` : '';
  return `本周任务：${overview.goal.title}\n\n当前状态：${overview.run?.status || overview.goal.status || '待启动'}；真实任务 ${overview.tasks.length} 项，已完成 ${completed} 项${blocked ? `，受阻或失败 ${blocked} 项` : ''}。${readiness}\n\n计划策略：${overview.plan.strategy || '暂无摘要'}\n\n查看本回复不会自动启动任务。需要继续时，请进入经营总览查看具体任务、依赖和回执。`;
}
