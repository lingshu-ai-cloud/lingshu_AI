import { useCallback, useEffect, useState } from 'react';
import { Headphones, Loader2 } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { getSupportAccessSetting } from '../lib/supportAccessApi';

export default function SupportAccessControl() {
  const [defaultAuthorized, setDefaultAuthorized] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDefaultAuthorized(await getSupportAccessSetting());
    } catch (cause) {
      setDefaultAuthorized(null);
      setError(cause instanceof Error ? cause.message : '无法读取技术支持授权状态');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateMode = async (nextDefaultAuthorized: boolean) => {
    if (saving || defaultAuthorized === null || nextDefaultAuthorized === defaultAuthorized) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/overseas/support-access/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ mode: nextDefaultAuthorized ? 'default' : 'off' }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.message || data.error || '设置保存失败');
      setDefaultAuthorized(nextDefaultAuthorized);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '设置保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface-2/40 p-4">
      <div className="flex items-start justify-between gap-5">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <Headphones size={16} />
          </span>
          <div>
            <h3 className="text-sm font-black text-text-primary">技术支持授权</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-text-muted">
              控制灵枢技术支持是否可以进入当前企业排查问题。关闭后，会拒绝后续技术支持访问申请。
            </p>
          </div>
        </div>
        <div className="relative flex h-9 shrink-0 rounded-lg border border-border bg-white p-1" aria-label="技术支持授权模式">
          {loading ? <span className="flex w-40 items-center justify-center"><Loader2 size={14} className="animate-spin text-text-muted" /><span className="sr-only">正在读取授权状态</span></span> : defaultAuthorized === null ? (
            <button type="button" onClick={() => void load()} className="min-w-40 rounded-md px-3 text-xs font-bold text-red-600 hover:bg-red-50">状态未知，重试</button>
          ) : <>
            <button type="button" onClick={() => void updateMode(true)} disabled={saving} className={`min-w-24 rounded-md px-3 text-xs font-bold transition-colors ${defaultAuthorized ? 'bg-slate-950 text-white' : 'text-text-secondary hover:bg-surface-2'} disabled:opacity-60`}>默认授权</button>
            <button type="button" onClick={() => void updateMode(false)} disabled={saving} className={`min-w-24 rounded-md px-3 text-xs font-bold transition-colors ${!defaultAuthorized ? 'bg-slate-950 text-white' : 'text-text-secondary hover:bg-surface-2'} disabled:opacity-60`}>授权关闭</button>
          </>}
          {saving && <Loader2 size={13} className="absolute -left-5 top-2.5 animate-spin text-text-muted" />}
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-right text-xs text-red-600">授权状态未确认：{error}</p>}
    </section>
  );
}
