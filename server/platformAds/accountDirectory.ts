import type { AdAccountDirectory } from '../../shared/adAccountDirectory.js';
import { listConnections, getConnectionCredential, connectAccount } from './connections.js';
import { getHistoryAccounts } from './historyAccounts.js';
import { AdProviderError, MetaAdsAdapter } from './metaAdapter.js';
import { withPlatformAdTaskLock } from './taskLock.js';

export async function getAccountDirectory(tenantId: string): Promise<AdAccountDirectory> {
  const connections = await listConnections(tenantId), result: AdAccountDirectory = { items: [], warnings: [] };
  for (const connection of connections) {
    if (connection.provider !== 'meta') {
      result.items.push({ key: `${connection.provider}:${connection.accountId}`, connectionId: connection.id, accountId: connection.accountId, name: connection.name, currency: connection.currency, provider: connection.provider, localConnectionId: connection.id }); continue;
    }
    let accounts: Array<{ accountId: string; name: string; currency: string }>;
    try { accounts = await getHistoryAccounts(tenantId, connection.id); }
    catch { result.warnings.push(`${connection.name} 的授权目录未完整返回，暂保留已连接账户。`); accounts = [connection]; }
    for (const account of accounts) {
      const key = `meta:${account.accountId}`;
      if (result.items.some(item => item.key === key)) continue;
      const local = connections.find(c => c.provider === 'meta' && c.accountId === account.accountId);
      result.items.push({ key, connectionId: local?.id || connection.id, ...account, provider: 'meta', ...(local ? { localConnectionId: local.id } : {}) });
    }
  }
  return result;
}
export async function readGrantedAdapter(tenantId: string, connectionId: string, accountId: string) {
  const { connection, accessToken } = await getConnectionCredential(tenantId, connectionId);
  if (connection.provider !== 'meta' || !/^\d+$/.test(accountId) || connection.accountId !== accountId && !(await getHistoryAccounts(tenantId, connectionId)).some(a => a.accountId === accountId)) throw new AdProviderError('账户不在当前企业授权范围内', 'NOT_FOUND');
  return { connection, accessToken, adapter: new MetaAdsAdapter(accessToken) };
}
/** Explicit user choice saves a local connection only; provider calls remain GET. */
export async function useGrantedAccount(tenantId: string, connectionId: string, accountId: string) {
  const { accessToken, adapter } = await readGrantedAdapter(tenantId, connectionId, accountId);
  return withPlatformAdTaskLock(tenantId, `account-choice-${accountId}`, async () => {
  const existing = (await listConnections(tenantId)).find(c => c.provider === 'meta' && c.accountId === accountId);
  const account = await adapter.account(accountId);
  if (String(account.id).replace(/^act_/, '') !== accountId || Number(account.account_status) !== 1) throw new AdProviderError('所选账户当前不可用于创编，请核对平台账户状态', 'ACCOUNT_CONTEXT_REQUIRED');
  if (existing) {
    if (existing.currency !== account.currency || existing.status !== 'connected') throw new AdProviderError('本地账户状态或币种需要重新核对', 'ACCOUNT_CONTEXT_REQUIRED');
    return existing;
  }
  return connectAccount(tenantId, { provider: 'meta', accountId, accessToken });
  });
}
