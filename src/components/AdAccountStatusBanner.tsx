import { useEffect, useState } from 'react';
import { Alert, Button } from 'antd';
import { AUTH_TOKEN_CHANGED_EVENT, authHeader } from '../lib/auth';
import { platformAdsRequest } from '../lib/platformAds';
import type { AdDirectoryAccount } from '../../shared/adAccountDirectory';

type State = { scope: string; restricted: string[]; failed: number };
/** Read-only account status check while the plans view is visible. */
export default function AdAccountStatusBanner({ accounts, onOpen }: { accounts: AdDirectoryAccount[]; onOpen: () => void }) {
  const [identity, setIdentity] = useState(authHeader().Authorization || '');
  const [state, setState] = useState<State>({ scope: '', restricted: [], failed: 0 });
  const connections = accounts.filter(a => a.provider === 'meta' && a.localConnectionId);
  const scope = `${identity}:${connections.map(a => `${a.localConnectionId}:${a.accountId}`).sort().join(',')}`;
  useEffect(() => {
    const changed = () => setIdentity(authHeader().Authorization || '');
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
    return () => window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, changed);
  }, []);
  useEffect(() => {
    if (!identity || !connections.length) return;
    let run = 0, stopped = false;
    const abort = new AbortController();
    const check = async () => {
      const current = ++run;
      let grants: Array<{ id: string; authorization?: { status: string; checkedAt?: string } }> = [];
      let grantReadFailed = false;
      try { grants = (await platformAdsRequest<{ items: typeof grants }>('/connections', { signal: abort.signal })).items; }
      catch { grantReadFailed = true; }
      const outcomes = await Promise.all(connections.map(async item => {
        try {
          const result = await platformAdsRequest<{ accountStatus: number }>(`/connections/${encodeURIComponent(item.localConnectionId!)}/live-status`, { signal: abort.signal });
          const auth = grants.find(grant => grant.id === item.localConnectionId)?.authorization;
          return { name: item.name, status: result.accountStatus, auth };
        } catch { return { name: item.name, status: null, auth: grants.find(grant => grant.id === item.localConnectionId)?.authorization }; }
      }));
      if (stopped || abort.signal.aborted || run !== current || authHeader().Authorization !== identity) return;
      setState({ scope, restricted: outcomes.filter(item => item.status != null && item.status !== 1 || ['expiring', 'expired', 'revoked', 'missing_permissions'].includes(item.auth?.status || '')).map(item => item.name), failed: outcomes.filter(item => {
        const checked = Date.parse(item.auth?.checkedAt || '');
        return item.status == null || !item.auth || item.auth.status === 'unknown' || item.auth.status === 'healthy' && (!Number.isFinite(checked) || Date.now() - checked > 24 * 3600_000);
      }).length + (grantReadFailed ? 1 : 0) });
    };
    void check();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 5 * 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') { setState({ scope: '', restricted: [], failed: 0 }); void check(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; abort.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [scope]);
  if (state.scope !== scope || !connections.length || !state.restricted.length && !state.failed) return null;
  const message = state.restricted.length ? `${state.restricted.join('、')}：账户或授权需要处理，广告可能无法投放` : '暂时无法检查广告账户状态';
  return <Alert type="warning" showIcon title={message} description={state.failed && state.restricted.length ? '部分账户状态暂未读到。' : undefined} action={<Button size="small" onClick={onOpen}>查看账户</Button>}/>;
}
