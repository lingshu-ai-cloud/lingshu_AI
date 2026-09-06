import { authHeader } from '../lib/auth';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, CheckCircle2, Clock3, ExternalLink, FileText, MonitorPlay, X, AlertTriangle, Download } from 'lucide-react';
import { fallbackDelivery, filterDeliveries, isDeliveryStale, safeDeliveryUrl, type DeliveryArtifact, type DeliveryResource } from '../lib/delivery';
import { agentUiActionFromEvent } from '../lib/digitalEmployees';
import type { DigitalEmployeeDeepLink, RunEvent, WorkflowTask } from '../lib/digitalEmployees';

const columns = [{ id: 'todo', label: '待开始' }, { id: 'active', label: '生产中' }, { id: 'human', label: '待你处理' }, { id: 'done', label: '已交付' }] as const;
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '尚未记录';

function ArtifactPreview({ artifact }: { artifact: DeliveryArtifact }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [artifact.id, artifact.url]);
  const url = safeDeliveryUrl(artifact.url);
  if (failed) return <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">产物暂时无法加载，请进入业务页面核对或刷新重试。</p>;
  if (artifact.kind === 'video' && url) return <video aria-label={artifact.label} controls preload="metadata" src={url} onError={() => setFailed(true)} className="max-h-[48vh] w-full rounded-xl bg-black"/>;
  if (artifact.kind === 'audio' && url) return <audio aria-label={artifact.label} controls preload="metadata" src={url} onError={() => setFailed(true)} className="w-full"/>;
  if (artifact.kind === 'image' && url) return <img src={url} alt={artifact.label} onError={() => setFailed(true)} className="max-h-[48vh] w-full rounded-xl object-contain"/>;
  if (artifact.kind === 'link' && url) return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">打开{artifact.label}<ExternalLink size={14}/></a>;
  return <p className="max-h-[48vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-700">{artifact.text || '尚无可预览的内容'}</p>;
}

