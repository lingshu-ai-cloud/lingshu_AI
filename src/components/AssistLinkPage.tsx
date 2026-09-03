import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';

interface AssistLinkStatus {
  platform: 'meta' | 'google' | 'tiktok';
  platformName: string;
  expiresAt: string;
  usedAt: string;
  status: 'pending' | 'claimed' | 'consumed' | 'revoked';
  valid: boolean;
  canStart: boolean;
}

function tokenFromPath() {
  const match = window.location.pathname.match(/^\/assist\/([^/?#]+)/);
  const pathToken = match?.[1] && match[1] !== 'status' ? decodeURIComponent(match[1]) : '';
  if (pathToken) return pathToken;
  try {
    return window.sessionStorage.getItem('lingshu.assist-link-token') || '';
  } catch {
    return '';
  }
}

export default function AssistLinkPage() {
  const token = useMemo(() => tokenFromPath(), []);
  const [status, setStatus] = useState<AssistLinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const resp = await fetch(`/api/assist-links/${encodeURIComponent(token)}`);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'invalid');
        if (alive) {
          setStatus(data);
          if (data.status === 'consumed') {
            try { window.sessionStorage.removeItem('lingshu.assist-link-token'); } catch { /* unavailable */ }
          }
        }
      } catch {
        if (alive) setError('invalid');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => { alive = false; };
  }, [token]);

  async function start() {
    setStarting(true);
    setError('');
    try {
      try { window.sessionStorage.setItem('lingshu.assist-link-token', token); } catch { /* unavailable */ }
      const resp = await fetch(`/api/assist-links/${encodeURIComponent(token)}/start`, { method: 'POST' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.url) throw new Error(data.error || 'start_failed');
      window.location.assign(data.url);
    } catch {
      setError('start_failed');
      setStarting(false);
    }
  }

  const invalid = !token || error === 'invalid' || Boolean(status && !status.valid);
  const complete = status?.status === 'consumed' && Boolean(status.usedAt);
  const inProgress = status?.status === 'claimed' && !status.canStart;

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950">
      <main className="mx-auto flex min-h-[calc(100vh-80px)] w-full max-w-md items-center justify-center">
        <section className="w-full rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            {complete ? <CheckCircle2 size={28} /> : invalid ? <AlertCircle size={28} /> : <ShieldCheck size={28} />}
          </div>

          <p className="text-lg font-black">灵枢 AI</p>

          {loading ? (
            <div className="mt-8 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              正在检查链接...
            </div>
          ) : complete ? (
            <>
              <h1 className="mt-6 text-2xl font-black">完成 ✓</h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">账号授权已经完成，可以关闭此页面。</p>
            </>
          ) : invalid ? (
            <>
              <h1 className="mt-6 text-2xl font-black">链接已失效</h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">请联系你的顾问重新发送协助链接。</p>
            </>
          ) : status ? (
            <>
              <h1 className="mt-6 text-2xl font-black">授权连接你的 {status.platformName}</h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                {inProgress
                  ? '授权流程正在进行中。完成平台授权后，此页面会显示连接结果。'
                  : '这是灵枢顾问为你生成的一次性协助链接。点击下方按钮后，按平台提示确认授权即可。'}
              </p>
              {error === 'start_failed' && (
                <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                  暂时无法发起授权，请联系你的顾问检查平台应用配置。
                </p>
              )}
              <button
                type="button"
                onClick={() => void start()}
                disabled={starting || !status.canStart}
                className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-black text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
              >
                {starting && <Loader2 size={16} className="animate-spin" />}
                {inProgress ? '等待授权完成' : `授权连接你的 ${status.platformName}`}
              </button>
              <p className="mt-4 text-xs text-slate-400">
                链接 24 小时内有效，授权完成后会自动失效。
              </p>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
