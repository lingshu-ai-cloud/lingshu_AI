import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  OwnedSocialAccount,
  SocialMonthlyPlan,
  SocialProgram,
} from '../../shared/contracts/socialProgram';
import { socialProgramApi } from '../lib/socialProgramApi';

interface SocialProgramContextValue {
  programs: SocialProgram[];
  activeProgram: SocialProgram | null;
  activeProgramId: string | null;
  accounts: OwnedSocialAccount[];
  loading: boolean;
  accountsLoading: boolean;
  mutating: boolean;
  error: string;
  accountsError: string;
  selectProgram: (programId: string) => void;
  refreshPrograms: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  createProgram: (input: Record<string, unknown>) => Promise<SocialProgram>;
  updateActiveProgram: (input: Record<string, unknown>) => Promise<SocialProgram>;
  createAccount: (input: Record<string, unknown>) => Promise<OwnedSocialAccount>;
  saveMonthlyPlan: (input: Record<string, unknown>) => Promise<SocialMonthlyPlan>;
}

const SocialProgramContext = createContext<SocialProgramContextValue | null>(null);

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '社媒经营数据请求失败，请稍后重试。';

export function SocialProgramProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const storageKey = `lingshu:social-program:active:${scope}`;
  const [programs, setPrograms] = useState<SocialProgram[]>([]);
  const [activeProgramId, setActiveProgramId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<OwnedSocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const [accountsError, setAccountsError] = useState('');
  const programRequestRef = useRef(0);
  const accountRequestRef = useRef(0);

  const preferredProgramId = useCallback(() => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  }, [storageKey]);

  const persistProgramId = useCallback((programId: string | null) => {
    try {
      if (programId) localStorage.setItem(storageKey, programId);
      else localStorage.removeItem(storageKey);
    } catch { /* browser storage is optional */ }
  }, [storageKey]);

  const refreshPrograms = useCallback(async () => {
    const requestId = ++programRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const items = await socialProgramApi.list();
      if (requestId !== programRequestRef.current) return;
      setPrograms(items);
      setActiveProgramId(current => {
        const preferred = current || preferredProgramId();
        const next = items.some(item => item.programId === preferred) ? preferred : items[0]?.programId ?? null;
        persistProgramId(next);
        return next;
      });
    } catch (requestError) {
      if (requestId === programRequestRef.current) setError(errorMessage(requestError));
    } finally {
      if (requestId === programRequestRef.current) setLoading(false);
    }
  }, [persistProgramId, preferredProgramId]);

  const refreshAccountsFor = useCallback(async (programId: string | null) => {
    const requestId = ++accountRequestRef.current;
    if (!programId) {
      setAccounts([]);
      setAccountsError('');
      setAccountsLoading(false);
      return;
    }
    setAccountsLoading(true);
    setAccountsError('');
    try {
      const items = await socialProgramApi.listAccounts(programId);
      if (requestId === accountRequestRef.current) setAccounts(items);
    } catch (requestError) {
      if (requestId === accountRequestRef.current) {
        setAccounts([]);
        setAccountsError(errorMessage(requestError));
      }
    } finally {
      if (requestId === accountRequestRef.current) setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    setPrograms([]);
    setAccounts([]);
    setActiveProgramId(null);
    void refreshPrograms();
  }, [scope, refreshPrograms]);

  useEffect(() => {
    void refreshAccountsFor(activeProgramId);
  }, [activeProgramId, refreshAccountsFor]);

  const activeProgram = programs.find(item => item.programId === activeProgramId) ?? null;
  const selectProgram = useCallback((programId: string) => {
    if (!programs.some(item => item.programId === programId)) return;
    setActiveProgramId(programId);
    persistProgramId(programId);
  }, [persistProgramId, programs]);

  const createProgram = useCallback(async (input: Record<string, unknown>) => {
    setMutating(true);
    setError('');
    try {
      const created = await socialProgramApi.create(input);
      setPrograms(current => [created, ...current.filter(item => item.programId !== created.programId)]);
      setActiveProgramId(created.programId);
      persistProgramId(created.programId);
      return created;
    } catch (requestError) {
      setError(errorMessage(requestError));
      throw requestError;
    } finally {
      setMutating(false);
    }
  }, [persistProgramId]);

  const updateActiveProgram = useCallback(async (input: Record<string, unknown>) => {
    if (!activeProgram) throw new Error('请先选择一个社媒经营项目。');
    setMutating(true);
    setError('');
    try {
      const updated = await socialProgramApi.update(activeProgram.programId, input);
      setPrograms(current => current.map(item => item.programId === updated.programId ? updated : item));
      return updated;
    } catch (requestError) {
      setError(errorMessage(requestError));
      throw requestError;
    } finally {
      setMutating(false);
    }
  }, [activeProgram]);

  const createAccount = useCallback(async (input: Record<string, unknown>) => {
    if (!activeProgram) throw new Error('请先选择一个社媒经营项目。');
    setMutating(true);
    setAccountsError('');
    try {
      const created = await socialProgramApi.createAccount(activeProgram.programId, input);
      setAccounts(current => [...current, created]);
      return created;
    } catch (requestError) {
      setAccountsError(errorMessage(requestError));
      throw requestError;
    } finally {
      setMutating(false);
    }
  }, [activeProgram]);

  const saveMonthlyPlan = useCallback(async (input: Record<string, unknown>) => {
    if (!activeProgram) throw new Error('请先选择一个社媒经营项目。');
    setMutating(true);
    setError('');
    try {
      const saved = await socialProgramApi.saveMonthlyPlan(activeProgram.programId, input);
      if (input.activate === true) await refreshPrograms();
      return saved;
    } catch (requestError) {
      setError(errorMessage(requestError));
      throw requestError;
    } finally {
      setMutating(false);
    }
  }, [activeProgram, refreshPrograms]);

  const value = useMemo<SocialProgramContextValue>(() => ({
    programs,
    activeProgram,
    activeProgramId,
    accounts,
    loading,
    accountsLoading,
    mutating,
    error,
    accountsError,
    selectProgram,
    refreshPrograms,
    refreshAccounts: () => refreshAccountsFor(activeProgramId),
    createProgram,
    updateActiveProgram,
    createAccount,
    saveMonthlyPlan,
  }), [
    accounts, accountsError, accountsLoading, activeProgram, activeProgramId, createAccount, createProgram,
    error, loading, mutating, programs, refreshAccountsFor, refreshPrograms, saveMonthlyPlan, selectProgram,
    updateActiveProgram,
  ]);

  return <SocialProgramContext.Provider value={value}>{children}</SocialProgramContext.Provider>;
}

export function useSocialProgram(): SocialProgramContextValue {
  const context = useContext(SocialProgramContext);
  if (!context) throw new Error('useSocialProgram 必须在 SocialProgramProvider 内使用。');
  return context;
}
