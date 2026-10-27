import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

type RuntimeHealth = {
  build?: { commitSha?: string; startedAt?: string };
};

export default function RuntimeVersionBanner() {
  const [problem, setProblem] = useState<'mismatch' | 'offline' | null>(null);
  const checkRef = useRef<() => Promise<void>>(async () => {});
  const [checking, setChecking] = useState(false);
  const [backendSha, setBackendSha] = useState('');

  useEffect(() => {
    let active = true;
    let failures = 0;
    let inFlight = false;
    const check = async () => {
      if (inFlight) return;
      inFlight = true; if (active) setChecking(true);
      try {
        const response = await fetch('/api/overseas/health', { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
        if (!response.ok) throw new Error(`health_${response.status}`);
        const health = await response.json() as RuntimeHealth;
        const nextBackendSha = String(health.build?.commitSha || '');
        failures = 0;
        if (!active) return;
        setBackendSha(nextBackendSha);
        setProblem(
          __APP_BUILD_SHA__ !== 'unknown'
          && nextBackendSha
          && nextBackendSha !== 'unknown'
          && nextBackendSha !== __APP_BUILD_SHA__
            ? 'mismatch'
            : null,
        );
      } catch {
        failures += 1;
        if (active && failures >= 2) setProblem('offline');
      } finally { inFlight = false; if (active) setChecking(false); }
    };
    checkRef.current = check;
    const reconnect = () => void check();
    window.addEventListener('online', reconnect);
    window.addEventListener('focus', reconnect);
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('online', reconnect); window.removeEventListener('focus', reconnect); };
  }, []);

  if (!problem) return null;
  const mismatch = problem === 'mismatch';
  return (
    <div role="alert" className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950">
      <AlertTriangle size={14} />
      <span className="font-semibold">{mismatch ? '前端与后台版本不一致，当前页面可能不是最新效果。' : '后台服务暂时无法连接，已保存内容不受影响。'}</span>
      {mismatch && <span className="text-[10px] text-amber-800">前端 {__APP_BUILD_SHA__.slice(0, 8)} · 后台 {backendSha.slice(0, 8)}</span>}
      <button type="button" disabled={checking} onClick={() => mismatch ? window.location.reload() : void checkRef.current()} className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 font-bold"><RefreshCcw size={11} />{mismatch ? '重新加载' : checking ? '正在重连' : '重新连接'}</button>
    </div>
  );
}
