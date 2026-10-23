import { createContext, useContext } from 'react';

export type CreationMode = 'free' | 'employee';

export const CREATION_MODE_LABELS: Record<CreationMode, string> = {
  free: '自由创作',
  employee: '数字员工',
};

export const CreationModeContext = createContext<CreationMode>('free');
export const useCreationMode = () => useContext(CreationModeContext);
export const CreationModeControlContext = createContext<((mode: CreationMode) => void) | null>(null);
export const useCreationModeControl = () => useContext(CreationModeControlContext);

const preferenceKey = (scope: string) => `lingshu:creation-mode:${scope}`;

export function readCreationMode(scope: string, storage?: Pick<Storage, 'getItem'>): CreationMode {
  if (!scope) return 'free';
  try { return (storage ?? window.localStorage).getItem(preferenceKey(scope)) === 'employee' ? 'employee' : 'free'; }
  catch { return 'free'; }
}

export function writeCreationMode(scope: string, mode: CreationMode, storage?: Pick<Storage, 'setItem'>): void {
  if (!scope) return;
  try { (storage ?? window.localStorage).setItem(preferenceKey(scope), mode); }
  catch { /* private browsing can deny persistence without blocking navigation */ }
}
