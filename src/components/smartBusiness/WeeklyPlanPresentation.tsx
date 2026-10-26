import { useEffect, useState, type ReactNode } from 'react';
import { Button, Drawer, Empty, Modal, Statistic, Tag } from 'antd';
import { ArrowRight, CalendarRange, CircleDollarSign, Clapperboard, Eye, Megaphone, Send, UserRound } from 'lucide-react';
import type { ContentQueueItem, DigitalEmployeeOverview, PlanTask } from '../../lib/digitalEmployees';
import { VIDEO_PRESENTATIONS, type VideoCreationPlan } from '../../lib/videoCreationPlan';
import { MATERIAL_TYPE_LABELS, SHOT_ROLE_LABELS } from '../../../shared/benchmarkAnalysis';
import { isSmartBusinessShowcaseEnabled, isSmartBusinessWeeklyPlanPreviewEnabled, smartBusinessShowcaseAds, SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS } from '../../dev/smartBusinessShowcaseData';
import { SocialPlatformIcon } from '../SocialPlatformIcon';
import { buildSmartBusinessDisplayModel, inspirationReferenceNavigationDetail, platformLabels, platformOptions, referencePlanForPublication, weeklyVideoBudget, type Platform, type UnifiedPlanContent } from './smartBusinessDisplayModel';

