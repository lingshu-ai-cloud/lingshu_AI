import { useCallback, useState, type RefObject } from 'react';

const ASSISTANT_LAUNCHER_RETRACTED_KEY = 'lingshu-assistant-launcher-retracted-v1';

function readLauncherRetractedPreference() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ASSISTANT_LAUNCHER_RETRACTED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persist the user's launcher preference and return focus to the visible control. */
export function useAssistantLauncherRetraction(
  launcherButtonRef: RefObject<HTMLAnchorElement | HTMLButtonElement | null>,
  edgeLauncherButtonRef: RefObject<HTMLAnchorElement | HTMLButtonElement | null>,
) {
  const [launcherRetracted, setLauncherRetracted] = useState(readLauncherRetractedPreference);
  const persistLauncherRetraction = useCallback((retracted: boolean) => {
    setLauncherRetracted(retracted);
    try {
      window.localStorage.setItem(ASSISTANT_LAUNCHER_RETRACTED_KEY, String(retracted));
    } catch {
      // The explicit control remains usable when storage is unavailable.
    }
  }, []);

  const retractLauncher = useCallback(() => {
    persistLauncherRetraction(true);
    window.requestAnimationFrame(() => edgeLauncherButtonRef.current?.focus());
  }, [edgeLauncherButtonRef, persistLauncherRetraction]);

  const restoreLauncher = useCallback(() => {
    persistLauncherRetraction(false);
    window.requestAnimationFrame(() => launcherButtonRef.current?.focus());
  }, [launcherButtonRef, persistLauncherRetraction]);

  return { launcherRetracted, retractLauncher, restoreLauncher };
}
