import { useEffect, useState } from 'react';
import { authHeader } from '../lib/auth';
type Snapshot = { task: { id: string; title: string; status: string; blocker_reason?: string; output?: Record<string, unknown> } };
const labels: Record<string, string> = { production: '当前作品制作情况', stage: '制作阶段', analysisMessage: '素材分析', repairAttempts: '自动修复轮次', problems: '镜头问题', shot: '镜头序号', timeRange: '时间区间', lastRepair: '最近修复', shots: '已替换镜头', script: '生成脚本', material_match: '匹配分镜素材', voice_subtitles: '生成配音与字幕', render: '生成成片', completed: '制作完成', blocked: '等待处理', coverage: '计划数量核对', planned: '已规划', missing: '待补齐', orders: '制作订单', routing: '路径评估', themes: '内容主题', routes: '制作路径', productName: '产品', platform: '平台', theme: '主题', label: '名称', route: '路径', reason: '原因', summary: '结果说明', eligibleRoutes: '可用路径', disabledRoutes: '不可用路径', passed: '检查通过', failures: '未通过项', quality: '质检', completedWorks: '完成作品', count: '数量', value: '数量', target: '目标', actual: '实际', dataStatus: '数据状态', checks: '检查项', title: '标题', status: '状态', evidence: '核验依据', source: '依据', message: '说明', required: '要求', ready: '已就绪', product: '产品生成', material: '素材创作', clone: '爆款复刻' };
function ResultValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null) return null;
  if (typeof value !== 'object') return <span>{typeof value === 'boolean' ? value ? '是' : '否' : labels[String(value)] || String(value)}</span>;
  if (depth >= 5) return <span>详细信息请查看工作页</span>;
  if (Array.isArray(value)) return <ul className="space-y-2">{value.map((item, index) => <li key={index} className="border-l-2 border-border pl-3"><ResultValue value={item} depth={depth + 1} /></li>)}</ul>;
  const entries = Object.entries(value).filter(([key, item]) => item != null && !/id$|ids$|hash|token|secret/i.test(key));
  return <dl className="space-y-2">{entries.map(([key, item]) => <div key={key}><dt className="font-semibold text-text-secondary">{labels[key] || key}</dt><dd className="mt-1 break-words whitespace-pre-wrap"><ResultValue value={item} depth={depth + 1} /></dd></div>)}</dl>;
}
export default function TaskMonitorResult({ runId, taskId, view, enabled, refreshKey = 0 }: { runId: string; taskId: string; view: string; enabled: boolean; refreshKey?: number }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    if (!enabled) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch(`/api/overseas/digital-employees/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/workspace`, { headers: authHeader(), signal: abort.signal });
        if (!response.ok) throw Error('任务结果读取失败');
        const next = await response.json() as Snapshot;
        if (next.task?.id !== taskId) throw Error('任务结果不匹配');
        if (!abort.signal.aborted) { setData(next); setError(''); }
      } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '连接中断'); }
      finally { if (!abort.signal.aborted) timer = setTimeout(load, 5000); }
    };
    void load();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [runId, taskId, enabled, refreshKey]);
  const title = view === 'routing' ? '制作方案与选路结果' : view === 'quality' ? '质量检查与验收结果' : '任务执行结果';
  const task = data?.task;
  const done = ['succeeded', 'completed'].includes(task?.status || '');
  return <section className="aspect-[11/7] overflow-auto bg-surface-2 p-5 text-xs text-text-primary" aria-label={title}>
    <p className="font-bold text-accent">{done ? '已完成 · 任务结果' : '任务记录 · 非浏览器直播'}</p>
    <h3 className="mt-3 text-lg font-bold">{title}</h3>
    <p className="mt-2 text-text-muted">仅展示本任务保存的结果与记录，不代表完成时的浏览器录像。</p>
    {error && <p role="alert" className="mt-3 text-red">{error}，当前记录可能不是最新状态。</p>}
    {!data && <p className="mt-4">{enabled ? '正在读取任务记录…' : '滚动至此处读取任务记录'}</p>}
    {task?.blocker_reason && <p className="mt-4 border-l-2 border-amber p-3">{task.blocker_reason}</p>}
    {task && <div className="mt-4 border-y border-border py-4">{Object.keys(task.output || {}).length ? <ResultValue value={task.output} /> : <p>尚无已保存的{view === 'quality' ? '质检结论，不能据此判断通过。' : '任务结果。'}</p>}</div>}
  </section>;
}
