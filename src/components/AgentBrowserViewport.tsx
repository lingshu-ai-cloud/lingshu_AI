import { useEffect, useRef, useState } from 'react';
import { Loader2, MonitorPlay, Radio, WifiOff } from 'lucide-react';
import { streamAgentBrowser, type BrowserStreamPacket } from '../lib/agentBrowser';

/** The cursor is captured inside the worker browser, from trusted pointer events.
 * This viewer never draws a cursor or starts a business action. */
export default function AgentBrowserViewport({ runId, taskId, taskStatus }: { runId: string; taskId: string; taskStatus: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [frame, setFrame] = useState<Extract<BrowserStreamPacket, { type: 'frame' }> | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [message, setMessage] = useState('正在打开任务浏览器');
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '80px' });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setFrame(null); }, [runId, taskId]);
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const connect = async () => {
      setConnection('connecting');
      try {
        await streamAgentBrowser(runId, taskId, controller.signal, packet => {
          if (disposed) return;
          if (packet.type === 'frame') { setFrame(packet); setConnection('live'); }
          else {
            setMessage(packet.message);
            setExecuting(packet.state === 'executing');
            setConnection(['error', 'closed'].includes(packet.state) ? 'offline' : 'live');
          }
        });
        if (!disposed) { setConnection('offline'); setMessage('直播连接已断开，正在重连'); }
      } catch (error) {
        if (!disposed) { setConnection('offline'); setMessage(error instanceof Error ? error.message : '直播连接中断'); }
      }
      if (!disposed) retry = setTimeout(() => void connect(), 5_000);
    };
    void connect();
    return () => { disposed = true; controller.abort(); if (retry) clearTimeout(retry); };
  }, [visible, runId, taskId]);

  const stopped = ['paused', 'cancelled', 'failed', 'waiting_human', 'handed_off', 'waiting_approval', 'succeeded', 'completed'].includes(taskStatus);
  return <div ref={host} className="relative aspect-[11/7] overflow-hidden bg-slate-900" data-testid="agent-browser-viewport">
    {frame ? <img src={`data:image/jpeg;base64,${frame.image}`} alt="Agent 实际操作的任务浏览器直播画面" className="h-full w-full object-contain" draggable={false} /> : <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
      {connection === 'connecting' && visible ? <Loader2 size={26} className="animate-spin text-emerald-400"/> : <MonitorPlay size={30} className="text-slate-500"/>}
      <p className="mt-4 text-xs font-bold text-slate-300">{visible ? message : '滚动至此处连接任务浏览器'}</p>
      <p className="mt-2 text-[10px] leading-5 text-slate-500">连接后显示实际工作页面与鼠标操作</p>
    </div>}
    <div className={`absolute left-2 top-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[9px] font-bold shadow ${connection === 'live' ? 'bg-slate-950/85 text-emerald-300' : 'bg-slate-950/90 text-amber-300'}`}>
      {connection === 'live' ? <Radio size={10}/> : <WifiOff size={10}/>}{connection === 'live' ? executing && !stopped ? 'LIVE · 正在操作' : 'LIVE · 工作页面' : frame ? '连接中断 · 保留最后画面' : '浏览器直播'}
    </div>
    {frame && connection === 'offline' && <div role="status" className="absolute inset-x-0 bottom-0 bg-slate-950/90 px-3 py-2 text-[10px] text-amber-200">{message}</div>}
  </div>;
}
