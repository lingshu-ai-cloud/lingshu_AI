import { pushProductionLocation } from '../lib/productionNavigation';
import { authHeader } from '../lib/auth';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  MonitorPlay,
  MousePointer2,
  RefreshCcw,
  ShieldAlert,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  agentUiActionFromEvent,
  buildTaskDeepLink,
  digitalEmployeeApi,
  dispatchDigitalEmployeeDeepLink,
  streamRunEvents,
  type DigitalEmployeeOverview,
  type PlanTask,
  type RunEvent,
  type WorkflowTask,
} from "../lib/digitalEmployees";

import AgentBrowserViewport from "./AgentBrowserViewport";
import { groupMonitorEvents, mergeMonitorEvents } from "../lib/agentMonitor";
import { useModalFocus } from "../hooks/useModalFocus";

type MonitorFilter = "all" | "content" | "customer";
type MonitorStatusFilter = "all" | "active" | "attention";
type ConnectionState = "idle" | "connecting" | "live" | "reconnecting" | "offline";

const statusLabel: Record<string, string> = {
  pending: "待执行",
  planning: "规划中",
  running: "执行中",
  waiting_external: "等待回执",
  waiting_approval: "待审批",
  waiting_human: "待人工",
  handed_off: "人工接管",
  succeeded: "已完成",
  completed: "已完成",
  failed: "异常",
  paused: "已暂停",
  cancelled: "已取消",
};

function taskMonitorGroup(task: WorkflowTask): Exclude<MonitorFilter, "all"> | null {
  const domain = String(task.business_domain || "").toLowerCase();
  if (domain === "customer" || task.agent_role === "customer") return "customer";
  if (["content", "publishing", "social", "industry"].includes(domain)) return "content";
  if (["content", "publishing", "risk", "channel", "knowledge"].includes(task.agent_role)) return "content";
  return null;
}

const connectionLabel: Record<ConnectionState, string> = {
  idle: "等待运行",
  connecting: "正在连接",
  live: "实时已连接",
  reconnecting: "正在重连",
  offline: "连接中断",
};

function relativeSignalTime(value?: string) {
  if (!value) return "尚无事件";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return "刚刚更新";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} 分钟前` : `${Math.floor(minutes / 60)} 小时前`;
}

function MonitorWindow({ task, events, planTasks, runId, onFocus, liveEnabled = true }: { liveEnabled?: boolean; task: WorkflowTask; events: RunEvent[]; planTasks: PlanTask[]; runId: string; onFocus?: () => void }) {
  const group = taskMonitorGroup(task);
  const latestEvent = events.at(-1);
  const routingCheck = task.output?.routingCheck as { count?: number; reason?: string } | undefined;
  const planTask = planTasks.find((item) => item.key === task.task_key);
  const link = buildTaskDeepLink(task, planTask, runId || task.run_id);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const openWorkPage = async () => {
    setOpening(true); setOpenError('');
    try {
      const response = await fetch(`/api/overseas/digital-employees/runs/${encodeURIComponent(runId || task.run_id)}/tasks/${encodeURIComponent(task.id)}/workspace`, { headers: authHeader() });
      if (!response.ok) throw new Error('工作页面加载失败，请重试');
      const target = await response.json();
      dispatchDigitalEmployeeDeepLink({ ...link, ...target.link });
    } catch (error) { setOpenError(error instanceof Error ? error.message : '无法打开工作页'); }
    finally { setOpening(false); }
  };
  const active = ["running", "planning"].includes(task.status);

  return (
    <article className="group overflow-hidden rounded-lg border border-border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-2/60 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-accent" : task.status === "failed" ? "bg-red" : "bg-border-bright"}`} />
            <p className="truncate text-xs font-bold text-text-primary">{task.title}</p>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-text-muted">{group === "customer" ? "客服 Agent" : "内容 Agent"} · {statusLabel[task.status] || task.status}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onFocus && <button type="button" onClick={onFocus} className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition hover:border-accent/40 hover:text-accent" aria-label={`放大查看${task.title}`}><Maximize2 size={11}/></button>}
          <button type="button" disabled={opening} onClick={() => void openWorkPage()} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[10px] font-bold text-text-secondary transition hover:border-accent/40 hover:text-accent disabled:cursor-wait disabled:opacity-50">工作页 <ExternalLink size={10} /></button>
        </div>
      </header>

      {openError && <p role="alert" className="border-t border-red/15 bg-red/5 p-3 text-xs text-red">{openError}</p>}
      <AgentBrowserViewport enabled={liveEnabled} runId={runId || task.run_id} taskId={task.id} taskStatus={task.status} />

      {task.status === 'waiting_external' && routingCheck?.count && <p className="border-l-2 border-amber bg-amber-dim px-3 py-2 text-xs text-amber">等待条件：{routingCheck.reason} · 已检查 {routingCheck.count} 次</p>}
      <details className="border-t border-border px-3 py-2">
        <summary className="cursor-pointer text-[10px] font-bold text-text-muted">执行记录 · {events.length} 条</summary>
        <div className="mt-2 max-h-36 space-y-2 overflow-y-auto">{events.length ? groupMonitorEvents(events).reverse().slice(0, 5).map(event => <div key={event.id} className="flex items-start gap-3 text-[10px] leading-5"><time className="shrink-0 text-text-muted">{new Date(event.occurred_at).toLocaleTimeString("zh-CN")}</time><p className={event.level === "error" ? "text-red" : "text-text-secondary"}>{event.summary}{event.repeatCount > 1 && <span className="ml-2 text-text-muted">（连续 {event.repeatCount} 次）</span>}</p></div>) : <p className="text-[11px] text-text-muted">尚无执行事件</p>}</div>
      </details>

      <footer className="flex items-center justify-between gap-3 border-t border-border/70 px-3 py-2.5 text-[10px] text-text-muted">
        <span className="truncate">{latestEvent?.summary || "等待任务事件"}</span>
        <span className="shrink-0">{relativeSignalTime(latestEvent?.occurred_at)}</span>
      </footer>
    </article>
  );
}

