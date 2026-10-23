import { useEffect, useState } from 'react';

export type AppearancePreference = 'auto' | 'light' | 'dark';
export type ResolvedAppearance = 'light' | 'dark';

const STORAGE_KEY = 'lingshu:appearance';
const CHANGE_EVENT = 'lingshu:appearance-changed';

export function isShanghaiNight(date: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai',
  }).format(date));
  return hour >= 20 || hour < 8;
}

export function resolveAppearance(preference: AppearancePreference, date = new Date()): ResolvedAppearance {
  return preference === 'auto' ? (isShanghaiNight(date) ? 'dark' : 'light') : preference;
}

export function readAppearancePreference(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): AppearancePreference {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch { return 'auto'; }
}

export function writeAppearancePreference(preference: AppearancePreference, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(STORAGE_KEY, preference); } catch { /* In-memory preference remains available. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useAppearance() {
  const [preference, setPreference] = useState<AppearancePreference>(readAppearancePreference);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const updatePreference = () => setPreference(readAppearancePreference());
    const updateClock = () => setNow(new Date());
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) updatePreference(); };
    window.addEventListener(CHANGE_EVENT, updatePreference);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', updateClock);
    const timer = window.setInterval(updateClock, 60_000);
    return () => {
      window.removeEventListener(CHANGE_EVENT, updatePreference);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', updateClock);
      window.clearInterval(timer);
    };
  }, []);
  return {
    preference,
    appearance: resolveAppearance(preference, now),
    setPreference: (next: AppearancePreference) => { setPreference(next); writeAppearancePreference(next); },
  };
}
