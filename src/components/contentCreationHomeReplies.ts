import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import type { WeeklyProductionReadiness } from '../lib/digitalEmployeeApi';

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

export function weeklyTaskReply(overview: DigitalEmployeeOverview | null, readiness?: WeeklyProductionReadiness | null): string {
  if (!overview?.goal || !overview.plan) {
    return '这周还没有可启动的计划。告诉我你想推广的产品、目标市场和平台，我会先整理计划给你确认。';
  }
  const completed = overview.tasks.filter(task => task.status === 'completed').length;
  const blocked = overview.tasks.filter(task => ['blocked', 'failed'].includes(task.status));
  const preparation = overview.plan.businessPackage?.detailGeneration;
  const missing = preparation?.status === 'blocked' ? preparation.blockers || [] : [];
  const missingText = missing.join('；');
  const needs: string[] = [];
  if (/数字人物|口播|声音/.test(missingText)) needs.push('可用的数字人物和声音');
  if (/素材|片段/.test(missingText)) needs.push('已授权、能用于制作的产品或场景素材');
  if (/产品资料|产品图|企业资料/.test(missingText)) needs.push('主推产品的资料和图片');
  if (missing.length && !needs.length) needs.push('本周制作所需的资料');
  if (!overview.run) {
    if (!readiness) return '本周计划还没有开始。制作资料的最新状态暂时无法核验，我不会让你在原因不明时直接启动。请稍后重新查询。';
    const codes = new Set(readiness.blockers.map(item => item.code));
    if (codes.has('enterprise_facts_mismatch')) {
      return '本周计划还没有开始。\n\n你更新了企业资料，这份计划还没同步到最新内容。\n\n点击“同步周计划”，我会更新这份计划供你重新确认；不会自动开始生产。';
    }
    const gaps = [
      codes.has('production_preferences_missing') && '成片语言、画幅等制作偏好',
      codes.has('company_profile_missing') && '企业名称与主营资料',
      codes.has('brand_profile_missing') && '品牌名称与表达资料',
      codes.has('product_facts_missing') && '主推产品资料和图片',
      (codes.has('public_contact_missing') || codes.has('primary_cta_missing')) && '对外联系方式与行动引导',
      (codes.has('presenter_missing') || codes.has('voice_missing')) && '可用的数字人物与声音',
      codes.has('local_material_missing') && '对应镜头可用的视频素材',
    ].filter((item): item is string => Boolean(item));
    if (readiness.blockers.length && !gaps.length) gaps.push('本周制作所需的资料');
    if (gaps.length) {
      if (codes.has('local_material_missing') && gaps[0] === '对应镜头可用的视频素材') {
        return `本周计划还没有开始。\n\n有 ${readiness.materialGaps?.length || '待核对'} 个镜头还缺可用实拍，预览如下。\n\n先补充视频素材。上传并完成分析后，再重新核验周计划。`;
      }
      const first = codes.has('production_preferences_missing') ? '先确认制作偏好。'
        : codes.has('company_profile_missing') || codes.has('brand_profile_missing') ? '先补齐企业与品牌资料。'
          : codes.has('product_facts_missing') ? '先补齐主推产品资料和图片。'
            : codes.has('public_contact_missing') || codes.has('primary_cta_missing') ? '先填写对外联系方式。'
              : codes.has('presenter_missing') || codes.has('voice_missing') ? '先录入数字人物与声音。'
                : codes.has('local_material_missing') ? '先上传对应镜头的视频素材。' : '先补齐制作资料。';
      return `本周计划还没有开始。\n\n当前需要处理：${gaps[0]}。\n\n${first}`;
    }
    return '本周计划还没有开始。制作资料已齐，目前只差你确认周计划；点击下方按钮核对后再决定是否启动。';
  }
  const runStatus = overview.run.status === 'succeeded' ? '本周计划已完成。'
    : overview.run.status === 'paused' ? '本周计划已暂停。'
      : ['failed', 'cancelled'].includes(overview.run.status) ? '本周计划目前无法继续。' : '本周计划已开始。';
  const blockedTitle = blocked[0]?.title;
  const progress = completed ? `已完成 ${completed} 项。` : '目前还没有完成的任务。';
  const blockedReason = blocked.map(task => task.blocked_reason || '').join('；');
  if (blocked.length && /数字人物|数字人|HeyGen|声音|口播/.test(blockedReason)) {
    return `本周生产需要处理：${blockedTitle ? `「${blockedTitle}」` : '一项制作任务'}还缺可用的数字人物与声音。\n\n先录入数字人物与声音。点击下方“录入数字人”，我会在这里打开录入窗口；保存后再继续核验原任务。`;
  }
  if (blocked.length && /素材|片段/.test(blockedReason)) {
    return `本周生产需要处理：${blockedTitle ? `「${blockedTitle}」` : '一项制作任务'}还缺视频素材，预览如下。\n\n先补充视频素材。原任务会保留，上传并完成分析后再重新核验。`;
  }
  if (blocked.length && /产品资料|产品图/.test(blockedReason)) {
    return `本周生产需要处理：${blockedTitle ? `「${blockedTitle}」` : '一项制作任务'}还缺产品资料和图片。\n\n先补齐主推产品资料和图片。原任务会保留，补齐后再继续核验。`;
  }
  const attention = blocked.length ? `还有 ${blocked.length} 项需要处理${blockedTitle ? `，先处理「${blockedTitle}」` : ''}。${needs.length ? `需要补齐：${needs.join('；')}。` : `当前记录的原因：${blockedReason || '系统尚未提供具体缺口，暂时无法让你补录。'}。请在这里重新核验，不要重复启动任务。`}`
    : ['failed', 'paused', 'cancelled'].includes(overview.run.status) ? '请打开周计划查看暂停原因和下一步。' : '目前没有发现需要你补充的制作条件。';
  return `${runStatus}${progress}\n\n${attention}`;
}
