export const HOME_GROWTH_TOUR_START_EVENT = 'lingshu:home-growth-tour-start';
export const HOME_GROWTH_TOUR_COMPLETE_EVENT = 'lingshu:home-growth-tour-complete';
export const HOME_INTRODUCTION_COMPLETE_EVENT = 'lingshu:home-introduction-complete';
export const HOME_FIRST_RUN_RESET_EVENT = 'lingshu:home-first-run-reset';

const storageKey = (scope: string) => `lingshu:home-first-run:v1:${encodeURIComponent(scope)}`;

export interface HomeFirstRunProgress {
  entered: boolean;
  growthCompleted: boolean;
}

export function readHomeFirstRun(scope: string): HomeFirstRunProgress {
  if (!scope || typeof window === 'undefined') return { entered: false, growthCompleted: false };
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(scope)) || '{}') as Partial<HomeFirstRunProgress>;
    return { entered: value.entered === true, growthCompleted: value.growthCompleted === true };
  } catch {
    return { entered: false, growthCompleted: false };
  }
}

export function writeHomeFirstRun(scope: string, patch: Partial<HomeFirstRunProgress>): HomeFirstRunProgress {
  const next = { ...readHomeFirstRun(scope), ...patch };
  if (scope && typeof window !== 'undefined') {
    try { window.localStorage.setItem(storageKey(scope), JSON.stringify(next)); } catch { /* optional browser storage */ }
  }
  return next;
}

export function resetHomeFirstRun(scope: string): HomeFirstRunProgress {
  return writeHomeFirstRun(scope, { entered: true, growthCompleted: false });
}
