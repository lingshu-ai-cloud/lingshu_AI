import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  MonitorPlay,
  MousePointer2,
  Palette,
  Radio,
  RefreshCcw,
  ShieldAlert,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  agentCursorPercent,
  agentUiActionFromEvent,
  buildTaskDeepLink,
  digitalEmployeeApi,
  dispatchDigitalEmployeeDeepLink,
  streamRunEvents,
  type AgentUiAction,
  type DigitalEmployeeOverview,
  type PlanTask,
  type RunEvent,
  type WorkflowTask,
} from "../lib/digitalEmployees";

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

function trustedVisualUrl(value: unknown): string {
  const url = String(value || "").trim();
  return /^(https?:\/\/|\/api\/)/.test(url) ? url : "";
}

function taskVisualUrl(task: WorkflowTask, actions: AgentUiAction[]): string {
  const screenshot = [...actions].reverse().find((item) => item.kind === "screenshot" && item.screenshotUrl);
  if (screenshot?.screenshotUrl) return trustedVisualUrl(screenshot.screenshotUrl);
  for (const key of ["previewUrl", "preview_url", "thumbnailUrl", "thumbnail_url", "imageUrl", "image_url", "assetUrl", "asset_url"]) {
    const url = trustedVisualUrl(task.output?.[key]);
    if (url) return url;
  }
  return "";
}

function taskOutputText(task: WorkflowTask): string[] {
  const ignored = new Set(["previewUrl", "preview_url", "thumbnailUrl", "thumbnail_url", "imageUrl", "image_url", "assetUrl", "asset_url"]);
  return Object.entries(task.output || {})
    .filter(([key, value]) => !ignored.has(key) && ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 4)
    .map(([, value]) => String(value).slice(0, 120));
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

function MonitorWindow({ task, events, planTasks, runId, onFocus }: { task: WorkflowTask; events: RunEvent[]; planTasks: PlanTask[]; runId: string; onFocus?: () => void }) {
  const actions = events.map(agentUiActionFromEvent).filter((item): item is AgentUiAction => Boolean(item));
  const cursorAction = [...actions].reverse().find((item) => agentCursorPercent(item));
  const cursor = agentCursorPercent(cursorAction);
  const visualUrl = taskVisualUrl(task, actions);
  const outputs = taskOutputText(task);
  const group = taskMonitorGroup(task);
  const latestEvent = events.at(-1);
  const planTask = planTasks.find((item) => item.key === task.task_key);
  const link = buildTaskDeepLink(task, planTask, runId || task.run_id);
  const active = ["running", "planning", "waiting_external"].includes(task.status);
  const viewportAction = [...actions].reverse().find((item) => item.viewportWidth && item.viewportHeight);
  const viewportRatio = viewportAction?.viewportWidth && viewportAction.viewportHeight
    ? Math.max(0.75, Math.min(2.4, viewportAction.viewportWidth / viewportAction.viewportHeight))
    : 16 / 10;

  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/30">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/90 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "animate-pulse bg-emerald-400" : task.status === "failed" ? "bg-red-400" : "bg-slate-600"}`} />
            <p className="truncate text-[11px] font-black text-white">{task.title}</p>
          </div>
          <p className="mt-0.5 truncate text-[9px] text-slate-500">{group === "customer" ? "客服 Agent" : "内容 Agent"} · {statusLabel[task.status] || task.status}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">{onFocus && <button type="button" onClick={onFocus} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:border-emerald-500 hover:text-white" aria-label={`放大查看${task.title}`}><Maximize2 size={11}/></button>}<button type="button" onClick={() => dispatchDigitalEmployeeDeepLink(link)} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-[9px] font-bold text-slate-200 transition hover:border-emerald-500 hover:text-white">工作页 <ExternalLink size={10} /></button></div>
      </header>

      <div className="relative overflow-hidden bg-[radial-gradient(circle_at_top,#1e293b,#020617_72%)]" style={{aspectRatio: viewportRatio}}>
        {visualUrl ? (
          <img src={visualUrl} alt={`${task.title}真实生产画面`} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center">
            {group === "customer" ? <MessageSquare size={28} className="text-sky-400" /> : <Palette size={28} className="text-fuchsia-400" />}
            <p className="mt-3 text-xs font-black text-slate-200">{outputs[0] || (actions.length ? actions.at(-1)?.label : "等待真实生产画面")}</p>
            <p className="mt-2 line-clamp-2 text-[9px] leading-4 text-slate-500">{outputs[1] || latestEvent?.summary || "Worker 上报截图或中间产物后在此显示"}</p>
          </div>
        )}

        {cursor ? (
          <div className="pointer-events-none absolute z-20 transition-all duration-300 ease-out" style={{ left: `${cursor.left}%`, top: `${cursor.top}%` }}>
            <MousePointer2 size={24} className="-translate-x-1 -translate-y-1 fill-white text-slate-950 drop-shadow-[0_2px_3px_rgba(0,0,0,.8)]" />
            {cursorAction?.kind === "click" && <span className="absolute -left-3 -top-3 h-9 w-9 animate-ping rounded-full border-2 border-emerald-400" />}
          </div>
        ) : (
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg bg-black/60 px-2 py-1 text-[8px] font-bold text-slate-400">
            <MousePointer2 size={10} /> 等待鼠标事件
          </div>
        )}

        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-lg bg-black/65 px-2 py-1 text-[8px] font-bold text-slate-300">
          <Radio size={10} className={active ? "text-emerald-400" : "text-slate-500"} />
          {actions.length ? `${actions.length} 条真实操作` : "尚无操作回传"}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 px-3 py-2.5 text-[9px] text-slate-500">
        <span className="truncate">{latestEvent?.summary || "等待任务事件"}</span>
        <span className="shrink-0">{relativeSignalTime(latestEvent?.occurred_at)}</span>
      </footer>
    </article>
  );
}