function FocusedMonitor({ task, events, planTasks, runId, onClose }: { task: WorkflowTask; events: RunEvent[]; planTasks: PlanTask[]; runId: string; onClose: () => void }) {
  const actions = events.map(agentUiActionFromEvent).filter(Boolean);
  const dialogRef = useModalFocus<HTMLDivElement>({
    open: true,
    onClose,
    closeOnEscape: () => !document.fullscreenElement,
  });
  return <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[100] bg-slate-950/75 p-3 backdrop-blur-sm lg:p-6" role="dialog" aria-modal="true" aria-labelledby="focused-monitor-dialog-title">
    <div className="mx-auto flex h-full max-w-[1800px] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
      <header className="flex items-center justify-between border-b border-border px-4 py-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Focused live session</p><h2 id="focused-monitor-dialog-title" className="mt-1 text-sm font-bold text-text-primary">{task.title}</h2></div><button type="button" data-modal-initial-focus onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition hover:bg-surface-2 hover:text-text-primary" aria-label="关闭放大监控"><X size={15}/></button></header>
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto bg-surface-2/40 p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="self-start"><MonitorWindow task={task} events={events} planTasks={planTasks} runId={runId}/></div>
        <aside className="rounded-lg border border-border bg-surface p-4"><div className="flex items-center justify-between"><h3 className="text-xs font-bold text-text-primary">实时操作轨迹</h3><span className="text-[10px] text-text-muted">{actions.length} 条 UI 操作</span></div><div className="mt-3 divide-y divide-border border-y border-border">{events.length ? groupMonitorEvents(events).reverse().slice(0,20).map((event) => { const action = agentUiActionFromEvent(event); return <div key={event.id} className="px-1 py-2.5"><div className="flex items-start gap-2">{action ? <MousePointer2 size={12} className="mt-0.5 shrink-0 text-accent"/> : <Clock3 size={12} className="mt-0.5 shrink-0 text-text-muted"/>}<div className="min-w-0"><p className="text-[11px] font-bold leading-4 text-text-secondary">{event.summary}{event.repeatCount > 1 && <span className="ml-2 text-text-muted">（连续 {event.repeatCount} 次）</span>}</p><p className="mt-1 text-[9px] text-text-muted">{action?.kind || event.type} · {new Date(event.occurred_at).toLocaleTimeString("zh-CN")}</p></div></div></div>; }) : <p className="border-dashed px-3 py-10 text-center text-[10px] text-text-muted">尚无真实事件</p>}</div></aside>
      </div>
    </div>
  </div>;
}

