import { Alert, Button, Pagination } from 'antd';
import { shootingSoundInstructions } from '../../../shared/shootingWorkflow';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { ScriptGapTask } from '../../lib/scriptGapQueue';
import type { ShootingNeed } from '../../lib/inspirationTypes';
import { SocialPlatformIcon } from '../SocialPlatformIcon';
import { getPlatformMeta } from './inspirationVideoProjection';
import { shootingCreationDate, pendingShootingTaskCount } from './inspirationShootingNeeds';

interface InspirationShootingPanelProps {
  error?: string;
  loading?: boolean;
  onRetry?: () => void;
  bindingRetry?: boolean;
  onRetryBinding?: () => void;
  needs: ShootingNeed[];
  scriptGapTasks: ScriptGapTask[];
  materialCount: number;
  uploadingMaterial: boolean;
  onUploadExisting: (scriptGapId: string) => void;
  onCaptureStart: (scriptGapId: string) => void;
  onUploadCaptured: (files: FileList | null) => void;
}

export function InspirationShootingPanel({ error, loading = false, onRetry, bindingRetry = false, onRetryBinding, needs, scriptGapTasks, materialCount, uploadingMaterial, onUploadExisting, onCaptureStart, onUploadCaptured }: InspirationShootingPanelProps) {
  const [filter, setFilter] = useState<'all' | 'storyboard' | 'common'>('all');
  const [page, setPage] = useState(1);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const cards = useMemo(() => [
    ...scriptGapTasks.map(task => ({ id: task.id, kind: 'storyboard' as const, createdAt: task.createdAt, task })),
    ...needs.map(need => ({ id: need.id, kind: 'common' as const, createdAt: need.createdAt, need })),
  ].sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0) || a.id.localeCompare(b.id)), [scriptGapTasks, needs]);
  const latestIds = useMemo(() => new Set(cards.filter(card => card.kind === 'common' || card.task.uploadedMaterialIds.length === 0).slice(0, 3).map(card => card.id)), [cards]);
  const visibleCards = cards.filter(card => filter === 'all'
    || (filter === 'storyboard' && card.kind === 'storyboard')
    || (filter === 'common' && card.kind === 'common'));
  useEffect(() => { setPage(1); }, [filter]);
  useEffect(() => { setPage(current => Math.min(current, Math.max(1, Math.ceil(visibleCards.length / 20)))); }, [visibleCards.length]);
  const focusedTaskRef = useRef('');
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('task');
    if (!id || focusedTaskRef.current === id) return;
    const index = cards.findIndex(card => card.kind === 'storyboard' && card.id === id);
    if (index < 0) return;
    focusedTaskRef.current = id;
    setFilter('all');
    setPage(Math.floor(index / 20) + 1);
    window.requestAnimationFrame(() => document.getElementById(`shooting-task-${id}`)?.scrollIntoView({ block: 'center' }));
  }, [cards]);

  return <div className="space-y-4">
    {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={onRetry}>重试读取</Button>} />}
    {bindingRetry && <Alert type="warning" showIcon title="视频已入库，待拍任务尚未关联；无需重复上传。" action={<Button size="small" loading={uploadingMaterial} onClick={onRetryBinding}>重试关联</Button>} />}
    {loading && <p role="status" className="text-sm text-text-muted">正在同步待拍任务及高频需求…</p>}
    <div className="grid gap-3 md:grid-cols-3">
      {[
        { label: '待拍任务', value: loading ? '…' : needs.length + pendingShootingTaskCount(scriptGapTasks) },
        { label: '高频可复用需求', value: loading ? '…' : needs.length },
        { label: '已入库素材', value: materialCount },
      ].map(item => (
        <div key={item.label} className="card p-4">
          <p className="text-2xl font-bold text-accent">{item.value}</p>
          <p className="mt-1 text-xs text-text-muted">{item.label}</p>
        </div>
      ))}
    </div>
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="筛选待拍清单">
      {([
        ['all', '全部', needs.length + scriptGapTasks.length],
        ['storyboard', '分镜任务', scriptGapTasks.length],
        ['common', '高频需求', needs.length],
      ] as const).map(([key, label, count]) => (
        <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
          className={`min-w-0 rounded-lg border px-2 py-2.5 text-xs font-bold transition-colors sm:text-sm ${filter === key ? 'border-accent bg-accent text-white' : 'border-border bg-surface text-text-secondary hover:border-accent hover:text-accent'}`}>
          <span className="truncate">{label}</span><span className="ml-1 opacity-70">{count}</span>
        </button>
      ))}
    </div>
    <input ref={cameraInputRef} aria-label="为待拍任务补充实拍素材" type="file" accept="video/*" capture="environment" className="hidden" onChange={event => { onUploadCaptured(event.currentTarget.files); event.currentTarget.value = ''; }}/>
    {visibleCards.length === 0 && !loading && !error ? (
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
        <Check size={30} className="mx-auto mb-3 text-accent" />
        <p className="text-sm font-bold text-text-primary">当前筛选下没有待拍任务</p>
        <p className="mt-1 text-xs text-text-muted">可以切换上方筛选查看其他需求。</p>
      </div>
    ) : (
      <div className="space-y-3">
        {visibleCards.slice((page - 1) * 20, page * 20).map(card => {
          const task = card.kind === 'storyboard' ? card.task : null;
          const need = card.kind === 'common' ? card.need : null;
          const focused = task && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('task') === task.id;
          return <article key={card.id} id={task ? `shooting-task-${task.id}` : undefined} className={`rounded-lg border border-border bg-white p-4 ${focused ? 'ring-2 ring-amber-400' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">{task ? task.uploadedMaterialIds.length ? '已补充素材 · 待分镜核对' : '分镜待拍' : '高频需求'}</span>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-text-secondary">{need?.ratio || task?.ratio || '9:16'}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-text-secondary">{need ? <><SocialPlatformIcon platform={need.platform} size={12} />{getPlatformMeta(need.platform).label}</> : '内容制作'}</span>
                </div>
                <h3 className="mt-2 text-sm font-bold text-text-primary">{task?.title || need?.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">{task?.shotBrief || need?.suggestion}</p>
                <p className="mt-2 text-[11px] text-text-muted">{task ? `${task.productLabel} · ${task.themeTitle} · 建议 ${task.suggestedDurationSec} 秒` : `出现 ${need?.count} 次 · 来源：${need?.sourceVideos.slice(0, 3).join(' / ')}`}</p>
                {task && <p className="mt-1 text-xs text-text-secondary">{shootingSoundInstructions(task.soundMode)}</p>}
                <p className="mt-1 text-[11px] text-text-muted">创建日期：{shootingCreationDate(card.createdAt)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {latestIds.has(card.id) && <span role="img" aria-label="最新待拍任务" title="最新待拍任务" className="text-sm leading-none">❗</span>}
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" disabled={uploadingMaterial} onClick={() => onUploadExisting(task?.id || '')} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary">上传现有素材</button>
                  <button type="button" title="实拍视频作为企业通用素材入库，并关联当前待拍任务" disabled={uploadingMaterial} onClick={() => { onCaptureStart(task?.id || ''); cameraInputRef.current?.click(); }} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary disabled:opacity-50">可选实拍</button>
                  {task && task.uploadedMaterialIds.length > 0 && task.sourceProjectId && <a href={`?page=smartAssets&project=${encodeURIComponent(task.sourceProjectId)}`} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">返回分镜</a>}
                </div>
              </div>
            </div>
          </article>;
        })}
      </div>
    )}
    {visibleCards.length > 20 && <Pagination current={page} pageSize={20} total={visibleCards.length} showSizeChanger={false} onChange={setPage} showTotal={total => `共 ${total} 项任务`} />}
  </div>;
}