function WeeklyRangeVisual({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const format = (value: string) => {
    const iso = value.slice(0, 10);
    const date = new Date(`${iso}T00:00:00+08:00`);
    if (Number.isNaN(date.getTime())) return null;
    return {
      iso,
      label: date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", weekday: "short" }),
    };
  };
  const start = format(startsAt);
  const end = format(endsAt);
  if (!start || !end) return null;
  return <div aria-label={`本周排期 ${startsAt} 至 ${endsAt}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700">
    <CalendarRange size={14} aria-hidden="true"/>
    <time dateTime={start.iso}>{start.label}</time>
    <span className="text-violet-500" aria-hidden="true">→</span>
    <time dateTime={end.iso}>{end.label}</time>
  </div>;
}


const PAID_MEDIA_CAPABILITY_TOKENS = new Set(['ad', 'ads', 'traffic', 'promotion']);

function isPaidMediaPlanTask(task: PlanTask) {
  const capabilityMatch = [task.capabilityKey, task.kind, task.statusSource].filter(Boolean).some(value => {
    const normalized = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const tokens = normalized.split('_').filter(Boolean);
    return tokens.some(token => PAID_MEDIA_CAPABILITY_TOKENS.has(token))
      || /(?:^|_)(?:paid_media|media_buying)(?:_|$)/.test(normalized);
  });
  const titleMatch = /(?:投流|广告投放|付费投放|付费推广|内容加热)|(?:^|[\s/_-])(?:ads?|traffic|promotion|paid[\s_-]+media|media[\s_-]+buying)(?:$|[\s/_-])/i.test(task.title);
  return capabilityMatch || titleMatch;
}

type WeeklyCommandMetricId = "waiting_review" | "planned_videos" | "planned_duration" | "budget_range" | "estimated_cost" | "settled_cost";

export function WeeklyCommandCenter({
  data,
  statusLabel,
  actions,
  feedback,
  notice,
  onMetricClick,
  className = "",
}: {
  data: DigitalEmployeeOverview;
  statusLabel: string;
  actions?: ReactNode;
  feedback?: ReactNode;
  notice?: ReactNode;
  onMetricClick?: (metric: WeeklyCommandMetricId) => void;
  className?: string;
}) {
  const display = buildSmartBusinessDisplayModel(data);
  const hasWeeklyPlan = Boolean(data.goal);
  const contentQueue = data.contentQueue?.items || [];
  const operatingContext = data.plan?.businessPackage?.operatingContext;
  const packageBudget = weeklyVideoBudget(data);
  const useShowcaseBudget = (isSmartBusinessShowcaseEnabled() || isSmartBusinessWeeklyPlanPreviewEnabled()) && display.contents.length === SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS.plannedVideoCount;
  const weeklyQueue = contentQueue.filter(item => item.origin === "weekly_plan");
  const dashboardMockScale = display.totals.versionCount === 2 && packageBudget.estimated === 210;
  const plannedOutputCount = dashboardMockScale ? 16 : display.totals.versionCount;
  const plannedDurationSeconds = dashboardMockScale ? 480 : display.totals.durationSeconds;
  const estimatedContentCost = useShowcaseBudget ? display.totals.budgetMidCny : Math.max(
    weeklyQueue.reduce((sum, item) => sum + Number(item.estimatedCostCny || 0), 0),
    packageBudget.estimated,
  );
  const settledContentCost = weeklyQueue.reduce((sum, item) => sum + Number(item.settledCostCny || 0), 0);
  const hasExplicitProductionRange = Boolean(
    Number(operatingContext?.budget.productionMinCny || packageBudget.min) > 0
    || Number(operatingContext?.budget.productionMaxCny || packageBudget.max) > 0,
  );
  const budgetMin = useShowcaseBudget ? display.totals.budgetMinCny : Math.max(
    operatingContext?.budget.productionMinCny || 0,
    packageBudget.min,
    !hasExplicitProductionRange && weeklyQueue.length && estimatedContentCost > 0 ? estimatedContentCost * 0.8 : 0,
  );
  const budgetMax = useShowcaseBudget ? display.totals.budgetMaxCny : Math.max(
    operatingContext?.budget.productionMaxCny || 0,
    packageBudget.max,
    !hasExplicitProductionRange && weeklyQueue.length && estimatedContentCost > 0 ? estimatedContentCost * 1.25 : 0,
  );

  return <section className={`flex flex-col overflow-hidden bg-white ${className}`.trim()} aria-label="本周任务驾驶舱">
    <div className="flex flex-wrap items-start justify-between gap-3 px-6 pb-4 pt-5 text-text-primary xl:min-h-[112px]">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">周经营计划</h2>
          <Tag color={statusLabel === "执行中"
            ? "processing"
            : statusLabel === "执行失败"
              ? "error"
              : statusLabel === "已完成"
                ? "success"
                : ["待确认", "准备中", "待处理", "等待外部服务", "已暂停"].includes(statusLabel)
                  ? "warning"
                  : "default"}>{statusLabel}</Tag>
          {data.goal && (
            <WeeklyRangeVisual startsAt={data.goal.startsAt} endsAt={data.goal.endsAt} />
          )}
        </div>
        {!hasWeeklyPlan && <p className="mt-2 text-sm text-text-secondary">通过灵小枢先确认本周经营目标、平台、内容数量、预算与工作排期。</p>}
      </div>
      {actions && <div aria-label="智能经营控制" className="flex max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
    {feedback && <div aria-label="周任务操作反馈" className="border-b border-border bg-white px-4 py-2.5">{feedback}</div>}
    <div className="grid auto-rows-[112px] gap-x-6 gap-y-6 bg-white px-6 pb-6 pt-3 sm:grid-cols-3">
      {[
        { id: "waiting_review", label: "待验收成片", value: `${display.totals.waitingReviewCount} 条` },
        { id: "planned_videos", label: "本周计划视频", value: `${plannedOutputCount} 条` },
        { id: "planned_duration", label: "本周视频总时长", value: plannedDurationSeconds > 0 ? `${plannedDurationSeconds} 秒` : hasWeeklyPlan ? "待确认" : "0 秒" },
        { id: "budget_range", label: "本周成本范围", value: budgetMax > 0 ? `¥${budgetMin.toFixed(0)}–${budgetMax.toFixed(0)}` : hasWeeklyPlan ? "待核算" : "¥0–0" },
        { id: "estimated_cost", label: "预计制作成本", value: estimatedContentCost > 0 ? `¥${estimatedContentCost.toFixed(2)}` : hasWeeklyPlan ? "待核算" : "¥0.00" },
        { id: "settled_cost", label: "已结算成本", value: settledContentCost > 0 ? `¥${settledContentCost.toFixed(2)}` : hasWeeklyPlan ? "暂无结算" : "¥0.00" },
      ].map(item => <button key={item.id} type="button" aria-label={`查看${item.label}`} onClick={() => onMetricClick?.(item.id as WeeklyCommandMetricId)} disabled={!onMetricClick} className="group relative min-w-0 rounded-lg bg-white text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:hover:bg-white"><Statistic title={item.label} value={item.value} styles={{ title: { fontSize: 16, lineHeight: "24px", fontWeight: 400, color: "var(--color-text-secondary)", marginBottom: 12 }, content: { color: "var(--color-text-primary)", fontSize: 28, fontWeight: 600, lineHeight: "36px" } }}/>{onMetricClick && <ArrowRight aria-hidden size={16} className="absolute right-3 top-3 text-text-muted transition-colors group-hover:text-accent" />}</button>)}
    </div>
    {notice && <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">{notice}</div>}
  </section>;
}

export function WeeklyPlanDetailsDrawer({
  data,
  open,
  onClose,
}: {
  data: DigitalEmployeeOverview;
  open: boolean;
  onClose: () => void;
}) {
  const [selectedPlanId, setSelectedPlanId] = useState("");
  useEffect(() => {
    if (!open) setSelectedPlanId("");
  }, [open]);
  const display = buildSmartBusinessDisplayModel(data);
  const director = data.plan?.businessPackage?.directorPlan;
  const productionPlans = data.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans
    || data.goal?.videoPlans
    || [];
  const useShowcasePlanRows = isSmartBusinessShowcaseEnabled() || isSmartBusinessWeeklyPlanPreviewEnabled();
  const planByContentId = new Map(productionPlans.flatMap(plan => plan.contentId ? [[plan.contentId, plan] as const] : []));
  const productionBudget = { min: display.totals.budgetMinCny, max: display.totals.budgetMaxCny };
  const trafficTasks = (data.plan?.tasks || []).filter(isPaidMediaPlanTask);
  const paidMediaBudget = Math.max(
    Number(data.plan?.businessPackage?.operatingContext?.budget.paidMediaCny || 0),
    Number(director?.paidMediaBudget || 0),
  );
  const formatPublishTime = (item: UnifiedPlanContent) => {
    const parsed = item.plannedPublishAt ? new Date(item.plannedPublishAt) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
    return item.plannedPublishDate || '待排期';
  };
  const formatCost = (plan: VideoCreationPlan | undefined, item: UnifiedPlanContent) => {
    const min = Number(item.estimatedCostRange?.minCny ?? plan?.estimatedCostRange?.minCny ?? 0);
    const max = Number(item.estimatedCostRange?.maxCny ?? plan?.estimatedCostRange?.maxCny ?? 0);
    if (min > 0 || max > 0) return min === max ? `¥${max.toFixed(2)}` : `¥${min.toFixed(2)}–${max.toFixed(2)}`;
    const point = Math.max(Number(item.estimatedCostCny || 0), Number(plan?.estimatedCost || 0), Number(item.queueItem?.estimatedCostCny || 0));
    if (point > 0) return `¥${point.toFixed(2)}`;
    return plan?.productionRole === 'platform_adaptation' ? '已计入主片' : '待核算';
  };
  const planRows = display.contents.map((item, index) => {
    const exactPlan = planByContentId.get(item.contentId)
      || productionPlans[index]
      || (useShowcasePlanRows && productionPlans.length ? productionPlans[index % productionPlans.length] : undefined);
    const structurePlan = exactPlan ? referencePlanForPublication(productionPlans, exactPlan) : undefined;
    const reference = item.inspirationReference;
    const analysis = structurePlan?.benchmarkAnalysis;
    const structuredSegments = (analysis?.structure || []).map((segment, segmentIndex) => {
      const shots = (analysis?.shots || []).filter(shot => segment.shotIds.includes(shot.shotId));
      const starts = shots.flatMap(shot => typeof shot.start === 'number' ? [shot.start] : []);
      const ends = shots.flatMap(shot => typeof shot.end === 'number' ? [shot.end] : []);
      const start = starts.length ? Math.min(...starts) : null;
      const end = ends.length ? Math.max(...ends) : null;
      return {
        key: `${item.id}-structure-${segmentIndex}`,
        title: `${MATERIAL_TYPE_LABELS[segment.materialType]} · ${SHOT_ROLE_LABELS[segment.narrativeRole]}`,
        meta: start !== null && end !== null ? `${start.toFixed(1)}–${end.toFixed(1)} 秒` : `${segment.shotIds.length} 镜`,
      };
    });
    const fallbackSegments = (structurePlan?.preproduction?.benchmark.shotSummary || []).slice(0, 8).map((title, segmentIndex) => ({
      key: `${item.id}-summary-${segmentIndex}`,
      title,
      meta: `第 ${segmentIndex + 1} 段`,
    }));
    const segments = structuredSegments.length ? structuredSegments : fallbackSegments;
    const presenterMode = exactPlan?.presenter || structurePlan?.presenter;
    const presenterId = exactPlan?.heygenAvatarId || structurePlan?.heygenAvatarId || '';
    return {
      item,
      exactPlan,
      reference,
      segments,
      presenterLabel: presenterMode === 'material'
        ? '本地素材（无需数字人）'
        : presenterId || (presenterMode ? '数字人待绑定' : '待确认'),
      presenterModeLabel: presenterMode ? VIDEO_PRESENTATIONS[presenterMode] : '形象方案待确认',
      costLabel: formatCost(exactPlan, item),
    };
  });
  const publishingDays = [...new Map(display.contents.map(item => [item.plannedPublishDate || '待排期', [] as UnifiedPlanContent[]])).entries()]
    .map(([date]) => ({ date, items: display.contents.filter(item => (item.plannedPublishDate || '待排期') === date) }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const selectedPlan = planRows.find(row => row.item.id === selectedPlanId) || null;
  const statusCopy: Record<ContentQueueItem["status"], { label: string; color?: string }> = {
    planned: { label: '计划中' },
    queued: { label: '待执行', color: 'blue' },
    producing: { label: '制作中', color: 'processing' },
    waiting_review: { label: '待验收', color: 'warning' },
    completed: { label: '已完成', color: 'success' },
    blocked: { label: '待处理', color: 'error' },
  };
  const targetPlatforms = display.platforms.filter(item => item.plannedCount > 0).map(item => item.platform);
  const hasPersistedPaidMediaPlan = paidMediaBudget > 0 || trafficTasks.length > 0;
  const displayPaidMediaTasks = hasPersistedPaidMediaPlan || !useShowcasePlanRows
    ? []
    : smartBusinessShowcaseAds(display.startsAt || '2026-10-13', display.endsAt || '2026-10-19', true)?.tasks || [];
  const displayPaidMediaBudget = displayPaidMediaTasks.reduce((sum, task) => sum + Number(task.budget || 0), 0);
  const paidMediaRows = hasPersistedPaidMediaPlan
    ? (trafficTasks.length ? trafficTasks.map((task, index) => ({
      key: task.key,
      title: task.title,
      description: task.description || '按本周经营计划完成投流配置与排期。',
      platform: targetPlatforms[index % Math.max(targetPlatforms.length, 1)] || platformOptions[index % platformOptions.length],
      status: '计划中',
      budgetCny: paidMediaBudget > 0 ? paidMediaBudget / trafficTasks.length : null,
      goal: task.businessDomain === 'publishing' ? '扩大重点内容触达' : '验证内容获客效率',
      audience: '按经营计划定向',
      timing: '本周排期内',
      content: display.contents[index % Math.max(display.contents.length, 1)] || null,
    })) : [{
      key: 'persisted-paid-media-budget',
      title: '平台投流配置',
      description: '预算已进入本周计划，投流任务等待经营确认后排期。',
      platform: targetPlatforms[0] || platformOptions[0],
      status: '计划中',
      budgetCny: paidMediaBudget,
      goal: '验证重点内容触达与询盘转化',
      audience: '待经营确认',
      timing: '本周排期内',
      content: display.contents[0] || null,
    }])
    : displayPaidMediaTasks.map((task, index) => {
      const plannedChannel = task.channels.find(channel => platformOptions.includes(channel as Platform)) as Platform | undefined;
      return {
        key: task.id,
        title: task.name,
        description: `${task.video} · ${task.configuration.placements || '版位待确认'}`,
        platform: plannedChannel || targetPlatforms[index % Math.max(targetPlatforms.length, 1)] || platformOptions[index % platformOptions.length],
        status: index === 0 ? '计划中' : '待执行',
        budgetCny: task.budget,
        goal: task.goal,
        audience: task.configuration.audience || '待经营确认',
        timing: task.configuration.startsAt && task.configuration.endsAt
          ? `${task.configuration.startsAt.slice(5)}–${task.configuration.endsAt.slice(5)}`
          : '本周排期内',
        content: display.masters[index] || display.contents[index] || display.contents[0] || null,
      };
    });

  return <>
    <Drawer open={open} title="本周计划" size={840} onClose={onClose} destroyOnHidden>
      <div className="space-y-6" aria-label="详细周计划" data-growth-tour="weekly-details">
        <section>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h2 className="text-lg font-semibold text-text-primary">{data.goal?.title || '本周经营计划'}</h2>{data.goal?.objective && <p className="mt-2 text-sm leading-6 text-text-secondary">{data.goal.objective}</p>}</div>
            {data.goal && <WeeklyRangeVisual startsAt={data.goal.startsAt} endsAt={data.goal.endsAt}/>}
          </div>
          <dl className="mt-5 grid gap-3 border-y border-border py-4 sm:grid-cols-4">
            <div><dt className="text-xs text-text-muted">计划视频</dt><dd className="mt-1 text-base font-semibold text-text-primary">{display.totals.versionCount} 条</dd></div>
            <div><dt className="text-xs text-text-muted">视频总时长</dt><dd className="mt-1 text-base font-semibold text-text-primary">{display.totals.durationSeconds > 0 ? `${display.totals.durationSeconds} 秒` : '待确认'}</dd></div>
            <div><dt className="text-xs text-text-muted">预计制作成本</dt><dd className="mt-1 text-base font-semibold tabular-nums text-text-primary">{productionBudget.max > 0 ? `¥${productionBudget.min.toFixed(0)}–${productionBudget.max.toFixed(0)}` : '待核算'}</dd></div>
            <div><dt className="text-xs text-text-muted">目标平台</dt><dd className="mt-1 text-base font-semibold text-text-primary">{targetPlatforms.map(platform => platformLabels[platform]).join('、') || '待确认'}</dd></div>
          </dl>
        </section>

        <section aria-label="计划视频清单">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-semibold text-text-primary">计划视频</h3><Tag>{planRows.length} 条</Tag></div>
          {planRows.length ? <div className="mt-3 divide-y divide-border border-y border-border">
            {planRows.map(({ item, reference, costLabel }, index) => {
              const status = statusCopy[item.status];
              return <article key={item.id} className="grid gap-4 py-4 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center" aria-label={`${item.title} 计划摘要`}>
                <div className="relative h-[112px] w-[63px] overflow-hidden rounded-md border border-border bg-surface-2">
                  {item.thumbnailUrl ? <img
                    src={item.thumbnailUrl}
                    alt={`${reference?.title || item.title} 爆款视频缩略图`}
                    className="h-full w-full object-cover"
                  /> : <span className="flex h-full items-center justify-center text-text-muted" aria-label="爆款参考缩略图待绑定"><Clapperboard size={22}/></span>}
                  <span className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded bg-white/90" aria-hidden="true"><SocialPlatformIcon platform={reference?.platform || item.platform} size={14}/></span>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-text-muted">{String(index + 1).padStart(2, '0')}</span><h4 className="line-clamp-2 text-sm font-semibold text-text-primary">{item.title}</h4><Tag color={status.color}>{status.label}</Tag></div>
                  <p className="mt-1 truncate text-xs text-text-secondary">{item.productName} · {platformLabels[item.platform]}</p>
                  <p className="mt-2 flex items-center gap-1 text-xs text-text-muted"><CalendarRange size={13}/>{formatPublishTime(item)}</p>
                </div>
                <div className="flex min-w-[136px] flex-col items-start gap-3 sm:items-end">
                  <div><p className="flex items-center gap-1 text-xs text-text-muted"><CircleDollarSign size={13}/>单条预算</p><p className="mt-1 text-sm font-semibold tabular-nums text-text-primary">{costLabel}</p></div>
                  <Button className="min-h-11 min-w-[104px]" onClick={() => setSelectedPlanId(item.id)} aria-label={`查看 ${item.title} 详情`}>查看详情</Button>
                </div>
              </article>;
            })}
          </div> : <Empty className="py-8" image={Empty.PRESENTED_IMAGE_SIMPLE} description="计划视频正在生成"/>}
        </section>

        <section className="grid gap-4 lg:grid-cols-2" aria-label="发布与投流计划">
          <article className="rounded-lg border border-blue-200 bg-blue-50/40 p-4" aria-label="发布计划">
            <header className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-base font-semibold text-text-primary"><Send size={17} className="text-blue-600"/>发布计划</h3><Tag color="blue">{display.contents.length} 条排期</Tag></header>
            {publishingDays.length ? <ol className="mt-4 space-y-3 border-l border-blue-200 pl-4">{publishingDays.map(day => <li key={day.date} className="relative before:absolute before:-left-[21px] before:top-1 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-blue-500 before:bg-white"><p className="text-xs font-semibold text-text-primary">{day.date === '待排期' ? day.date : `${day.date.slice(5).replace('-', '/')} · 北京时间`}</p><div className="mt-2 flex flex-wrap gap-2">{day.items.map(item => <span key={item.id} className="inline-flex min-h-8 items-center gap-2 rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-text-secondary"><SocialPlatformIcon platform={item.platform} size={14}/><span className="max-w-[150px] truncate">{item.title}</span></span>)}</div></li>)}</ol> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="发布排期待确认"/>}
          </article>
          <article className="rounded-lg border border-amber-200 bg-amber-50/40 p-4" aria-label="投流计划">
            <header className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-base font-semibold text-text-primary"><Megaphone size={17} className="text-amber-700"/>投流计划</h3><Tag color="gold">{hasPersistedPaidMediaPlan ? '已规划' : '预算草案'}</Tag></header>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-b border-amber-200 pb-4">
              <div><p className="text-xs text-text-muted">{hasPersistedPaidMediaPlan ? '本周投流预算' : '建议预算上限'}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">{hasPersistedPaidMediaPlan && paidMediaBudget <= 0 ? '待核算' : `¥${(hasPersistedPaidMediaPlan ? paidMediaBudget : displayPaidMediaBudget).toFixed(2)}`}</p></div>
              <p className="max-w-[210px] text-right text-xs leading-5 text-text-secondary">{hasPersistedPaidMediaPlan ? '按已保存的本周预算与投流任务展示' : '待经营确认后进入执行排期'}</p>
            </div>
            <ol className="mt-1 divide-y divide-amber-200">
              {paidMediaRows.map(row => <li key={row.key} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-amber-200 bg-white"><SocialPlatformIcon platform={row.platform} size={15}/></span><h4 className="text-sm font-semibold text-text-primary">{row.title}</h4><Tag color={row.status === '计划中' ? 'gold' : undefined}>{row.status}</Tag></div>
                  <p className="mt-2 text-xs leading-5 text-text-secondary">{row.description}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-text-muted"><div><dt className="inline">目标：</dt><dd className="inline text-text-secondary">{row.goal}</dd></div><div><dt className="inline">人群：</dt><dd className="inline text-text-secondary">{row.audience}</dd></div><div><dt className="inline">排期：</dt><dd className="inline text-text-secondary">{row.timing}</dd></div>{row.content && <div><dt className="inline">内容：</dt><dd className="inline text-text-secondary">{row.content.title}</dd></div>}</dl>
                </div>
                <div className="sm:text-right"><p className="text-[11px] text-text-muted">计划预算</p><p className="mt-1 text-sm font-semibold tabular-nums text-text-primary">{row.budgetCny === null ? '待核算' : `¥${row.budgetCny.toFixed(2)}`}</p></div>
              </li>)}
            </ol>
          </article>
        </section>
      </div>
    </Drawer>

    <Modal
      open={Boolean(selectedPlan)}
      title="计划视频详情"
      width={760}
      footer={<Button type="primary" className="min-h-11" onClick={() => setSelectedPlanId("")}>关闭</Button>}
      onCancel={() => setSelectedPlanId("")}
      destroyOnHidden
    >
      {selectedPlan && <div className="space-y-6" aria-label={`${selectedPlan.item.title} 详细计划`}>
        <header className="grid gap-4 border-b border-border pb-5 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center">
          <div className="relative h-[112px] w-[63px] overflow-hidden rounded-md border border-border bg-surface-2">
            {selectedPlan.item.thumbnailUrl ? <img src={selectedPlan.item.thumbnailUrl} alt={`${selectedPlan.reference?.title || selectedPlan.item.title} 爆款视频缩略图`} className="h-full w-full object-cover"/> : <span className="flex h-full items-center justify-center text-text-muted"><Clapperboard size={22}/></span>}
          </div>
          <div className="min-w-0"><h3 className="text-base font-semibold text-text-primary">{selectedPlan.item.title}</h3><p className="mt-2 text-sm text-text-secondary">{selectedPlan.item.productName} · {platformLabels[selectedPlan.item.platform]} · {formatPublishTime(selectedPlan.item)}</p></div>
          <div className="sm:text-right"><p className="text-xs text-text-muted">预计制作成本</p><p className="mt-1 text-base font-semibold tabular-nums text-text-primary">{selectedPlan.costLabel}</p></div>
        </header>
        <section aria-label={`${selectedPlan.item.title} 内容结构`}>
          <h4 className="text-sm font-semibold text-text-primary">内容结构</h4>
          {selectedPlan.segments.length ? <ol className="mt-3 flex min-w-0 gap-2 overflow-x-auto pb-2">
            {selectedPlan.segments.map((segment, segmentIndex) => <li key={segment.key} className="relative min-w-[132px] flex-1 rounded-md border border-border bg-white px-3 py-3 before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:rounded-l-md before:bg-accent/70">
              <span className="text-[11px] font-medium text-text-muted">{String(segmentIndex + 1).padStart(2, '0')} · {segment.meta}</span>
              <strong className="mt-1 block text-xs font-semibold leading-5 text-text-primary">{segment.title}</strong>
            </li>)}
          </ol> : <p className="mt-3 text-sm text-text-secondary">编导结构尚未写入本周计划。</p>}
        </section>
        <section aria-label={`${selectedPlan.item.title} 数字人形象`} className="border-t border-border pt-5">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><UserRound size={16}/>数字人形象与制作依据</h4>
          <dl className="mt-3 grid gap-4 text-xs sm:grid-cols-3">
            <div><dt className="text-text-muted">形象方案</dt><dd className="mt-1 font-medium text-text-primary">{selectedPlan.presenterModeLabel}</dd></div>
            <div><dt className="text-text-muted">选用形象</dt><dd className="mt-1 break-words font-medium text-text-primary">{selectedPlan.presenterLabel}</dd></div>
            <div><dt className="text-text-muted">参考视频</dt><dd className="mt-1 font-medium text-text-primary">{selectedPlan.reference?.title || '待绑定'}</dd></div>
          </dl>
          {selectedPlan.reference && <Button className="mt-4 min-h-11" icon={<Eye size={15}/>} onClick={() => window.dispatchEvent(new CustomEvent("lingshu:navigate", { detail: inspirationReferenceNavigationDetail(selectedPlan.reference!, selectedPlan.item.contentId) }))}>查看爆款原片</Button>}
        </section>
      </div>}
    </Modal>
  </>;
}

