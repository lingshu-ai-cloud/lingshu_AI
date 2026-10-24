import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Drawer, Empty, Grid, Segmented, Table, Tag, Tooltip } from 'antd';
import { ArrowLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { ContentQueueItem, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { buildWeeklyContentProgress, type WeeklyContentProgress } from '../../lib/weeklyContentProgress';
import WeeklyContentProgressPanel from '../smartBusiness/WeeklyContentProgressPanel';

type Props = {
  data: DigitalEmployeeOverview;
  onBack: () => void;
  onRefresh: () => void;
};

type ExecutionItem = Pick<ContentQueueItem, 'contentId' | 'title' | 'productName' | 'platform' | 'accountLabel' | 'plannedPublishDate' | 'status' | 'reason'>;
type ExecutionRow = {
  id: string;
  item: ExecutionItem;
  items: ExecutionItem[];
  progress: WeeklyContentProgress;
  needsHuman: boolean;
};

const statusColor = (status: string) => status === 'completed' ? 'success'
  : status === 'blocked' ? 'error' : status === 'running' ? 'processing'
    : status === 'waiting' ? 'warning' : 'default';

function dateLabel(value: string) {
  if (!value) return '';
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', weekday: 'short' }) : '';
}

/** Preserve scope before deriving identity or status from production evidence. */
export function buildEmployeeExecutionRows(data: DigitalEmployeeOverview): ExecutionRow[] {
  const grouped = new Map<string, ExecutionRow>();
  const validRun = Boolean(data.run && data.run.goal_id === data.goal?.id && data.run.plan_id === data.plan?.id);
  const mismatchedRun = Boolean(data.run && !validRun);
  const items = (data.contentQueue?.items || []).filter(item => item.origin === 'weekly_plan'
    && Boolean(data.goal?.id && data.plan?.id)
    && item.lineage.goalId === data.goal?.id && item.lineage.planId === data.plan?.id);
  for (const item of items) {
    const actual = buildWeeklyContentProgress(data, item.contentId);
    const progress: WeeklyContentProgress = mismatchedRun ? {
      ...actual, status: 'unavailable', statusLabel: '运行待同步',
      summary: '运行记录与当前周计划不一致，请刷新后查看执行回执。', blockingReasons: [],
      stages: actual.stages.map(stage => ({ ...stage, status: 'unavailable', statusLabel: '待同步', detail: '当前运行关联尚未确认。', evidence: [] })),
    } : actual;
    const id = progress.masterContentId || item.contentId || item.id;
    const needsHuman = validRun && (item.status === 'waiting_review'
      || item.steps.some(step => step.state === 'active' && ['用户', '人工'].includes(step.responsibleAgent)));
    const existing = grouped.get(id);
    if (existing) {
      existing.items.push(item);
      existing.needsHuman ||= needsHuman;
      if (item.contentId === id) { existing.item = item; existing.progress = progress; }
    } else grouped.set(id, { id, item, items: [item], progress, needsHuman });
  }
  const frozenPlans = data.plan?.businessPackage?.tasks.filter(task => task.templateId === 'production').flatMap(task => task.videoPlans || []) || [];
  const plans = frozenPlans.length ? frozenPlans : data.goal?.videoPlans || [];
  for (const plan of plans) {
    if (!data.goal || !plan.contentId || items.some(item => item.contentId === plan.contentId)) continue;
    const master = plan.productionRole === 'platform_adaptation'
      ? plans.find(candidate => candidate.contentId === plan.masterContentId && candidate.productionRole === 'master') : undefined;
    const id = master?.contentId || plan.contentId;
    const item: ExecutionItem = {
      contentId: plan.contentId, title: plan.publication?.title || plan.theme, productName: plan.productName,
      platform: plan.platform, accountLabel: '', plannedPublishDate: plan.plannedPublishDate || '', status: 'planned', reason: '',
    };
    const existing = grouped.get(id);
    if (existing) { existing.items.push(item); if (plan.contentId === id && existing.progress.taskId === null) existing.item = item; continue; }
    const actual = buildWeeklyContentProgress(data, plan.contentId);
    const progress: WeeklyContentProgress = {
      ...actual, status: 'pending', statusLabel: '尚未派生执行任务', summary: '已列入周计划，尚未取得此视频的执行任务。', taskId: null, projectIds: [], blockingReasons: [],
      stages: actual.stages.map(stage => ({ ...stage, status: 'pending', statusLabel: '尚未派生', detail: '尚未取得属于此视频的执行任务与制作回执。', evidence: [] })),
    };
    grouped.set(id, { id, item, items: [item], progress, needsHuman: false });
  }
  return [...grouped.values()];
}

/** Each row follows a real video identity; platform adaptations share a row only with an explicit master link. */
export default function EmployeeExecutionView({ data, onBack, onRefresh }: Props) {
  const screens = Grid.useBreakpoint();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = useMemo(() => buildEmployeeExecutionRows(data), [data]);
  const synchronized = data.contentQueue?.sourceStatus === 'available'
    && (!data.run || (data.run.goal_id === data.goal?.id && data.run.plan_id === data.plan?.id));
  const needsHumanCount = rows.filter(row => row.needsHuman).length;
  const selected = rows.find(row => row.id === selectedId);
  const start = dateLabel(data.goal?.startsAt || '');
  const end = dateLabel(data.goal?.endsAt || '');

  const visibleRows = filter === 'human' ? rows.filter(row => row.needsHuman) : rows;
  const emptyDescription = !synchronized ? '执行进展尚未同步，暂不能确认视频及待处理数量' : filter === 'human' ? '当前没有需要你处理的视频' : '当前周计划尚未派生视频执行任务';

  return <section aria-label="数字员工执行现场" className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Button icon={<ArrowLeft size={16} />} onClick={onBack}>返回目标与成片</Button>
        <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-text-primary">数字员工执行现场</h3>
      </div>
      <Button icon={<RefreshCw size={15} />} onClick={onRefresh}>刷新进展</Button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-text-primary">{data.goal?.title || '本周内容计划'}</p>
        <p className="text-xs text-text-muted">{start && end ? `${start} — ${end} · 北京时间` : '计划日期待确认'} · {synchronized ? `${rows.length} 条视频 · ${needsHumanCount} 条需你处理` : '执行进展待同步'}</p>
      </div>
      <Segmented aria-label="执行内容筛选" value={filter} onChange={value => setFilter(String(value))} options={[
        { label: '全部视频', value: 'all' }, { label: synchronized ? `需我处理 ${needsHumanCount}` : '需我处理 · 待同步', value: 'human' },
      ]} />
    </div>
    {!synchronized && <Alert type="warning" showIcon title="执行进展暂未同步" description={data.contentQueue?.sourceNote || '请刷新重试，当前保留已读取的计划。'} />}
    {!screens.md ? <div className="space-y-3" aria-label="视频执行列表">
      {visibleRows.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />}
      {visibleRows.map(row => <article key={row.id} className="space-y-3 rounded-lg border border-border p-4">
        <div className="space-y-1"><h4 className="break-words font-semibold text-text-primary">{row.item.title || '未命名内容'}</h4><p className="text-xs text-text-muted">{row.item.productName || '产品待确认'} · {[...new Set(row.items.map(item => item.accountLabel || item.platform))].join(' · ')}</p></div>
        <div><Tag color={statusColor(row.progress.status)}>{row.progress.statusLabel}</Tag><span className="text-sm text-text-secondary">{row.progress.summary}</span></div>
        <div className="flex flex-wrap gap-1">{row.progress.stages.map(stage => <Tag className="!m-0" key={stage.key} color={statusColor(stage.status)}>{stage.label} · {stage.statusLabel}</Tag>)}</div>
        <p className="text-xs text-text-secondary">计划发布：{[...new Set(row.items.map(item => dateLabel(item.plannedPublishDate)).filter(Boolean))].join(' · ') || '日期待确认'}</p>
        <div className="flex flex-wrap items-center gap-2">{row.needsHuman && <Tag color="warning">需你处理</Tag>}<Button size="small" onClick={() => setSelectedId(row.id)}>{row.needsHuman ? '查看并处理' : row.items.some(item => item.status === 'blocked') ? '查看卡点' : '查看执行详情'}</Button></div>
      </article>)}
    </div> : <Table<ExecutionRow> rowKey="id" size="middle" pagination={false} scroll={{ x: 820 }}
      dataSource={visibleRows}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} /> }}
      columns={[
        { title: '视频计划', key: 'content', width: 240, render: (_, row) => <div className="space-y-1">
          <Button type="link" className="!h-auto !whitespace-normal !p-0 !text-left !font-semibold" onClick={() => setSelectedId(row.id)}>{row.item.title || '未命名内容'}</Button>
          <p className="text-xs text-text-muted">{row.item.productName || '产品待确认'}</p>
          <p className="text-xs text-text-secondary">{[...new Set(row.items.map(item => item.accountLabel || item.platform))].join(' · ')}</p>
        </div> },
        { title: '执行进展', key: 'progress', render: (_, row) => <div className="space-y-2">
          <div><Tag color={statusColor(row.progress.status)}>{row.progress.statusLabel}</Tag><span className="text-xs text-text-secondary">{row.progress.summary}</span></div>
          <div className="flex flex-wrap gap-1" aria-label="实际制作节点">
            {row.progress.stages.map(stage => <Tooltip key={stage.key} title={stage.detail}>
              <Tag className="!m-0" color={statusColor(stage.status)}>{stage.label} · {stage.statusLabel}</Tag>
            </Tooltip>)}
          </div>
        </div> },
        { title: '计划发布', key: 'date', width: 135, render: (_, row) => <div className="space-y-1 text-xs text-text-secondary">{[...new Set(row.items.map(item => dateLabel(item.plannedPublishDate)).filter(Boolean))].map(date => <p key={date}>{date}</p>)}{row.items.every(item => !dateLabel(item.plannedPublishDate)) && '日期待确认'}</div> },
        { title: '下一步', key: 'action', width: 170, render: (_, row) => <div className="space-y-2">
          {row.needsHuman && <Tag color="warning">需你处理</Tag>}
          {row.items.some(item => item.reason) && <p className="text-xs text-text-secondary">{[...new Set(row.items.map(item => item.reason).filter(Boolean))].join('；')}</p>}
          {!row.items.some(item => item.reason) && row.progress.blockingReasons.length > 0 && <p className="text-xs text-text-secondary">{row.progress.blockingReasons.join('；')}</p>}
          <Button size="small" icon={<ChevronRight size={14} />} onClick={() => setSelectedId(row.id)}>{row.needsHuman ? '查看并处理' : row.items.some(item => item.status === 'blocked') ? '查看卡点' : '查看执行详情'}</Button>
        </div> },
      ]} />}
    <p className="text-xs text-text-muted">制作节点依据当前计划与实际回执展示；打开详情可查看逐镜结果并进入原制作工作台。</p>
    <Drawer title={selected?.item.title || '视频执行详情'} open={Boolean(selected)} onClose={() => setSelectedId(null)} size={760} destroyOnHidden>
      {selected && <WeeklyContentProgressPanel key={selected.item.contentId} data={data} contentId={selected.item.contentId} onRefresh={onRefresh} onOpenWorkbench={() => setSelectedId(null)} />}
    </Drawer>
  </section>;
}
