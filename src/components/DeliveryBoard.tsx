import { authHeader } from '../lib/auth';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, CheckCircle2, Clock3, ExternalLink, FileText, MonitorPlay, X, AlertTriangle, Download } from 'lucide-react';
import { fallbackDelivery, filterDeliveries, isDeliveryStale, safeDeliveryUrl, type DeliveryArtifact, type DeliveryResource } from '../lib/delivery';
import { agentUiActionFromEvent } from '../lib/digitalEmployees';
import type { DigitalEmployeeDeepLink, RunEvent, WorkflowTask } from '../lib/digitalEmployees';
import { useModalFocus } from '../hooks/useModalFocus';

const columns = [{ id: 'todo', label: '待开始' }, { id: 'active', label: '生产中' }, { id: 'human', label: '待你处理' }, { id: 'done', label: '已交付' }] as const;
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '尚未记录';

function ArtifactPreview({ artifact }: { artifact: DeliveryArtifact }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [artifact.id, artifact.url]);
  const url = safeDeliveryUrl(artifact.url);
  if (failed) return <p role="alert" className="border-l-2 border-amber bg-amber-dim p-4 text-sm text-amber">产物暂时无法加载，请进入业务页面核对或刷新重试。</p>;
  if (artifact.kind === 'video' && url) return <video aria-label={artifact.label} controls preload="metadata" src={url} onError={() => setFailed(true)} className="max-h-[48vh] w-full rounded-md bg-black"/>;
  if (artifact.kind === 'audio' && url) return <audio aria-label={artifact.label} controls preload="metadata" src={url} onError={() => setFailed(true)} className="w-full"/>;
  if (artifact.kind === 'image' && url) return <img src={url} alt={artifact.label} onError={() => setFailed(true)} className="max-h-[48vh] w-full rounded-md object-contain"/>;
  if (artifact.kind === 'link' && url) return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border border-accent/25 bg-surface px-4 py-3 text-sm font-bold text-accent">打开{artifact.label}<ExternalLink size={14}/></a>;
  return <p className="max-h-[48vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-4 text-sm leading-7 text-text-secondary">{artifact.text || '尚无可预览的内容'}</p>;
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
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const visibleTaskIds = new Set(tasks.map(task => task.id));
  const cards = deliveries ? deliveries.filter(card => card.taskIds.some(id => visibleTaskIds.has(id))) : tasks.map(task => fallbackDelivery(task, goalTitle));
  const filtered = filterDeliveries(cards, { query, kind, subject, period, exceptions, now });
  const selected = cards.find(card => card.id === selectedId);
  const dialog = useModalFocus<HTMLDivElement>({
    open: Boolean(selected),
    onClose: () => setSelectedId(''),
  });
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
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = old; };
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
  return <section className="border-y border-border bg-surface py-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold text-text-primary">业务交付看板</h2><p className="mt-1 text-xs text-text-muted">查看真实生产进展、处理待办、领取业务结果</p></div>
      {onOpenMonitor && <button onClick={onOpenMonitor} type="button" className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs font-bold text-text-secondary transition hover:border-accent/40 hover:text-accent"><MonitorPlay size={14}/>打开监控大屏</button>}
    </div>
    {notice && <p role="alert" className="mt-3 border-l-2 border-amber bg-amber-dim p-3 text-xs text-amber">{notice}</p>}
    <div className="mt-4 grid grid-cols-2 border-y border-border lg:grid-cols-4">
      {[['待你处理', cards.filter(card => card.column === 'human').length, 'text-amber'], ['生产中', cards.filter(card => card.column === 'active').length, 'text-accent'], ['异常 / 久未更新', cards.filter(card => card.exception || isDeliveryStale(card, now)).length, 'text-red'], ['今日已交付', cards.filter(card => card.column === 'done' && Date.parse(card.deliveredAt || '') >= today.getTime()).length, 'text-accent']].map(([label, count, tone], index) => <div key={label} className={`flex items-center justify-between px-4 py-3 ${index % 2 === 0 ? 'border-r border-border' : ''} ${index < 2 ? 'border-b border-border lg:border-b-0' : ''} ${index === 1 ? 'lg:border-r lg:border-border' : ''} ${index === 2 ? 'lg:border-r lg:border-border' : ''}`}><span className="text-xs font-bold text-text-secondary">{label}</span><strong className={`text-xl ${tone}`}>{count}</strong></div>)}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-border pb-4">
      <input aria-label="搜索交付任务" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索任务、账号或客户" className="ui-field min-w-48 flex-1 !min-h-9 !rounded-md !px-3 !py-2 !text-xs"/>
      <select aria-label="任务类型" value={kind} onChange={e => setKind(e.target.value)} className="ui-field ui-select max-w-48 !min-h-9 !rounded-md !px-3 !py-2 !text-xs"><option value="all">全部任务类型</option>{[...new Set(cards.map(card => card.kind))].map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="账号或客户" value={subject} onChange={e => setSubject(e.target.value)} className="ui-field ui-select max-w-48 !min-h-9 !rounded-md !px-3 !py-2 !text-xs"><option value="all">全部业务对象</option>{[...new Set(cards.map(card => card.subject))].map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="更新时间" value={period} onChange={e => setPeriod(e.target.value)} className="ui-field ui-select max-w-44 !min-h-9 !rounded-md !px-3 !py-2 !text-xs"><option value="all">本轮全部时间</option><option value="today">今天</option><option value="week">最近 7 天</option></select>
      <button type="button" aria-pressed={exceptions} onClick={() => setExceptions(!exceptions)} className={`rounded-md border px-3 py-2 text-xs font-bold transition ${exceptions ? 'border-red/30 bg-red/5 text-red' : 'border-border text-text-secondary hover:border-red/25 hover:text-red'}`}>只看异常</button>
    </div>
    <div className="mt-4 grid md:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-border">
      {columns.map(column => {
        const matches = filtered.filter(card => card.column === column.id);
        const shown = column.id === 'done' && !showHistory ? matches.slice(0, 6) : matches;
        return <div key={column.id} className="min-w-0 border-b border-border px-3 pb-4 pt-1 md:odd:border-r md:even:border-r-0 xl:border-b-0 xl:border-r-0 xl:first:pl-0 xl:last:pr-0"><div className="mb-3 flex items-center justify-between border-b border-border pb-2 text-xs font-bold text-text-secondary"><h3>{column.label}</h3><span className="tabular-nums text-text-muted">{matches.length}</span></div>
          <div className="space-y-2.5">{shown.map(card => {
            const stale = isDeliveryStale(card, now);
            const preview = card.artifacts.find(item => item.kind === 'video') || card.artifacts.find(item => item.id === 'draft') || card.artifacts[0];
            return <article key={card.id} className={`min-w-0 overflow-hidden rounded-md border bg-surface ${card.exception ? 'border-red/25' : card.column === 'human' ? 'border-amber/25' : 'border-border'}`}>
              <button type="button" onClick={() => open(card)} className="w-full p-4 text-left transition hover:bg-surface-2/45 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent">
                <div className="flex items-start justify-between gap-2 text-[10px] font-bold"><span className="text-text-muted">{card.kind}</span>{(card.exception || stale) && <span className="text-red">{card.exception ? '执行异常' : '30 分钟未更新'}</span>}</div>
                <h4 className="mt-2 break-words text-sm font-bold leading-5 text-text-primary">{card.title}</h4>
                <p className="mt-1 truncate text-[11px] text-text-muted" title={card.subject}>{card.subject}</p>
                <div className={`mt-3 border-l-2 pl-3 ${card.reason ? 'border-amber' : card.column === 'done' ? 'border-accent' : 'border-border-bright'}`}><p className="text-xs font-bold text-text-secondary">{card.stage}</p><p className={`mt-1 text-[11px] leading-5 ${card.reason ? 'text-amber' : 'text-text-muted'}`}>{card.reason || card.acceptance}</p></div>
                {card.steps.length > 0 && <p className="mt-2 text-[10px] text-text-muted">{card.steps.filter(step => step.state === 'done').length} / {card.steps.length} 个生产步骤完成</p>}
                <p className="mt-2 text-[10px] text-text-muted">{card.column === 'done' ? '交付于' : '更新于'} {date(card.deliveredAt || card.updatedAt)}</p>
              </button>
              {preview && <button type="button" onClick={() => open(card, preview)} className="mx-4 mb-3 block w-[calc(100%-2rem)] border-t border-border pt-2.5 text-left"><span className="flex items-center gap-1.5 text-xs font-bold text-accent">{preview.kind === 'video' ? <MonitorPlay size={14}/> : <FileText size={14}/>}预览{preview.label} {preview.version}</span>{preview.text && <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-muted">{preview.text}</p>}</button>}
              <div className="border-t border-border px-4 py-3"><button type="button" onClick={() => open(card)} className="inline-flex items-center gap-1 text-xs font-bold text-accent">{card.column === 'done' ? '查看交付结果' : card.column === 'human' ? '审核与处理' : '查看生产实况'}<ArrowRight size={12}/></button>{card.effect && <p className="mt-2 text-[10px] text-text-muted">{card.effect}</p>}</div>
            </article>;
          })}{!shown.length && <p className="border-y border-dashed border-border p-6 text-center text-xs text-text-muted">{query || exceptions || kind !== 'all' || subject !== 'all' || period !== 'all' ? '没有匹配的任务' : '暂无任务'}</p>}</div>
          {column.id === 'done' && matches.length > 6 && <button type="button" onClick={() => setShowHistory(!showHistory)} className="mt-3 w-full py-2 text-xs font-bold text-accent">{showHistory ? '收起历史结果' : `查看全部 ${matches.length} 项交付`}</button>}
        </div>;
      })}
    </div>
    {selected && createPortal(<div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/40" onClick={event => { if (event.target === event.currentTarget) setSelectedId(''); }}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="delivery-detail-title" className="h-full w-full max-w-3xl overflow-y-auto border-l border-border bg-surface shadow-2xl outline-none">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface px-6 py-5"><div><p className="text-xs font-bold text-accent">{selected.kind} · {columns.find(column => column.id === selected.column)?.label}</p><h2 id="delivery-detail-title" className="mt-1 text-xl font-bold text-text-primary">{selected.title}</h2><p className="mt-1 text-xs text-text-muted">{selected.subject}</p></div><button type="button" data-modal-initial-focus aria-label="关闭交付详情" onClick={() => setSelectedId('')} className="rounded-md p-2 text-text-muted transition hover:bg-surface-2 hover:text-text-primary"><X size={20}/></button></header>
        <div className="space-y-6 p-6">
          <section><h3 className="text-sm font-bold text-text-primary">交付目标</h3><p className="mt-2 text-sm leading-6 text-text-secondary">{selected.acceptance}</p><p className="mt-2 text-xs text-text-muted">所属目标：{goalTitle}</p></section>
          <section className="border-y border-border bg-surface-2/45 py-4"><h3 className="text-sm font-bold text-text-primary">生产实况 · {selected.stage}</h3><p className="mt-1 text-xs text-text-muted">最近更新 {date(selected.updatedAt)}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">{selected.steps.map(step => <span key={step.label} className={`inline-flex items-center gap-1 text-xs ${step.state === 'done' ? 'text-accent' : step.state === 'active' ? 'font-bold text-text-primary' : 'text-text-muted'}`}>{step.state === 'done' ? <CheckCircle2 size={12}/> : <Clock3 size={12}/>} {step.label}</span>)}</div>
            {selected.reason && <p className="mt-3 flex items-start gap-2 border-l-2 border-amber bg-amber-dim p-3 text-sm leading-6 text-amber"><AlertTriangle size={16} className="mt-1 shrink-0"/>{selected.reason}</p>}
            <div className="mt-4 flex flex-wrap gap-2">{selected.column === 'human' && <button type="button" onClick={() => process(selected)} className="rounded-md bg-accent px-4 py-2 text-xs font-bold text-white">{selected.kind === '客服草稿' ? '审核所属批次' : '处理当前问题'}</button>}{selected.link && <button type="button" onClick={() => { setSelectedId(''); onOpenTask({ ...selected.link!, businessRef: { ...selected.link!.businessRef, deliveryId: selected.id } }); }} className="inline-flex items-center gap-2 rounded-md border border-accent/25 bg-surface px-4 py-2 text-xs font-bold text-accent">{selected.actionLabel}<ExternalLink size={12}/></button>}<button type="button" onClick={() => process(selected)} className="rounded-md border border-border px-4 py-2 text-xs text-text-secondary">查看任务记录与纠偏</button></div>
          </section>
          {latestScreen?.screenshotUrl && <section><h3 className="mb-3 text-sm font-bold text-text-primary">最近一次生产现场</h3><img src={safeDeliveryUrl(latestScreen.screenshotUrl)} alt={latestScreen.label || "生产现场截图"} className="w-full rounded-md border border-border"/></section>}
          <section><h3 className="text-sm font-bold text-text-primary">{selected.column === 'done' ? '交付结果' : '当前产物与版本'}</h3>{selected.artifacts.length ? <><div className="my-3 flex flex-wrap gap-4 border-b border-border">{selected.artifacts.map(item => <button type="button" aria-pressed={artifact?.id === item.id} key={item.id} onClick={() => setArtifactId(item.id)} className={`border-b-2 px-1 py-2 text-xs font-bold ${artifact?.id === item.id ? 'border-accent text-accent' : 'border-transparent text-text-muted'}`}>{item.label} {item.version}</button>)}</div>{artifact && <><ArtifactPreview artifact={artifact}/><div className="mt-3">{artifact.kind === 'text' ? <button type="button" onClick={() => downloadText(artifact)} className="inline-flex items-center gap-1 text-xs font-bold text-accent"><Download size={13}/>下载{artifact.label}</button> : artifact.kind !== 'link' && safeDeliveryUrl(artifact.url) && <a href={safeDeliveryUrl(artifact.url)} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-accent"><Download size={13}/>下载 / 打开{artifact.label}</a>}</div></>}</> : <p className="mt-3 border-y border-dashed border-border p-6 text-sm text-text-muted">尚未产生可查看的产物。{selected.reason}</p>}</section>
          {selected.narrationEdit && <section><h3 className="text-sm font-bold text-text-primary">修改口播并重新制作</h3><p className="my-2 text-xs text-text-muted">每行对应原来的一段；保存后重新生成配音、字幕与成片，旧审批失效。</p><textarea aria-label="修改成片口播" className="ui-field min-h-36 w-full !rounded-md p-3 text-sm" value={editedNarration[selected.id] ?? selected.narrationEdit.lines.join('\n')} onChange={event => setEditedNarration({ ...editedNarration, [selected.id]: event.target.value })}/><button type="button" disabled={accepting} className="mt-2 rounded-md border border-border px-3 py-2 text-sm font-bold text-text-secondary" onClick={async () => { setAccepting(true); setAcceptanceNotice(''); try { const response = await fetch(`/api/overseas/digital-employees/content-projects/${encodeURIComponent(selected.id.replace('studio_project:', ''))}/narration`, { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: selected.narrationEdit!.hash, lines: (editedNarration[selected.id] ?? selected.narrationEdit!.lines.join('\n')).split('\n').map(line => line.trim()).filter(Boolean) }) }); const result = await response.json(); if (!response.ok) throw Error(result.error); setAcceptanceNotice('口播已保存为新版本，请刷新生产现场推进重新制作'); onAccepted?.(); } catch (error) { setAcceptanceNotice(error instanceof Error ? error.message : '修改失败'); } finally { setAccepting(false); } }}>保存口播并重新制作</button>{acceptanceNotice && <p role="status" className="mt-2 text-xs text-text-secondary">{acceptanceNotice}</p>}</section>}
          {selected.contentApproval && <section><button type="button" disabled={accepting || selected.contentApproval.approved} className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={async () => { setAccepting(true); setAcceptanceNotice(''); try { const response = await fetch(`/api/overseas/digital-employees/content-projects/${encodeURIComponent(selected.id.replace('studio_project:', ''))}/approve`, { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: selected.contentApproval!.hash }) }); const data = await response.json(); if (!response.ok) throw Error(data.error); setAcceptanceNotice('已确认当前版本'); onAccepted?.(); } catch (error) { setAcceptanceNotice(error instanceof Error ? error.message : '确认失败'); } finally { setAccepting(false); } }}>{selected.contentApproval.approved ? '此版本已人工确认' : '已预览并确认此版本内容'}</button>{acceptanceNotice && <p role="status" className="mt-2 text-xs text-text-secondary">{acceptanceNotice}</p>}</section>}
          <section><h3 className="text-sm font-bold text-text-primary">业务结果与经营效果</h3><p className="mt-2 text-sm text-text-secondary">{selected.effect || '此任务交付业务资料，不代表发生发布或发送。'}</p>{selected.metrics.length > 0 && <div className="mt-3 grid grid-cols-2 border-y border-border">{selected.metrics.map((metric, index) => <div key={metric.label} className={`p-3 text-xs text-text-muted ${index % 2 === 0 ? 'border-r border-border' : ''}`}><span>{metric.label}</span><strong className="mt-1 block text-sm text-text-primary">{metric.value === null ? '待回收' : metric.value}</strong></div>)}</div>}</section>
          <section><h3 className="text-sm font-bold text-text-primary">执行记录</h3><div className="mt-3 space-y-3">{events.filter(event => selected.taskIds.includes(event.task_id)).slice(-8).reverse().map(event => <div key={event.id} className="border-l-2 border-border pl-3"><p className="text-xs leading-5 text-text-secondary">{event.summary}</p><p className="text-[10px] text-text-muted">{date(event.occurred_at)}</p></div>)}{!events.some(event => selected.taskIds.includes(event.task_id)) && <p className="text-xs text-text-muted">尚无执行记录</p>}</div></section>
        </div>
      </div>
    </div>, document.body)}
  </section>;
}
