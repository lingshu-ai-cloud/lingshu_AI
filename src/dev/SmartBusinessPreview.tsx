import { useEffect, useState } from 'react';
import SmartBusinessDashboard from '../components/SmartBusinessDashboard';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { SocialProgramProvider } from '../contexts/SocialProgramContext';
import { clearToken, refreshAuthSession } from '../lib/auth';
import { stampProductionHistoryState } from '../lib/productionNavigation';

const emptyOverview = {
  config: null,
  goals: [],
  goal: null,
  plan: null,
  run: null,
  approvals: [],
  handoffs: [],
  review: null,
  agents: [],
  tasks: [],
  events: [],
  deliveries: [],
  contentQueue: { items: [] },
} as unknown as DigitalEmployeeOverview;

let previewSession: ReturnType<typeof refreshAuthSession> | null = null;
function readPreviewSession() {
  if (!previewSession) {
    clearToken();
    previewSession = refreshAuthSession();
  }
  return previewSession;
}

/** Local acceptance surface backed by the same authenticated APIs as Smart Business. */
export default function SmartBusinessPreview() {
  const [message, setMessage] = useState('正在读取当前登录租户的真实经营周包与内容生产任务。');
  const [authenticated, setAuthenticated] = useState(false);
  useEffect(() => {
    let active = true;
    // This DEV-only acceptance page must use the identity configured by the
    // supervised preview process rather than a stale token from another local tenant.
    void readPreviewSession().then(session => {
      if (!active) return;
      setAuthenticated(Boolean(session));
      if (!session) setMessage('本地验收身份未就绪，暂时无法读取真实任务。');
    }).catch(cause => {
      if (active) setMessage(cause instanceof Error ? cause.message : '本地验收登录失败。');
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: string; socialContentTaskId?: string }>).detail || {};
      if (detail.page === 'smartAssets' && detail.socialContentTaskId) {
        const productionDetail = { ...detail, page: 'smartAssets', view: 'create', directStudio: true, socialContentPage: 'smartAssets' };
        window.history.replaceState(stampProductionHistoryState({
          ...window.history.state,
          socialContentTaskId: detail.socialContentTaskId,
          socialContentPage: 'smartAssets',
          productionDetail,
        }), '', '/?page=smartAssets');
        window.location.reload();
        return;
      }
      setMessage(`已读取真实任务入口：${detail.page || '对应业务页'}。`);
    };
    window.addEventListener('lingshu:navigate', navigate);
    return () => window.removeEventListener('lingshu:navigate', navigate);
  }, []);
  if (!authenticated) return <main className="min-h-screen bg-[#f7f8f6] p-7"><p role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold text-sky-800">{message}</p></main>;
  return <SocialProgramProvider scope="smart-business-preview-live" enabled>
    <main className="min-h-screen bg-[#f7f8f6] p-4 sm:p-7">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-bold tracking-[.2em] text-emerald-700">SMART OPERATIONS</p><h1 className="mt-1 text-3xl font-black text-slate-950">智能经营</h1><p className="mt-1 text-sm text-slate-500">真实周包、真实视频交付和 Agent 协作节点。</p></div>
          <span className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">真实数据</span>
        </header>
        <p role="status" className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-bold text-sky-800">{message}</p>
        <section className="min-w-0 py-6"><SmartBusinessDashboard data={emptyOverview} view="matrix" onNavigate={page => setMessage(`已读取真实入口：${page}`)}/></section>
      </div>
    </main>
  </SocialProgramProvider>;
}