function FocusedMonitor({ task, events, planTasks, runId, onClose }: { task: WorkflowTask; events: RunEvent[]; planTasks: PlanTask[]; runId: string; onClose: () => void }) {
  const actions = events.map(agentUiActionFromEvent).filter((item): item is AgentUiAction => Boolean(item));
  return <div className="fixed inset-0 z-[100] bg-black/90 p-3 backdrop-blur-sm lg:p-6" role="dialog" aria-modal="true" aria-label={`${task.title}放大监控`}>
    <div className="mx-auto flex h-full max-w-[1800px] flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-950 shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">Focused live session</p><h2 className="mt-1 text-sm font-black text-white">{task.title}</h2></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 hover:text-white" aria-label="关闭放大监控"><X size={15}/></button></header>
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="self-start"><MonitorWindow task={task} events={events} planTasks={planTasks} runId={runId}/></div>
        <aside className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"><div className="flex items-center justify-between"><h3 className="text-xs font-black text-white">实时操作轨迹</h3><span className="text-[9px] text-slate-500">{actions.length} 条 UI 操作</span></div><div className="mt-3 space-y-2">{events.length ? [...events].reverse().slice(0,20).map((event) => { const action = agentUiActionFromEvent(event); return <div key={event.id} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5"><div className="flex items-start gap-2">{action ? <MousePointer2 size={12} className="mt-0.5 shrink-0 text-emerald-400"/> : <Clock3 size={12} className="mt-0.5 shrink-0 text-slate-600"/>}<div className="min-w-0"><p className="text-[10px] font-bold leading-4 text-slate-200">{event.summary}</p><p className="mt-1 text-[8px] text-slate-600">{action?.kind || event.type} · {new Date(event.occurred_at).toLocaleTimeString("zh-CN")}</p></div></div></div>; }) : <p className="rounded-xl border border-dashed border-slate-800 px-3 py-10 text-center text-[10px] text-slate-600">尚无真实事件</p>}</div></aside>
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
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const initialEventsRef = useRef<RunEvent[]>([]);

  const load = useCallback(async () => {
    try {
      const overview = await digitalEmployeeApi.overview();
      setData(overview);
      initialEventsRef.current = overview.events;
      setLastSignalAt(overview.events.at(-1)?.occurred_at || "");
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "监控数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

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
            setData((current) => current ? { ...current, events: current.events.some((item) => item.id === event.id) ? current.events : [...current.events, event] } : current);
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => void load(), 500);
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
  useEffect(() => {
    const closeFocusedMonitor = (event: KeyboardEvent) => {
      if (event.key === "Escape" && focusedTaskId && !document.fullscreenElement) setFocusedTaskId("");
    };
    window.addEventListener("keydown", closeFocusedMonitor);
    return () => window.removeEventListener("keydown", closeFocusedMonitor);
  }, [focusedTaskId]);

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
    if (statusFilter === "active") return ["running", "planning", "waiting_external"].includes(task.status);
    if (statusFilter === "attention") return ["waiting_approval", "waiting_human", "handed_off", "failed"].includes(task.status);
    return true;
  }), [data?.tasks, filter, statusFilter]);
  const activeCount = monitoredTasks.filter((task) => ["running", "planning", "waiting_external"].includes(task.status)).length;
  const humanCount = monitoredTasks.filter((task) => ["waiting_approval", "waiting_human", "handed_off", "failed"].includes(task.status)).length;
  const attentionTasks = (data?.tasks || []).filter((task) => taskMonitorGroup(task) && ["waiting_approval", "waiting_human", "handed_off", "failed"].includes(task.status));
  const focusedTask = (data?.tasks || []).find((task) => task.id === focusedTaskId);

  if (loading) return <div className="flex h-full items-center justify-center bg-slate-950"><Loader2 className="animate-spin text-emerald-400" /></div>;

  return (
    <main className="h-full overflow-y-auto bg-slate-950 px-4 py-4 text-white lg:px-6">
      <header className="sticky top-0 z-30 rounded-2xl border border-slate-800 bg-slate-950/95 px-4 py-3 shadow-2xl backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={onBack} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 hover:text-white" aria-label="返回经营驾驶舱"><ArrowLeft size={16} /></button>
            <div className="min-w-0"><div className="flex items-center gap-2"><MonitorPlay size={18} className="text-emerald-400" /><h1 className="truncate text-base font-black">Agent 实时生产监控大屏</h1></div><p className="mt-0.5 text-[10px] text-slate-500">真实任务、真实产物、真实 Worker 鼠标事件</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[10px] font-bold ${connection === "live" ? "bg-emerald-950 text-emerald-400" : connection === "offline" ? "bg-red-950 text-red-400" : "bg-slate-900 text-slate-400"}`}>{connection === "live" ? <Wifi size={11}/> : <WifiOff size={11}/>} {connectionLabel[connection]}{lastSignalAt ? ` · ${relativeSignalTime(lastSignalAt)}` : ""}</span>
            <span className="rounded-lg bg-slate-900 px-2.5 py-2 text-[10px] font-bold text-slate-400">{monitoredTasks.length} 个窗口</span>
            <span className="rounded-lg bg-emerald-950 px-2.5 py-2 text-[10px] font-bold text-emerald-400">{activeCount} 执行中</span>
            <span className="rounded-lg bg-amber-950 px-2.5 py-2 text-[10px] font-bold text-amber-400">{humanCount} 待人工</span>
            <button type="button" onClick={() => void load()} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 hover:text-white" aria-label="刷新监控大屏"><RefreshCcw size={14} /></button>
            <button type="button" onClick={() => void toggleFullscreen()} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 hover:text-white" aria-label={fullscreen ? "退出全屏" : "进入全屏"}>{fullscreen ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900 p-1">
          <div className="flex flex-wrap gap-1">{([['all','全部现场'],['content','内容 Agent'],['customer','客服 Agent']] as Array<[MonitorFilter,string]>).map(([id,label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={`rounded-lg px-4 py-2 text-[10px] font-black transition ${filter === id ? "bg-white text-slate-950" : "text-slate-500 hover:bg-slate-800 hover:text-white"}`}>{label}</button>)}</div>
          <div className="flex flex-wrap gap-1">{([['all','全部状态'],['active','仅执行中'],['attention','只看待处理']] as Array<[MonitorStatusFilter,string]>).map(([id,label]) => <button key={id} type="button" aria-pressed={statusFilter === id} onClick={() => setStatusFilter(id)} className={`rounded-lg px-3 py-2 text-[9px] font-bold transition ${statusFilter === id ? "bg-slate-700 text-white" : "text-slate-500 hover:text-white"}`}>{label}</button>)}</div>
        </div>
      </header>

      {error && <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-900 bg-red-950/60 px-4 py-3 text-xs text-red-300"><AlertTriangle size={14} />{error}</div>}
      {attentionTasks.length > 0 && <button type="button" onClick={() => setStatusFilter("attention")} className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl border border-amber-900/70 bg-amber-950/50 px-4 py-3 text-left"><span className="flex min-w-0 items-center gap-2 text-xs font-bold text-amber-300"><ShieldAlert size={15} className="shrink-0"/><span className="truncate">{attentionTasks.length} 个任务需要人工处理：{attentionTasks.slice(0,2).map((task) => task.title).join("、")}</span></span><span className="shrink-0 text-[9px] font-black text-amber-500">只看待处理</span></button>}

      {monitoredTasks.length ? (
        <section className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {monitoredTasks.map((task) => <MonitorWindow key={task.id} task={task} events={eventsByTask.get(task.id) || []} planTasks={data?.plan?.tasks || []} runId={data?.run?.id || task.run_id} onFocus={() => setFocusedTaskId(task.id)} />)}
        </section>
      ) : (
        <section className="mt-4 flex min-h-[520px] items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/30 px-6 text-center">
          <div className="max-w-lg"><CheckCircle2 size={30} className="mx-auto text-slate-700" /><h2 className="mt-4 text-base font-black text-slate-300">当前没有可监控的真实任务</h2><p className="mt-2 text-xs leading-6 text-slate-500">批准经营计划后，内容和客服 workflow_tasks 会自动出现在这里。只有 Worker 回传的截图、产物和鼠标坐标会被播放，不使用模拟窗口或循环鼠标。</p></div>
        </section>
      )}
      {focusedTask && <FocusedMonitor task={focusedTask} events={eventsByTask.get(focusedTask.id) || []} planTasks={data?.plan?.tasks || []} runId={data?.run?.id || focusedTask.run_id} onClose={() => setFocusedTaskId("")}/>}
    </main>
  );
}
