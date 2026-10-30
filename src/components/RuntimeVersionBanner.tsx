import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { parseSystemAnnouncement, systemAnnouncementIsActive, type SystemAnnouncement } from '../../shared/systemAnnouncement';
import SystemAnnouncementBanner from './SystemAnnouncementBanner';
import { frontendReloadAvailable, runtimeVersionMismatch } from '../lib/runtimeVersion';

type RuntimeHealth = {
  build?: { commitSha?: string; startedAt?: string };
  announcement?: unknown;
};

const ANNOUNCEMENT_CACHE_KEY = 'lingshu:system-announcement';

function readCachedAnnouncement(): SystemAnnouncement | null {
  try {
    const announcement = parseSystemAnnouncement(JSON.parse(localStorage.getItem(ANNOUNCEMENT_CACHE_KEY) || 'null'));
    return announcement && systemAnnouncementIsActive(announcement) ? announcement : null;
  } catch { return null; }
}

function cacheAnnouncement(announcement: SystemAnnouncement | null): void {
  try {
    if (announcement) localStorage.setItem(ANNOUNCEMENT_CACHE_KEY, JSON.stringify(announcement));
    else localStorage.removeItem(ANNOUNCEMENT_CACHE_KEY);
  } catch { /* Announcement delivery remains usable when storage is unavailable. */ }
}

export default function RuntimeVersionBanner({ showSystemAnnouncement = false }: { showSystemAnnouncement?: boolean }) {
  const [problem, setProblem] = useState<'mismatch' | 'offline' | null>(null);
  const checkRef = useRef<() => Promise<void>>(async () => {});
  const [checking, setChecking] = useState(false);
  const [backendSha, setBackendSha] = useState('');
  const [reloadAvailable, setReloadAvailable] = useState(false);
  const [announcement, setAnnouncement] = useState<SystemAnnouncement | null>(readCachedAnnouncement);

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
        const mismatch = runtimeVersionMismatch(__APP_BUILD_SHA__, nextBackendSha);
        let deployedFrontendSha = '';
        if (mismatch) {
          try {
            const manifestResponse = await fetch('/build-version.json', { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
            if (manifestResponse.ok) deployedFrontendSha = String((await manifestResponse.json()).commitSha || '');
          } catch { /* No confirmed new frontend: offer a status check instead of a reload loop. */ }
        }
        const nextAnnouncement = parseSystemAnnouncement(health.announcement);
        failures = 0;
        if (!active) return;
        setBackendSha(nextBackendSha);
        setReloadAvailable(frontendReloadAvailable(__APP_BUILD_SHA__, deployedFrontendSha));
        setAnnouncement(nextAnnouncement && systemAnnouncementIsActive(nextAnnouncement) ? nextAnnouncement : null);
        cacheAnnouncement(nextAnnouncement && systemAnnouncementIsActive(nextAnnouncement) ? nextAnnouncement : null);
        setProblem(
          mismatch ? 'mismatch' : null,
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

  const announcementBanner = showSystemAnnouncement && announcement && systemAnnouncementIsActive(announcement)
    ? <SystemAnnouncementBanner announcement={announcement} />
    : null;
  if (!problem) return announcementBanner;
  const mismatch = problem === 'mismatch';
  return (
    <>
      {announcementBanner}
      <div role="alert" className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950">
        <AlertTriangle size={14} />
        <span className="font-semibold">{mismatch ? reloadAvailable ? '页面已有新版本，请重新加载。' : '前端与后台服务版本尚未同步，请稍后重新检查。' : '后台服务暂时无法连接，已保存内容不受影响。'}</span>
        {mismatch && <span className="text-[10px] text-amber-800">前端 {__APP_BUILD_SHA__.slice(0, 8)} · 后台 {backendSha.slice(0, 8)}</span>}
        <button type="button" disabled={checking} onClick={() => mismatch && reloadAvailable ? window.location.reload() : void checkRef.current()} className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 font-bold"><RefreshCcw size={11} />{checking ? '正在检查' : mismatch ? reloadAvailable ? '重新加载' : '重新检查' : '重新连接'}</button>
      </div>
    </>
  );
}
