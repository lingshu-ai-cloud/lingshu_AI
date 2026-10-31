import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Empty, Segmented, Select, Tag } from 'antd';
import { RefreshCcw } from 'lucide-react';
import { authApi, authHeader } from '../../lib/auth';

type UsageRange = 'today' | '7d' | '30d' | 'all';
type AccountOption = { tenantId: string; label: string; email?: string };
type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  outputCount: number;
  measuredEventCount: number;
  settledCostCny: number;
  knownCostEventCount: number;
};
type UsageSnapshot = {
  generatedAt: string;
  source: string;
  tenantId: string;
  range: UsageRange;
  hasMeasuredUsage: boolean;
  totals: UsageTotals;
  coverage: {
    scannedRecordCount: number;
    reserveExcludedCount: number;
    terminalEventCount: number;
    measuredTerminalCount: number;
    unmeasuredTerminalCount: number;
    invalidTerminalCount: number;
    failedTerminalCount: number;
    unknownCostEventCount: number;
  };
  byRole: Array<UsageTotals & { role: string; label: string }>;
  recent: Array<{
    occurredAt: string;
    roleLabel: string;
    capability: string;
    state: 'settled' | 'failed';
    inputTokens: number | null;
    outputTokens: number | null;
    cacheTokens: number | null;
    totalTokens: number | null;
    outputCount: number;
    settledCostCny: number | null;
  }>;
};

const fmt = (value: number) => value.toLocaleString('zh-CN');

function accountOptions(payload: Record<string, unknown>): AccountOption[] {
  const customers = Array.isArray(payload.customerAccounts) ? payload.customerAccounts : [];
  const trials = Array.isArray(payload.trialAccounts)
    ? payload.trialAccounts
    : Array.isArray(payload.accounts) ? payload.accounts : [];
  const options = [...customers, ...trials].flatMap(raw => {
    const row = raw as Record<string, unknown>;
    const tenantId = String(row.tenantId ?? '').trim();
    if (!tenantId) return [];
    const email = String(row.email ?? (Array.isArray(row.emails) ? row.emails[0] : '') ?? '').trim();
    const name = String(row.companyName ?? row.tenantName ?? row.contactName ?? email ?? tenantId).trim();
    return [{ tenantId, email, label: name || tenantId }];
  });
  return [...new Map(options.map(item => [item.tenantId, item])).values()];
}

