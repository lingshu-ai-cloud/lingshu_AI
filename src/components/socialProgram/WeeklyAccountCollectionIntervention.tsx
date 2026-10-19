import { Alert, Button, Form, Select, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { authHeader, getToken } from '../../lib/auth';

type Authority = { scopeId: string; scopeVersion: number; scopeHash: string; productFactBindingHash: string | null };
type Account = { id: string; platform: string; accountUrl: string; accountName: string };
type ScopeRead = { persisted: boolean; needsConfirmation: boolean; revisionAuthority: Authority | null; scope?: { discoveryBrief?: { weeklyAccountCollectionTarget?: { accountUrl: string; targetCount: number } } } };

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw Error(body.message || body.error || '采集范围读取或保存失败');
  return body;
}

/** An action on the existing weekly task card; it never starts a crawl. */
export default function WeeklyAccountCollectionIntervention({ packageIdentity }: { packageIdentity: string }) {
  const current = useRef(packageIdentity);
  current.current = packageIdentity;
  const [scope, setScope] = useState<ScopeRead | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const load = async () => {
    const identity = packageIdentity, token = getToken();
    setBusy(true); setError('');
    try {
      const [scopeRead, accountRead] = await Promise.all([
        fetch('/api/overseas/social-discovery/scope', { headers: authHeader() }).then(response => jsonResponse<ScopeRead>(response)),
        fetch('/api/overseas/competitor-accounts', { headers: authHeader() }).then(response => jsonResponse<{ items: Account[] }>(response)),
      ]);
      if (current.current !== identity || getToken() !== token) return;
      setScope(scopeRead);
      setAccounts(accountRead.items.filter(account => account.platform === 'tiktok' && /^https:\/\/www\.tiktok\.com\/@[A-Za-z0-9._]{2,24}\/?$/.test(account.accountUrl)));
      setAccountId(null);
    } catch (cause) {
      if (current.current === identity && getToken() === token) setError(cause instanceof Error ? cause.message : '采集范围读取失败');
    } finally { if (current.current === identity && getToken() === token) setBusy(false); }
  };
  useEffect(() => { setScope(null); setAccounts([]); setAccountId(null); setSubmitted(false); void load(); }, [packageIdentity]);
  const authority = scope?.revisionAuthority;
  const target = scope?.scope?.discoveryBrief?.weeklyAccountCollectionTarget;
  const approvedTarget = Boolean(scope?.persisted && !scope.needsConfirmation && target?.targetCount === 5);
  const selected = accounts.find(account => account.id === accountId);
  const canSubmit = Boolean(scope?.persisted && !scope.needsConfirmation && authority?.productFactBindingHash && selected && !busy && !target);
  const submit = async () => {
    if (!canSubmit || !authority || !selected) return;
    const identity = packageIdentity, token = getToken(); setBusy(true); setError('');
    try {
      await fetch('/api/overseas/social-discovery/scope/weekly-account-revision', {
        method: 'POST', headers: { ...authHeader(), 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: selected.id, expectedScopeId: authority.scopeId, expectedScopeVersion: authority.scopeVersion, expectedScopeHash: authority.scopeHash, expectedProductFactBindingHash: authority.productFactBindingHash, targetCount: 5 }),
      }).then(response => jsonResponse(response));
      if (current.current !== identity || getToken() !== token) return;
      setSubmitted(true);
      await load();
    } catch (cause) {
      if (current.current === identity && getToken() === token) setError(`${cause instanceof Error ? cause.message : '保存失败'}；请先核对最新范围，不要重复提交。`);
    } finally { if (current.current === identity && getToken() === token) setBusy(false); }
  };
  return <section aria-label="同账号五条采集范围" className="space-y-3 rounded-lg border border-border bg-white p-4">
    <div className="flex flex-wrap items-center gap-2"><h5 className="text-sm font-semibold text-text-primary">本周同账号采集</h5><Tag color={approvedTarget ? 'success' : 'warning'}>{approvedTarget ? '范围已批准' : '待指定账号'}</Tag></div>
    <p className="text-xs leading-5 text-text-secondary">指定一个已登记的 TikTok 对标账号，本轮目标为 5 条不同且合格的视频；仍受每日 10 条额度限制。提交只建立新版采集范围，不代表已经抓取、分析或启动周包。</p>
    {approvedTarget && target ? <Alert type="info" showIcon title={`已批准账号：${target.accountUrl}`} description="待当前周包修订和真实采集结果核验；不能将历史素材算作本轮五条。" /> : <>
      {!scope?.persisted || scope.needsConfirmation || !authority?.productFactBindingHash ? <Alert type="warning" showIcon title="当前采集范围尚不可修订" description="请先在灵感中心确认当前企业的采集范围与产品事实；任务卡不能绕过原范围审批。" /> : null}
      {accounts.length === 0 && <Alert type="warning" showIcon title="尚无可选的 TikTok 对标账号" description="请先在灵感中心登记准确的账号主页，再回到任务卡刷新。" />}
      <Form layout="vertical" onFinish={() => void submit()}><Form.Item label="本轮采集账号" required><Select aria-label="本轮采集账号" className="min-h-11 [&_.ant-select-selector]:!min-h-11" value={accountId} onChange={setAccountId} placeholder="选择已登记的 TikTok 账号" options={accounts.map(account => ({ value: account.id, label: `${account.accountName || account.accountUrl} · ${account.accountUrl}` }))} /></Form.Item>
        <div className="flex flex-wrap gap-2"><Button className="min-h-11" type="primary" htmlType="submit" disabled={!canSubmit} loading={busy}>确认五条采集范围</Button><Button className="min-h-11" onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'socialInspiration' } }))}>前往灵感中心登记账号</Button></div>
      </Form>
    </>}
    {submitted && <Alert type="info" showIcon title="新版范围已保存" description="周包修订与采集须按原任务恢复；本卡没有发起爬取。" />}
    {error && <Alert type="error" showIcon title={error} action={<Button className="min-h-11" loading={busy} onClick={() => void load()}>读取最新范围</Button>} />}
    {!target && <Button className="min-h-11" loading={busy} onClick={() => void load()}>刷新账号与范围</Button>}
  </section>;
}
