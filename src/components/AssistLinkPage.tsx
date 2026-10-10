import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';

interface AssistLinkStatus {
  token: string;
  tenantId: string;
  platform: 'meta' | 'google' | 'tiktok';
  platformName: string;
  expiresAt: string;
  usedAt: string;
  valid: boolean;
}

function tokenFromPath() {
  const match = window.location.pathname.match(/^\/assist\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function AssistLinkPage() {
  const token = useMemo(() => tokenFromPath(), []);
  const done = new URLSearchParams(window.location.search).get('done') === '1';
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
        if (done && token) {
          await fetch(`/api/assist-links/${encodeURIComponent(token)}/complete`, { method: 'POST' }).catch(() => {});
        }
        const resp = await fetch(`/api/assist-links/${encodeURIComponent(token)}`);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'invalid');
        if (alive) setStatus(data);
      } catch {
        if (alive) setError('invalid');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => { alive = false; };
  }, [done, token]);

  async function start() {
    setStarting(true);
    setError('');
    try {
      const resp = await fetch(`/api/assist-links/${encodeURIComponent(token)}/start`, { method: 'POST' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.url) throw new Error(data.error || 'start_failed');
      window.location.assign(data.url);
    } catch {
      setError('start_failed');
      setStarting(false);
    }
  }

  const invalid = !token || error === 'invalid' || (status && !status.valid && !done);
  const complete = done || Boolean(status?.usedAt);

  return (
    <div className="min-h-screen bg-ink px-4 py-8 text-text-primary sm:px-6 sm:py-10">
      <main className="mx-auto flex min-h-[calc(100dvh-64px)] w-full max-w-md items-center justify-center sm:min-h-[calc(100dvh-80px)]">
        <section className="w-full rounded-lg border border-border bg-white p-6 text-center sm:p-7">
          <div className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-md ${invalid ? 'bg-insight-soft text-insight-action' : 'bg-accent-glow text-accent'}`}>
            {complete ? <CheckCircle2 size={28} /> : invalid ? <AlertCircle size={28} /> : <ShieldCheck size={28} />}
          </div>

          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">LINGSHU AI</p>

          {loading ? (
            <div role="status" className="mt-8 flex items-center justify-center gap-2 text-sm text-text-muted">
              <Loader2 size={16} className="animate-spin" />
              正在检查链接...
            </div>
          ) : complete ? (
            <>
              <h1 className="mt-6 text-2xl font-bold">授权完成</h1>
              <p className="mt-3 text-sm leading-6 text-text-muted">账号授权已经完成，可以关闭此页面。</p>
            </>
          ) : invalid ? (
            <>
              <h1 className="mt-6 text-2xl font-bold">链接已失效</h1>
              <p className="mt-3 text-sm leading-6 text-text-muted">请联系你的顾问重新发送协助链接。</p>
            </>
          ) : status ? (
            <>
              <h1 className="mt-6 text-2xl font-bold">授权连接你的 {status.platformName}</h1>
              <p className="mt-3 text-sm leading-6 text-text-muted">
                这是灵枢顾问为你生成的一次性协助链接。点击下方按钮后，按平台提示确认授权即可。
              </p>
              {error === 'start_failed' && (
                <p role="alert" className="mt-4 border-l-2 border-insight bg-insight-soft px-3 py-2 text-left text-sm font-semibold text-insight-action">
                  暂时无法发起授权，请联系你的顾问检查平台应用配置。
                </p>
              )}
              <button
                type="button"
                onClick={() => void start()}
                disabled={starting}
                className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-3.5 text-sm font-bold text-white shadow-sm hover:bg-accent-dim disabled:opacity-60"
              >
                {starting && <Loader2 size={16} className="animate-spin" />}
                授权连接你的 {status.platformName}
              </button>
              <p className="mt-4 text-xs text-text-muted">
                链接 24 小时内有效，授权完成后会自动失效。
              </p>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
