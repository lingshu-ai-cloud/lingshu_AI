import { useEffect, useState } from 'react';
import { authHeader } from '../lib/auth';
import { requestProductionBack } from '../lib/productionNavigation';
import type { RunEvent } from '../lib/digitalEmployees';
import AgentBrowserViewport from './AgentBrowserViewport';

const statuses: Record<string, string> = { pending: '尚未开始', running: '执行中', planning: '规划中', waiting_external: '等待外部结果', waiting_approval: '等待审批', waiting_human: '等待人工处理', handed_off: '人工接管', paused: '已暂停', failed: '执行失败', succeeded: '已完成', cancelled: '已取消' };
const stages: Record<string, string> = { script: '生成脚本', material_match: '匹配分镜素材', voice_subtitles: '生成配音与字幕', heygen: '生成数字人口播', render: '生成成片', quality: '检查成片质量', completed: '制作完成' };
type Snapshot = { task: { id: string; task_key?: string; title: string; status: string; blocker_reason?: string; output?: { production?: { analysisMessage?: string; repairAttempts?: number; problems?: Array<{shot: number; timeRange: string; reason: string}>; lastRepair?: {shots: number[]; message: string} } } }; stage?: string; events: RunEvent[] };

/** Shows the worker browser, never an animation or a second editable production session. */
export default function ProductionTaskScene({ runId, taskId }: { runId: string; taskId: string }) {
  const [expanded, setExpanded] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/overseas/digital-employees/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/workspace`, { headers: authHeader(), signal: abort.signal });
        if (!response.ok) throw Error('无法读取当前任务，请返回监控检查任务是否仍可访问。');
        const data = await response.json();
        if (!data.task) throw Error('任务状态尚未返回，请稍后重试。');
        if (!abort.signal.aborted) { setSnapshot(data); setError(''); }
      } catch (failure) {
        if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '执行状态读取失败');
      } finally { if (!abort.signal.aborted) timer = setTimeout(refresh, 5000); }
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [runId, taskId]);
  const task = snapshot?.task;
  const production = task?.output?.production;
  return <section data-testid="production-task-scene" className={expanded ? 'absolute inset-0 z-[70] flex flex-col overflow-hidden bg-[#f7faf7] text-text-primary' : 'shrink-0 border-b border-border bg-surface-2 px-4 py-3 text-sm text-text-primary'}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
      <div><h2 className="font-bold text-text-primary">智能员工生产现场 · {task?.title || '正在读取任务'}</h2><p className="mt-1 text-xs text-text-secondary">{error ? '状态连接异常' : task ? statuses[task.status] || task.status : '正在连接'}{snapshot?.stage ? ` · ${stages[snapshot.stage] || snapshot.stage}` : ''}</p></div>
      <div className="flex flex-wrap gap-2 text-xs"><button type="button" className="rounded-md border border-border bg-white px-3 py-2 font-semibold text-text-secondary hover:bg-surface-2" onClick={requestProductionBack}>返回上一页</button><button type="button" className="rounded-md bg-accent px-3 py-2 font-semibold text-white hover:bg-accent-dim" onClick={() => setExpanded(!expanded)}>{expanded ? '查看关联作品编辑器' : '观看员工现场'}</button></div>
    </header>
    {expanded && <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div><p className="mb-3 text-xs text-text-muted">生产过程中显示实际浏览器；选路、质检和已结束任务展示各自保存的结果。</p><AgentBrowserViewport runId={runId} taskId={taskId} taskStatus={task?.status || 'pending'} taskKey={task?.task_key} />
        <p className="mt-3 text-sm leading-6 text-text-secondary">{error ? '连接中断，画面与记录可能不是最新状态。' : !task ? '尚未读取到任务状态，暂不能判断员工是否正在执行。' : task.blocker_reason || (task.status === 'running' ? '正在执行；生成或等待服务返回期间，页面可能保持静止。' : task?.status === 'succeeded' ? '任务已完成，以下记录可查看已执行的工作。' : '当前任务没有持续执行；请结合任务状态和执行记录查看原因。')}</p>
        {error && <p role="alert" className="mt-3 border-l-2 border-amber bg-amber-dim px-3 py-2 text-sm text-amber">{error}</p>}
      </div>
      <aside className="border-t border-border pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">{production && <div className="mb-5 space-y-2 border-b border-border pb-4 text-sm">
        <h3 className="font-semibold">素材与成片检查</h3>
        {production.analysisMessage && <p>{production.analysisMessage}</p>}
        {!!production.repairAttempts && <p>已自动修复 {production.repairAttempts} 轮</p>}
        {production.lastRepair && <p>第 {production.lastRepair.shots.join('、')} 镜：{production.lastRepair.message}</p>}
        {production.problems?.map((problem, index) => <p key={index} className="text-amber">第 {problem.shot} 镜（{problem.timeRange}）：{problem.reason}</p>)}
      </div>}<h3 className="font-semibold text-text-primary">实际执行记录</h3><p className="mt-1 text-xs text-text-muted">仅展示此任务已写入的操作与结果</p><ol className="mt-4 divide-y divide-border border-y border-border">{[...(snapshot?.events || [])].reverse().map(event => <li key={event.id} className="px-1 py-3"><time className="text-xs text-text-muted">{new Date(event.occurred_at).toLocaleString('zh-CN')}</time><p className={`mt-2 text-sm ${event.level === 'error' ? 'text-red' : 'text-text-primary'}`}>{event.summary}</p></li>)}</ol>{snapshot && !snapshot.events?.length && <p className="mt-4 text-sm text-text-muted">此任务尚无执行记录，暂不能证明员工已开始工作。</p>}</aside>
    </div>}
  </section>;
}
