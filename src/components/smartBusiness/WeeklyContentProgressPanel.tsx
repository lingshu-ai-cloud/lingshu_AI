import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Steps, Tag, theme } from 'antd';
import { CheckCircle2, Circle, CircleDot, Clock3, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { authHeader } from '../../lib/auth';
import { studioApi, type StudioProject } from '../../lib/studioApi';
import { buildWeeklyContentProgress } from '../../lib/weeklyContentProgress';

type Props = {
  data: DigitalEmployeeOverview;
  contentId: string;
  onRefresh?: () => void;
  onOpenProduction?: (taskId: string, contentItemId: string) => void;
  onOpenReference?: () => void;
};

/** Read-only production evidence. Opening a calendar card never starts or retries work. */
export default function WeeklyContentProgressPanel({ data, contentId, onRefresh, onOpenProduction, onOpenReference }: Props) {
  const { token } = theme.useToken();
  const base = buildWeeklyContentProgress(data, contentId);
  const projectKey = [...base.projectIds].sort().join('|');
  const authorization = authHeader().Authorization;
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectsStatus, setProjectsStatus] = useState<'loading' | 'available' | 'unavailable'>('loading');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [updatedAt, setUpdatedAt] = useState('');
  const snapshotScope = useRef('');

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const projectIds = new Set(projectKey.split('|').filter(Boolean));
    const scope = JSON.stringify([projectKey, data.goal?.id, data.run?.id, authorization]);
    if (snapshotScope.current !== scope) {
      snapshotScope.current = scope;
      setProjects([]);
      setUpdatedAt('');
    }
    if (!projectIds.size) {
      setProjectsStatus('available');
      return;
    }
    setProjectsStatus('loading');
    const refresh = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const next = await studioApi.listProjects({ throwOnError: true });
        if (disposed || authorization !== authHeader().Authorization) return;
        setProjects(next.filter(project => projectIds.has(project.id)));
        setProjectsStatus('available');
        setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      } catch {
        if (!disposed && authorization === authHeader().Authorization) setProjectsStatus('unavailable');
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 12_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [projectKey, data.goal?.id, data.run?.id, authorization, refreshVersion]);

  const progress = useMemo(() => buildWeeklyContentProgress(data, contentId, { projects, projectsStatus }), [data, contentId, projects, projectsStatus]);
  const statusColor = (status: string) => status === 'completed' ? token.colorSuccess
    : status === 'blocked' ? token.colorError
      : status === 'running' ? token.colorPrimary
        : status === 'waiting' ? token.colorWarning : token.colorTextTertiary;
  const icon = (status: string) => {
    const Icon = status === 'completed' ? CheckCircle2 : status === 'blocked' ? TriangleAlert
      : status === 'running' ? CircleDot : status === 'waiting' ? Clock3 : Circle;
    return <Icon size={20} aria-hidden style={{ color: statusColor(status) }} />;
  };

  return <section aria-label="内容制作进度" className="space-y-4 border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-semibold text-text-primary">内容制作进度</h3>
      <Button aria-label="刷新内容制作进度" icon={<RefreshCw size={15} />} onClick={() => { setRefreshVersion(value => value + 1); onRefresh?.(); }}>刷新</Button>
    </div>
    <div aria-live="polite" className="space-y-2">
      <Tag color={progress.status === 'blocked' ? 'error' : progress.status === 'completed' ? 'success' : progress.status === 'running' ? 'processing' : 'default'}>{progress.statusLabel}</Tag>
      {progress.summary !== progress.blockingReasons.join('；') && <p className="text-sm text-text-secondary">{progress.summary}</p>}
      {progress.sharedMaster && <p className="text-xs text-text-muted">本条与同组内容共用制作结果，平台文案与发布状态独立保留。</p>}
    </div>
    {progress.blockingReasons.length > 0 && <Alert type="warning" showIcon title="当前需要处理" description={progress.blockingReasons.join('；')} />}
    {projectsStatus === 'unavailable' && <Alert type="warning" showIcon title="暂未取得最新制作回执" description="已保留上次读取的结果；未取得回执的步骤不会显示为已完成，可点击刷新重试。" />}
    <Steps orientation="vertical" size="small" current={-1} items={progress.stages.map(stage => ({
      title: <div className="flex flex-wrap items-center gap-2"><span>{stage.label}</span><span className="text-xs font-normal" style={{ color: statusColor(stage.status) }}>{stage.statusLabel}</span></div>,
      icon: icon(stage.status),
      status: stage.status === 'completed' ? 'finish' : stage.status === 'blocked' ? 'error' : stage.status === 'running' ? 'process' : 'wait',
      content: <div className="space-y-1 pb-3 text-sm text-text-secondary"><p>{stage.detail}</p>{stage.evidence.length > 0 && <p className="text-xs text-text-muted">{stage.evidence.join(' · ')}</p>}</div>,
    }))} />
    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
      {progress.taskId && onOpenProduction && <Button type="primary" onClick={() => onOpenProduction(progress.taskId!, progress.queueItemId || '')}>打开制作工作台</Button>}
      {onOpenReference && <Button icon={<ExternalLink size={15} />} onClick={onOpenReference}>查看爆款参考</Button>}
    </div>
    <p className="text-xs text-text-muted">{updatedAt ? `制作回执更新于 ${updatedAt}` : '进度依据当前计划与实际制作回执'} · 正式发布前仍需验收与发布授权</p>
  </section>;
}