export default function AgentMonitorPage({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<DigitalEmployeeOverview | null>(null);
  const [filter, setFilter] = useState<MonitorFilter>("all");
  const [statusFilter, setStatusFilter] = useState<MonitorStatusFilter>("all");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [lastSignalAt, setLastSignalAt] = useState("");
  const [focusedTaskId, setFocusedTaskId] = useState("");
  const focusTask = (id: string) => {
    pushProductionLocation('agentMonitor', { monitorTaskId: id });
    setFocusedTaskId(id);
  };
  const closeFocus = () => {
    if (window.history.state?.monitorTaskId) window.history.back();
    else setFocusedTaskId('');
  };
  useEffect(() => {
    const restoreFocus = () => { if (window.history.state?.productionPage === 'agentMonitor') setFocusedTaskId(window.history.state?.monitorTaskId || ''); };
    restoreFocus();
    window.addEventListener('popstate', restoreFocus);
    return () => window.removeEventListener('popstate', restoreFocus);
  }, []);
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const initialEventsRef = useRef<RunEvent[]>([]);
  const loadInFlight = useRef(false);

  const load = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    try {
      const overview = await digitalEmployeeApi.overview();
      setData(current => {
        const events = mergeMonitorEvents(overview.run?.id || '', current?.events || [], overview.events);
        return { ...overview, events };
      });
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "监控数据加载失败");
    } finally {
      loadInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initialEventsRef.current = data?.events || [];
    setLastSignalAt(data?.events.at(-1)?.occurred_at || '');
  }, [data?.events]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const run = data?.run;
    if (!run || ["succeeded", "failed", "cancelled"].includes(run.status)) {
      setConnection("idle");
      return;
    }
    let disposed = false;
    let after = Math.max(0, ...initialEventsRef.current.map((event) => Number(event.sequence) || 0));
    let reconnects = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const reconnect = async () => {
      while (!disposed) {
        setConnection(reconnects ? "reconnecting" : "connecting");
        try {
          await streamRunEvents(run.id, after, (event) => {
            after = Math.max(after, Number(event.sequence) || 0);
            setLastSignalAt(event.occurred_at || new Date().toISOString());
            setData((current) => current && current.run?.id === run.id ? { ...current, events: mergeMonitorEvents(run.id, current.events, [event]) } : current);
            if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = undefined; void load(); }, 500);
          }, controller.signal, () => {
            reconnects = 0;
            setConnection("live");
          });
        } catch {
          if (disposed || controller.signal.aborted) break;
          setConnection("offline");
        }
        reconnects += 1;
        await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, 750 * reconnects)));
      }
    };
    void reconnect();
    return () => {
      disposed = true;
      controller.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [data?.run?.id, data?.run?.status, load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setError("");
    } catch {
      setError("浏览器未允许进入全屏，请检查当前窗口权限后重试。");
    }
  };

  const eventsByTask = useMemo(() => {
    const grouped = new Map<string, RunEvent[]>();
    for (const event of data?.events || []) {
      if (!event.task_id) continue;
      const items = grouped.get(event.task_id) || [];
      items.push(event);
      grouped.set(event.task_id, items);
    }
    return grouped;
  }, [data?.events]);

  const monitoredTasks = useMemo(() => (data?.tasks || []).filter((task) => {
    const group = taskMonitorGroup(task);
    if (!group || (filter !== "all" && group !== filter)) return false;
    if (statusFilter === "active") return ["running", "planning"].includes(task.status);
    if (statusFilter === "attention") return ["waiting_approval", "waiting_human", "handed_off", "failed"].includes(task.status);
    return true;
  }), [data?.tasks, filter, statusFilter]);
  const activeCount = monitoredTasks.filter((task) => ["running", "planning"].includes(task.status)).length;
  const humanCount = monitoredTasks.filter((task) => ["waiting_approval", "waiting_human", "handed_off", "failed"].includes(task.status)).length;
  const attentionTasks = (data?.tasks || []).filter((task) => taskMonitorGroup(task) && ["waiting_approval", "waiting_human", "handed_off", "failed"].includes(task.status));
  const focusedTask = (data?.tasks || []).find((task) => task.id === focusedTaskId);

  if (loading) return <div className="flex h-full items-center justify-center bg-surface-2"><Loader2 className="animate-spin text-accent" /></div>;

  return (
    <main className="h-full overflow-y-auto bg-ink px-4 py-4 text-text-primary lg:px-6">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 px-1 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={onBack} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-secondary transition hover:border-accent/40 hover:text-accent" aria-label="返回智能经营"><ArrowLeft size={16} /></button>
            <div className="min-w-0"><div className="flex items-center gap-2"><MonitorPlay size={18} className="text-accent" /><h1 className="truncate text-base font-bold">Agent 实时生产监控大屏</h1></div><p className="mt-0.5 text-[11px] text-text-muted">每个窗口都是独立的任务浏览器 · 实际鼠标操作与工作页面同步直播</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 border-r border-border pr-3 text-[10px] font-bold ${connection === "live" ? "text-accent" : connection === "offline" ? "text-red" : "text-text-muted"}`}>{connection === "live" ? <Wifi size={11}/> : <WifiOff size={11}/>} {connectionLabel[connection]}{lastSignalAt ? ` · ${relativeSignalTime(lastSignalAt)}` : ""}</span>
            <span className="border-r border-border pr-3 text-[10px] font-bold text-text-muted">{monitoredTasks.length} 个窗口</span>
            <span className="border-r border-border pr-3 text-[10px] font-bold text-accent">{activeCount} 执行中</span>
            <span className="text-[10px] font-bold text-amber">{humanCount} 待人工</span>
            <button type="button" onClick={() => void load()} className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text-secondary transition hover:border-accent/40 hover:text-accent" aria-label="刷新监控大屏"><RefreshCcw size={14} /></button>
            <button type="button" onClick={() => void toggleFullscreen()} className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text-secondary transition hover:border-accent/40 hover:text-accent" aria-label={fullscreen ? "退出全屏" : "进入全屏"}>{fullscreen ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-border">
          <div className="flex flex-wrap gap-5">{([['all','全部现场'],['content','内容 Agent'],['customer','客服 Agent']] as Array<[MonitorFilter,string]>).map(([id,label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={`border-b-2 px-1 py-2.5 text-[11px] font-bold transition ${filter === id ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text-primary"}`}>{label}</button>)}</div>
          <div className="flex flex-wrap gap-4">{([['all','全部状态'],['active','仅执行中'],['attention','只看待处理']] as Array<[MonitorStatusFilter,string]>).map(([id,label]) => <button key={id} type="button" aria-pressed={statusFilter === id} onClick={() => setStatusFilter(id)} className={`border-b-2 px-1 py-2.5 text-[10px] font-bold transition ${statusFilter === id ? "border-text-primary text-text-primary" : "border-transparent text-text-muted hover:text-text-primary"}`}>{label}</button>)}</div>
        </div>
      </header>

      {error && <div className="mt-4 flex items-center gap-2 rounded-md border border-red/20 bg-red/5 px-4 py-3 text-xs text-red"><AlertTriangle size={14} />{error}</div>}
      {attentionTasks.length > 0 && <button type="button" onClick={() => setStatusFilter("attention")} className="mt-4 flex w-full items-center justify-between gap-3 border-l-2 border-amber bg-amber-dim px-4 py-3 text-left"><span className="flex min-w-0 items-center gap-2 text-xs font-bold text-amber"><ShieldAlert size={15} className="shrink-0"/><span className="truncate">{attentionTasks.length} 个任务需要人工处理：{attentionTasks.slice(0,2).map((task) => task.title).join("、")}</span></span><span className="shrink-0 text-[10px] font-bold text-amber">只看待处理</span></button>}

      {monitoredTasks.length ? (
        <section className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {monitoredTasks.map((task) => <MonitorWindow key={task.id} liveEnabled={!focusedTaskId} task={task} events={eventsByTask.get(task.id) || []} planTasks={data?.plan?.tasks || []} runId={data?.run?.id || task.run_id} onFocus={() => focusTask(task.id)} />)}
        </section>
      ) : (
        <section className="mt-4 flex min-h-[520px] items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 text-center">
          <div className="max-w-lg"><CheckCircle2 size={30} className="mx-auto text-border-bright" /><h2 className="mt-4 text-base font-bold text-text-secondary">当前没有可监控的真实任务</h2><p className="mt-2 text-xs leading-6 text-text-muted">批准经营计划后，内容和客服任务会自动出现在这里。每个窗口直播真实浏览器；任务等待或暂停时，鼠标也会停下来。</p></div>
        </section>
      )}
      {focusedTask && <FocusedMonitor task={focusedTask} events={eventsByTask.get(focusedTask.id) || []} planTasks={data?.plan?.tasks || []} runId={data?.run?.id || focusedTask.run_id} onClose={closeFocus}/>}
    </main>
  );
}
