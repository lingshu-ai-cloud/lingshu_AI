import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Collapse, Tag, theme } from 'antd';
import { ExternalLink, RefreshCw } from 'lucide-react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { authHeader, AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import { buildWeeklyContentProgress } from '../../lib/weeklyContentProgress';
import { readWeeklyContentProgressSnapshot } from '../../lib/weeklyContentProgressSnapshot';
import WeeklyProductionTimeline from './WeeklyProductionTimeline';
import WeeklyProductionStudioEntry from './WeeklyProductionStudioEntry';

type Props = {
  data: DigitalEmployeeOverview;
  contentId: string;
  onRefresh?: () => void;
  onOpenWorkbench?: () => void;
  onOpenReference?: () => void;
};

/** Read-only production evidence. Opening a calendar card never starts or retries work. */
export default function WeeklyContentProgressPanel({ data, contentId, onRefresh, onOpenWorkbench, onOpenReference }: Props) {
  const { token } = theme.useToken();
  const [authorization, setAuthorization] = useState(authHeader().Authorization);
  const scope = JSON.stringify([contentId, data.goal?.id, data.plan?.id, data.run?.id, authorization]);
  const parentData = useRef(data);
  parentData.current = data;
  const [snapshot, setSnapshot] = useState<(Awaited<ReturnType<typeof readWeeklyContentProgressSnapshot>> & { scope: string; parentData: DigitalEmployeeOverview }) | null>(null);
  const [projectsStatus, setProjectsStatus] = useState<'loading' | 'available' | 'unavailable'>('loading');
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const syncAuthorization = () => setAuthorization(authHeader().Authorization);
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, syncAuthorization);
    window.addEventListener('storage', syncAuthorization);
    return () => {
      window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, syncAuthorization);
      window.removeEventListener('storage', syncAuthorization);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const controller = new AbortController();
    if (!data.goal?.id || !data.plan?.id) {
      setProjectsStatus('available');
      return;
    }
    setProjectsStatus('loading');
    const refresh = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      const requestedParent = parentData.current;
      try {
        const next = await readWeeklyContentProgressSnapshot({ data: requestedParent, contentId, headers: authHeader(), signal: controller.signal });
        if (disposed || authorization !== authHeader().Authorization) return;
        // A newer parent SSE/refresh result must not be replaced by an older poll.
        if (requestedParent !== parentData.current) return;
        setSnapshot({ ...next, scope, parentData: requestedParent });
        setProjectsStatus('available');
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
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [scope, refreshVersion]);

  const visibleSnapshot = snapshot?.scope === scope ? snapshot : null;
  const currentData = visibleSnapshot?.parentData === data ? visibleSnapshot.data : data;
  const progress = useMemo(() => buildWeeklyContentProgress(currentData, contentId, { projects: visibleSnapshot?.projects || [], projectsStatus }), [currentData, contentId, visibleSnapshot, projectsStatus]);
  const localTime = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '';
  const statusColor = (status: string) => status === 'completed' ? token.colorSuccess
    : status === 'blocked' ? token.colorError
      : status === 'running' ? token.colorPrimary
        : status === 'waiting' ? token.colorWarning : token.colorTextTertiary;

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
    <WeeklyProductionTimeline stages={progress.stages} />
    {progress.shots.length > 0 && <Collapse size="small" items={[{
      key: 'shots',
      label: `逐镜制作回执 · ${progress.shots.filter(shot => shot.adoptedMaterialId).length}/${progress.shots.length} 已采用`,
      children: <ol aria-label="逐镜制作回执" className="divide-y divide-border">
        {progress.shots.map(shot => <li key={shot.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{shot.label}</span><span className="text-xs text-text-muted">{shot.timeRange}</span><span className="text-xs" style={{ color: statusColor(shot.status) }}>{shot.statusLabel}</span></div>
          <p className="text-sm text-text-secondary">{shot.detail}</p>
          <p className="text-xs text-text-secondary">{shot.qualityLabel}</p>
          <dl className="space-y-1 break-all text-xs text-text-muted">
            {progress.projectIds.length > 1 && <div><dt className="inline">制作版本：</dt><dd className="inline">{shot.projectId}</dd></div>}
            {shot.firstFrameMaterialId && <div><dt className="inline">首帧产物：</dt><dd className="inline">{shot.firstFrameMaterialId}</dd></div>}
            {shot.videoMaterialId && <div><dt className="inline">镜头视频：</dt><dd className="inline">{shot.videoMaterialId}</dd></div>}
            {shot.adoptedMaterialId && <div><dt className="inline">已采用素材：</dt><dd className="inline">{shot.adoptedMaterialId}</dd></div>}
            {shot.providerTaskId && <div><dt className="inline">供应商任务：</dt><dd className="inline">{shot.providerTaskId} · {localTime(shot.providerAcceptedAt)} 受理（北京时间）</dd></div>}
            {localTime(shot.updatedAt) && <div><dt className="inline">镜头更新：</dt><dd className="inline">{localTime(shot.updatedAt)}（北京时间）</dd></div>}
          </dl>
        </li>)}
      </ol>,
    }]} />}
    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
      {progress.taskId && <WeeklyProductionStudioEntry data={currentData} contentId={contentId} onOpened={onOpenWorkbench} />}
      {onOpenReference && <Button icon={<ExternalLink size={15} />} onClick={onOpenReference}>查看爆款参考</Button>}
    </div>
    <p className="text-xs text-text-muted">{visibleSnapshot ? `制作回执更新于 ${localTime(visibleSnapshot.receivedAt)}（北京时间）` : '进度依据当前计划与实际制作回执'} · 正式发布前仍需验收与发布授权</p>
  </section>;
}
