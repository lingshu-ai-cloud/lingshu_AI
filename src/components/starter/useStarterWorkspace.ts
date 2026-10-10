import { useCallback, useEffect, useRef, useState } from 'react';
import {
  starterWorkspaceApi,
  type StarterWorkspace,
  type StarterWorkspaceCommandInput,
} from '../../lib/starterWorkspace';

export function useStarterWorkspace() {
  const mountedRef = useRef(true);
  const [workspace, setWorkspace] = useState<StarterWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const next = await starterWorkspaceApi.get({ force });
      if (mountedRef.current) setWorkspace(next);
    } catch (loadError) {
      if (mountedRef.current) setError(loadError instanceof Error ? loadError.message : '灵小枢工作台暂时无法读取');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const execute = useCallback(async (input: StarterWorkspaceCommandInput) => {
    const commandKey = `${input.command}:${input.targetId || ''}`;
    setPendingCommand(commandKey);
    setError('');
    setNotice('');
    try {
      const result = await starterWorkspaceApi.command(input);
      if (!mountedRef.current) return result;
      if (result.workspace) setWorkspace(result.workspace);
      else await load(true);
      setNotice(result.message || '灵小枢已收到，工作流会按新状态继续。');
      return result;
    } catch (commandError) {
      if (mountedRef.current) setError(commandError instanceof Error ? commandError.message : '操作未生效，请重试');
      throw commandError;
    } finally {
      if (mountedRef.current) setPendingCommand(null);
    }
  }, [load]);

  return {
    workspace,
    loading,
    refreshing,
    error,
    notice,
    pendingCommand,
    refresh: () => load(true),
    execute,
    dismissNotice: () => setNotice(''),
  };
}