function downloadText(artifact: DeliveryArtifact) {
  const url = URL.createObjectURL(new Blob([artifact.text || ''], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${artifact.label}.txt`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DeliveryBoard({ tasks, deliveries, events, goalTitle, notice, focus, onAccepted, onOpenTask, onSelectTask, onOpenMonitor }: {
  onAccepted?: () => void;
  focus?: { id: string; request: number };
  notice?: string; tasks: WorkflowTask[]; deliveries?: DeliveryResource[]; events: RunEvent[]; goalTitle: string;
  onOpenTask: (link: DigitalEmployeeDeepLink) => void; onSelectTask: (id: string) => void; onOpenMonitor?: () => void;
}) {
  const [acceptanceNotice, setAcceptanceNotice] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [editedNarration, setEditedNarration] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [subject, setSubject] = useState('all');
  const [period, setPeriod] = useState('all');
  const [exceptions, setExceptions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [artifactId, setArtifactId] = useState('');
  const appliedFocus = useRef<typeof focus>(undefined);
  const [now, setNow] = useState(Date.now());
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const visibleTaskIds = new Set(tasks.map(task => task.id));
  const cards = deliveries ? deliveries.filter(card => card.taskIds.some(id => visibleTaskIds.has(id))) : tasks.map(task => fallbackDelivery(task, goalTitle));
  const filtered = filterDeliveries(cards, { query, kind, subject, period, exceptions, now });
  const selected = cards.find(card => card.id === selectedId);
  useEffect(() => {
    if (!focus || appliedFocus.current === focus || !cards.some(card => card.id === focus.id)) return;
    appliedFocus.current = focus;
    setArtifactId('');
    setSelectedId(focus.id);
  }, [focus, cards]);

  const latestScreen = selected ? [...events].reverse().filter(event => selected.taskIds.includes(event.task_id)).map(agentUiActionFromEvent).find(action => action?.kind === 'screenshot' && safeDeliveryUrl(action.screenshotUrl)) : undefined;
  const artifact = selected?.artifacts.find(item => item.id === artifactId) || selected?.artifacts.find(item => item.kind === 'video') || selected?.artifacts[0];
  useEffect(() => {
    if (!selectedId) return;
    previousFocus.current = document.activeElement as HTMLElement;
    dialog.current?.focus();
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId('');
      if (event.key !== 'Tab') return;
      const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button, a[href], video, audio, [tabindex="0"]') || [])].filter(item => !item.hasAttribute('disabled'));
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = old; document.removeEventListener('keydown', onKey); previousFocus.current?.focus(); };
  }, [selectedId]);
  useEffect(() => { if (selectedId && !selected) setSelectedId(''); }, [selectedId, selected]);
  const open = (card: DeliveryResource, artifact?: DeliveryArtifact) => { setArtifactId(artifact?.id || ''); setSelectedId(card.id); };
  const process = (card: DeliveryResource) => {
    setSelectedId('');
    const blockedTask = tasks.find(task => card.taskIds.includes(task.id) && ['waiting_approval', 'waiting_human', 'failed', 'handed_off'].includes(task.status));
    onSelectTask(blockedTask?.id || card.taskId);
    requestAnimationFrame(() => document.getElementById(blockedTask?.status === 'waiting_approval' ? 'delivery-approval' : 'task-production-scene')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-black text-slate-950">业务交付看板</h2><p className="mt-1 text-xs text-slate-500">查看真实生产进展、处理待办、领取业务结果</p></div>
      {onOpenMonitor && <button onClick={onOpenMonitor} type="button" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600"><MonitorPlay size={14}/>打开监控大屏</button>}
    </div>
    {notice && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{notice}</p>}
    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {[['待你处理', cards.filter(card => card.column === 'human').length, 'bg-amber-50 text-amber-800'], ['生产中', cards.filter(card => card.column === 'active').length, 'bg-blue-50 text-blue-700'], ['异常 / 久未更新', cards.filter(card => card.exception || isDeliveryStale(card, now)).length, 'bg-red-50 text-red-700'], ['今日已交付', cards.filter(card => card.column === 'done' && Date.parse(card.deliveredAt || '') >= today.getTime()).length, 'bg-emerald-50 text-emerald-700']].map(([label, count, tone]) => <div key={label} className={`flex items-center justify-between rounded-xl px-4 py-3 ${tone}`}><span className="text-xs font-bold">{label}</span><strong className="text-xl">{count}</strong></div>)}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input aria-label="搜索交付任务" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索任务、账号或客户" className="min-w-48 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs"/>
      <select aria-label="任务类型" value={kind} onChange={e => setKind(e.target.value)} className="max-w-48 rounded-xl border border-slate-200 p-2 text-xs"><option value="all">全部任务类型</option>{[...new Set(cards.map(card => card.kind))].map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="账号或客户" value={subject} onChange={e => setSubject(e.target.value)} className="max-w-48 rounded-xl border border-slate-200 p-2 text-xs"><option value="all">全部业务对象</option>{[...new Set(cards.map(card => card.subject))].map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="更新时间" value={period} onChange={e => setPeriod(e.target.value)} className="rounded-xl border border-slate-200 p-2 text-xs"><option value="all">本轮全部时间</option><option value="today">今天</option><option value="week">最近 7 天</option></select>
      <button type="button" aria-pressed={exceptions} onClick={() => setExceptions(!exceptions)} className={`rounded-xl border px-3 py-2 text-xs ${exceptions ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 text-slate-600'}`}>只看异常</button>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {columns.map(column => {
        const matches = filtered.filter(card => card.column === column.id);
        const shown = column.id === 'done' && !showHistory ? matches.slice(0, 6) : matches;
        return <div key={column.id} className="min-w-0 rounded-2xl bg-slate-50 p-3"><div className="mb-3 flex items-center justify-between text-xs font-bold text-slate-600"><h3>{column.label}</h3><span>{matches.length}</span></div>
          <div className="space-y-3">{shown.map(card => {
            const stale = isDeliveryStale(card, now);
            const preview = card.artifacts.find(item => item.kind === 'video') || card.artifacts.find(item => item.id === 'draft') || card.artifacts[0];
            return <article key={card.id} className={`min-w-0 overflow-hidden rounded-xl border bg-white shadow-sm ${card.exception ? 'border-red-200' : 'border-slate-200'}`}>
              <button type="button" onClick={() => open(card)} className="w-full p-4 text-left hover:bg-blue-50/40 focus-visible:outline-blue-500">
                <div className="flex items-start justify-between gap-2 text-[10px] font-bold"><span className="text-slate-500">{card.kind}</span>{(card.exception || stale) && <span className="text-red-600">{card.exception ? '执行异常' : '30 分钟未更新'}</span>}</div>
                <h4 className="mt-2 break-words text-sm font-black leading-5 text-slate-900">{card.title}</h4>
                <p className="mt-1 truncate text-[11px] text-slate-500" title={card.subject}>{card.subject}</p>
                <div className="mt-3 rounded-lg bg-slate-50 p-2.5"><p className="text-xs font-bold text-slate-700">{card.stage}</p><p className={`mt-1 text-[11px] leading-5 ${card.reason ? 'text-amber-700' : 'text-slate-500'}`}>{card.reason || card.acceptance}</p></div>
                {card.steps.length > 0 && <p className="mt-2 text-[10px] text-slate-500">{card.steps.filter(step => step.state === 'done').length} / {card.steps.length} 个生产步骤完成</p>}
                <p className="mt-2 text-[10px] text-slate-400">{card.column === 'done' ? '交付于' : '更新于'} {date(card.deliveredAt || card.updatedAt)}</p>
              </button>
              {preview && <button type="button" onClick={() => open(card, preview)} className="mx-4 mb-3 block w-[calc(100%-2rem)] rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-left"><span className="flex items-center gap-1.5 text-xs font-bold text-blue-700">{preview.kind === 'video' ? <MonitorPlay size={14}/> : <FileText size={14}/>}预览{preview.label} {preview.version}</span>{preview.text && <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{preview.text}</p>}</button>}
              <div className="border-t border-slate-100 px-4 py-3"><button type="button" onClick={() => open(card)} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700">{card.column === 'done' ? '查看交付结果' : card.column === 'human' ? '审核与处理' : '查看生产实况'}<ArrowRight size={12}/></button>{card.effect && <p className="mt-2 text-[10px] text-slate-500">{card.effect}</p>}</div>
            </article>;
          })}{!shown.length && <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">{query || exceptions || kind !== 'all' || subject !== 'all' || period !== 'all' ? '没有匹配的任务' : '暂无任务'}</p>}</div>
          {column.id === 'done' && matches.length > 6 && <button type="button" onClick={() => setShowHistory(!showHistory)} className="mt-3 w-full py-2 text-xs font-bold text-blue-700">{showHistory ? '收起历史结果' : `查看全部 ${matches.length} 项交付`}</button>}
        </div>;
      })}
    </div>
    {selected && createPortal(<div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/40" onClick={event => { if (event.target === event.currentTarget) setSelectedId(''); }}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="delivery-detail-title" className="h-full w-full max-w-3xl overflow-y-auto bg-white shadow-2xl outline-none">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5"><div><p className="text-xs font-bold text-blue-700">{selected.kind} · {columns.find(column => column.id === selected.column)?.label}</p><h2 id="delivery-detail-title" className="mt-1 text-xl font-black text-slate-950">{selected.title}</h2><p className="mt-1 text-xs text-slate-500">{selected.subject}</p></div><button type="button" aria-label="关闭交付详情" onClick={() => setSelectedId('')} className="rounded-lg p-2 hover:bg-slate-100"><X size={20}/></button></header>
        <div className="space-y-6 p-6">
          <section><h3 className="text-sm font-bold text-slate-900">交付目标</h3><p className="mt-2 text-sm leading-6 text-slate-600">{selected.acceptance}</p><p className="mt-2 text-xs text-slate-400">所属目标：{goalTitle}</p></section>
          <section className="rounded-2xl bg-slate-50 p-4"><h3 className="text-sm font-bold text-slate-900">生产实况 · {selected.stage}</h3><p className="mt-1 text-xs text-slate-400">最近更新 {date(selected.updatedAt)}</p><div className="mt-3 flex flex-wrap gap-2">{selected.steps.map(step => <span key={step.label} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs ${step.state === 'done' ? 'bg-emerald-50 text-emerald-700' : step.state === 'active' ? 'bg-blue-50 text-blue-700' : 'bg-white text-slate-400'}`}>{step.state === 'done' ? <CheckCircle2 size={12}/> : <Clock3 size={12}/>} {step.label}</span>)}</div>
            {selected.reason && <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-800"><AlertTriangle size={16} className="mt-1 shrink-0"/>{selected.reason}</p>}
            <div className="mt-4 flex flex-wrap gap-2">{selected.column === 'human' && <button type="button" onClick={() => process(selected)} className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white">{selected.kind === '客服草稿' ? '审核所属批次' : '处理当前问题'}</button>}{selected.link && <button type="button" onClick={() => { setSelectedId(''); onOpenTask({ ...selected.link!, businessRef: { ...selected.link!.businessRef, deliveryId: selected.id } }); }} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-xs font-bold text-blue-700">{selected.actionLabel}<ExternalLink size={12}/></button>}<button type="button" onClick={() => process(selected)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs text-slate-600">查看任务记录与纠偏</button></div>
          </section>
          {latestScreen?.screenshotUrl && <section><h3 className="mb-3 text-sm font-bold text-slate-900">最近一次生产现场</h3><img src={safeDeliveryUrl(latestScreen.screenshotUrl)} alt={latestScreen.label || "生产现场截图"} className="w-full rounded-xl border border-slate-200"/></section>}
          <section><h3 className="text-sm font-bold text-slate-900">{selected.column === 'done' ? '交付结果' : '当前产物与版本'}</h3>{selected.artifacts.length ? <><div className="my-3 flex flex-wrap gap-2">{selected.artifacts.map(item => <button type="button" aria-pressed={artifact?.id === item.id} key={item.id} onClick={() => setArtifactId(item.id)} className={`rounded-lg border px-3 py-2 text-xs ${artifact?.id === item.id ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>{item.label} {item.version}</button>)}</div>{artifact && <><ArtifactPreview artifact={artifact}/><div className="mt-3">{artifact.kind === 'text' ? <button type="button" onClick={() => downloadText(artifact)} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700"><Download size={13}/>下载{artifact.label}</button> : artifact.kind !== 'link' && safeDeliveryUrl(artifact.url) && <a href={safeDeliveryUrl(artifact.url)} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-700"><Download size={13}/>下载 / 打开{artifact.label}</a>}</div></>}</> : <p className="mt-3 rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">尚未产生可查看的产物。{selected.reason}</p>}</section>
          {selected.narrationEdit && <section><h3 className="text-sm font-bold">修改口播并重新制作</h3><p className="my-2 text-xs text-slate-500">每行对应原来的一段；保存后重新生成配音、字幕与成片，旧审批失效。</p><textarea aria-label="修改成片口播" className="min-h-36 w-full rounded-lg border p-3 text-sm" value={editedNarration[selected.id] ?? selected.narrationEdit.lines.join('\n')} onChange={event => setEditedNarration({ ...editedNarration, [selected.id]: event.target.value })}/><button type="button" disabled={accepting} className="mt-2 rounded-lg border px-3 py-2 text-sm" onClick={async () => { setAccepting(true); setAcceptanceNotice(''); try { const response = await fetch(`/api/overseas/digital-employees/content-projects/${encodeURIComponent(selected.id.replace('studio_project:', ''))}/narration`, { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: selected.narrationEdit!.hash, lines: (editedNarration[selected.id] ?? selected.narrationEdit!.lines.join('\n')).split('\n').map(line => line.trim()).filter(Boolean) }) }); const result = await response.json(); if (!response.ok) throw Error(result.error); setAcceptanceNotice('口播已保存为新版本，请刷新生产现场推进重新制作'); onAccepted?.(); } catch (error) { setAcceptanceNotice(error instanceof Error ? error.message : '修改失败'); } finally { setAccepting(false); } }}>保存口播并重新制作</button>{acceptanceNotice && <p role="status" className="mt-2 text-xs">{acceptanceNotice}</p>}</section>}
          {selected.contentApproval && <section><button type="button" disabled={accepting || selected.contentApproval.approved} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50" onClick={async () => { setAccepting(true); setAcceptanceNotice(''); try { const response = await fetch(`/api/overseas/digital-employees/content-projects/${encodeURIComponent(selected.id.replace('studio_project:', ''))}/approve`, { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: selected.contentApproval!.hash }) }); const data = await response.json(); if (!response.ok) throw Error(data.error); setAcceptanceNotice('已确认当前版本'); onAccepted?.(); } catch (error) { setAcceptanceNotice(error instanceof Error ? error.message : '确认失败'); } finally { setAccepting(false); } }}>{selected.contentApproval.approved ? '此版本已人工确认' : '已预览并确认此版本内容'}</button>{acceptanceNotice && <p role="status" className="mt-2 text-xs">{acceptanceNotice}</p>}</section>}
          <section><h3 className="text-sm font-bold text-slate-900">业务结果与经营效果</h3><p className="mt-2 text-sm text-slate-600">{selected.effect || '此任务交付业务资料，不代表发生发布或发送。'}</p>{selected.metrics.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2">{selected.metrics.map(metric => <div key={metric.label} className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">{metric.label}<strong className="mt-1 block text-sm text-slate-800">{metric.value === null ? '待回收' : metric.value}</strong></div>)}</div>}</section>
          <section><h3 className="text-sm font-bold text-slate-900">执行记录</h3><div className="mt-3 space-y-3">{events.filter(event => selected.taskIds.includes(event.task_id)).slice(-8).reverse().map(event => <div key={event.id} className="border-l-2 border-slate-200 pl-3"><p className="text-xs leading-5 text-slate-600">{event.summary}</p><p className="text-[10px] text-slate-400">{date(event.occurred_at)}</p></div>)}{!events.some(event => selected.taskIds.includes(event.task_id)) && <p className="text-xs text-slate-400">尚无执行记录</p>}</div></section>
        </div>
      </div>
    </div>, document.body)}
  </section>;
}