export default function DeveloperUsageMonitor() {
  const params = new URLSearchParams(window.location.search);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [tenantId, setTenantId] = useState(params.get('usageTenantId') ?? '');
  const [range, setRange] = useState<UsageRange>('7d');
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAccounts = useCallback(async () => {
    const [response, session] = await Promise.all([
      fetch(`/api/overseas/admin/demo-accounts?_=${Date.now()}`, {
        headers: authHeader(), cache: 'no-store',
      }),
      authApi.me().catch(() => null),
    ]);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '读取用户账号失败');
    const currentAccount: AccountOption[] = session?.user?.tenantId ? [{
      tenantId: session.user.tenantId,
      email: session.user.email,
      label: session.tenant?.name || session.user.name || '当前登录账号',
    }] : [];
    const next = [...new Map([...currentAccount, ...accountOptions(payload)]
      .map(item => [item.tenantId, item])).values()];
    setAccounts(next);
    setTenantId(current => next.some(item => item.tenantId === current) ? current : next[0]?.tenantId ?? '');
  }, []);

  const loadUsage = useCallback(async (targetTenantId: string, targetRange: UsageRange) => {
    if (!targetTenantId) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ tenantId: targetTenantId, range: targetRange, _: String(Date.now()) });
      const response = await fetch(`/api/overseas/admin/api-economics/usage?${query}`, {
        headers: authHeader(), cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '读取真实消耗失败');
      setSnapshot(payload as UsageSnapshot);
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error ? cause.message : '读取真实消耗失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts().catch(cause => {
      setError(cause instanceof Error ? cause.message : '读取用户账号失败');
      setLoading(false);
    });
  }, [loadAccounts]);

  useEffect(() => { void loadUsage(tenantId, range); }, [loadUsage, range, tenantId]);

  const selected = useMemo(() => accounts.find(item => item.tenantId === tenantId), [accounts, tenantId]);
  const changeTenant = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('usageTenantId', value);
    window.history.replaceState({}, '', url);
    setTenantId(value);
  };
  const value = (amount: number) => snapshot?.hasMeasuredUsage ? fmt(amount) : '—';

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-white">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-text-secondary">监控用户
              <Select
                className="mt-1 block min-w-64"
                value={tenantId || undefined}
                placeholder="选择用户"
                options={accounts.map(item => ({
                  value: item.tenantId,
                  label: item.email ? `${item.label} · ${item.email}` : item.label,
                }))}
                onChange={changeTenant}
              />
            </label>
            <Segmented<UsageRange>
              value={range}
              options={[
                { label: '今日', value: 'today' },
                { label: '近 7 天', value: '7d' },
                { label: '近 30 天', value: '30d' },
                { label: '全部', value: 'all' },
              ]}
              onChange={setRange}
            />
          </div>
          <Button icon={<RefreshCcw size={15} />} loading={loading} onClick={() => void loadUsage(tenantId, range)}>刷新真实回执</Button>
        </div>

        {error && <div className="p-5"><Alert type="error" showIcon title={error} /></div>}
        {!error && !tenantId && <div className="p-10"><Empty description="当前没有可监控的用户账号" /></div>}
        {!error && tenantId && snapshot && <>
          <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            {[
              ['真实输入', value(snapshot.totals.inputTokens), 'provider input tokens'],
              ['真实输出', value(snapshot.totals.outputTokens), 'provider output tokens'],
              ['缓存输入', value(snapshot.totals.cacheTokens), 'provider cached input tokens'],
              ['输入 + 输出', value(snapshot.totals.totalTokens), `${snapshot.totals.measuredEventCount} 条实测回执`],
            ].map(([label, amount, detail]) => <div key={label} className="px-5 py-5">
              <p className="text-xs text-text-muted">{label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">{amount}</p>
              <p className="mt-1 text-[11px] text-text-muted">{detail}</p>
            </div>)}
          </div>
          <div className="border-t border-border px-5 py-3 text-xs text-text-secondary">
            当前用户：<span className="font-medium text-text-primary">{selected?.label ?? tenantId}</span>
            <span className="mx-2 text-border">|</span>
            数据源：实际终态回执；预留量与估算量不计入真实输入/输出。
            {snapshot.coverage.unmeasuredTerminalCount > 0 && <Tag className="ml-2" color="warning">{snapshot.coverage.unmeasuredTerminalCount} 条终态回执未返回 token</Tag>}
          </div>
        </>}
      </section>

      {!error && snapshot && !snapshot.hasMeasuredUsage && <Alert
        type="info"
        showIcon
        title="暂无带真实 token 的终态回执"
        description="这里不会把预留值、估算值或缺失字段显示成 0；供应商返回实际 input/output 后才会进入统计。"
      />}

      {!error && snapshot?.hasMeasuredUsage && <section className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold text-text-primary">按数字员工拆分</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-surface-2 text-text-muted"><tr><th className="px-5 py-3">数字员工</th><th className="px-5 py-3">真实输入</th><th className="px-5 py-3">真实输出</th><th className="px-5 py-3">缓存输入</th><th className="px-5 py-3">实测回执</th></tr></thead>
            <tbody className="divide-y divide-border">{snapshot.byRole.map(row => <tr key={row.role}>
              <td className="px-5 py-3 font-medium text-text-primary">{row.label}</td>
              <td className="px-5 py-3">{fmt(row.inputTokens)}</td>
              <td className="px-5 py-3">{fmt(row.outputTokens)}</td>
              <td className="px-5 py-3">{fmt(row.cacheTokens)}</td>
              <td className="px-5 py-3">{fmt(row.measuredEventCount)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}

      {!error && snapshot?.hasMeasuredUsage && <section className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h3 className="text-sm font-semibold text-text-primary">最近真实回执</h3><span className="text-xs text-text-muted">更新于 {new Date(snapshot.generatedAt).toLocaleString('zh-CN', { hour12: false })}</span></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-xs">
            <thead className="bg-surface-2 text-text-muted"><tr><th className="px-5 py-3">时间</th><th className="px-5 py-3">数字员工 / 能力</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">输入</th><th className="px-5 py-3">输出</th><th className="px-5 py-3">缓存</th></tr></thead>
            <tbody className="divide-y divide-border">{snapshot.recent.map((row, index) => <tr key={`${row.occurredAt}-${index}`}>
              <td className="px-5 py-3 text-text-secondary">{new Date(row.occurredAt).toLocaleString('zh-CN', { hour12: false })}</td>
              <td className="px-5 py-3"><p className="font-medium text-text-primary">{row.roleLabel}</p><p className="mt-0.5 font-mono text-[10px] text-text-muted">{row.capability}</p></td>
              <td className="px-5 py-3"><Tag color={row.state === 'settled' ? 'success' : 'warning'}>{row.state === 'settled' ? '已完成' : '失败终态'}</Tag></td>
              <td className="px-5 py-3">{row.inputTokens === null ? '未返回' : fmt(row.inputTokens)}</td>
              <td className="px-5 py-3">{row.outputTokens === null ? '未返回' : fmt(row.outputTokens)}</td>
              <td className="px-5 py-3">{row.cacheTokens === null ? '未返回' : fmt(row.cacheTokens)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}
    </div>
  );
}
