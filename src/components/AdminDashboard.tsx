import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, Modal } from 'antd';
import LsPageHeader from './ui/LsPageHeader';
import { LsGradientProgress } from './ui/LsExperiencePrimitives';
import { Loader2, LogIn, RefreshCcw, Settings2, UserCheck } from 'lucide-react';
import {
  authApi,
  authHeader,
  exitSupportSession,
  startSupportSession,
  type AuthSession,
} from '../lib/auth';

interface AdminAccount {
  email: string;
  tenantId: string;
  tenantName: string;
  credentialState: string;
  credentialAction: string;
  status: string;
  activatedAt: string | null;
  expiresAt: string | null;
  trialDay: number | null;
  trialDays: number | null;
  daysRemaining: number | null;
  tokenUsedToday: number;
  tokenUsedTotal: number;
  tokenLimit: number | null;
  aiChatToday: number;
  generationToday: number;
  renderToday: number;
  videoGenerationToday: number;
  rotatedAt: string | null;
}

interface CustomerAccount {
  tenantId: string;
  companyName: string;
  contactName: string;
  industry: string;
  emails: string[];
  credentialState: string;
  credentialAction: string;
  inviteCode: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  createdAt: string | null;
  registeredAt: string | null;
  expiresAt: string | null;
  tokenUsedToday: number;
  tokenUsedTotal: number;
  aiChatToday: number;
  generationToday: number;
  renderToday: number;
  videoGenerationToday: number;
}

interface StyleAdoptionTrend {
  tenantId: string;
  week: string;
  total: number;
  directSent: number;
  rate: number;
}

interface ContentExecutionLimitView {
  scope: 'tenant' | 'account' | 'task_type';
  scopeKey: string;
  maxRunning: number;
}

interface ContentLimitDraft {
  tenantMaxRunning: string;
  accountDefaultMaxRunning: string;
  weeklyMaxRunning: string;
  instantMaxRunning: string;
}

const fmtDate = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const fmtTokens = (value: number) => value.toLocaleString('en-US');
const credentialStateLabel = (value: string) => ({
  active_hash_only: '认证哈希有效',
  external_secret: '受控渠道凭据',
  password_reset_required: '需要密码重置',
  expired_locked: '到期已锁定',
}[value] || '需要密码重置');

export default function AdminDashboard({ onSupportSessionStarted }: { onSupportSessionStarted: (session: AuthSession) => void }) {
  const [trialAccounts, setTrialAccounts] = useState<AdminAccount[]>([]);
  const [customerAccounts, setCustomerAccounts] = useState<CustomerAccount[]>([]);
  const [styleTrends, setStyleTrends] = useState<StyleAdoptionTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportBusyTenantId, setSupportBusyTenantId] = useState<string | null>(null);
  const [supportError, setSupportError] = useState<{ tenantId: string; message: string } | null>(null);
  const [promotingTenantId, setPromotingTenantId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [limitTenant, setLimitTenant] = useState<CustomerAccount | null>(null);
  const [limitDraft, setLimitDraft] = useState<ContentLimitDraft>({
    tenantMaxRunning: '2', accountDefaultMaxRunning: '1', weeklyMaxRunning: '2', instantMaxRunning: '2',
  });
  const [limitBusy, setLimitBusy] = useState(false);
  const [limitError, setLimitError] = useState('');
  const loadInFlightRef = useRef(false);
  const loadControllerRef = useRef<AbortController | null>(null);

  const industryAccounts = useMemo(() => customerAccounts.reduce<Array<{
    industry: string; customerCount: number; accountCount: number; customers: string[]; activeCount: number;
  }>>((groups, account) => {
    const industry = account.industry.trim() || '未标注行业';
    const group = groups.find(item => item.industry === industry);
    if (group) {
      group.customerCount += 1;
      group.accountCount += account.emails.length;
      group.customers.push(account.companyName);
      if (account.subscriptionStatus === 'active') group.activeCount += 1;
    } else {
      groups.push({ industry, customerCount: 1, accountCount: account.emails.length, customers: [account.companyName], activeCount: account.subscriptionStatus === 'active' ? 1 : 0 });
    }
    return groups;
  }, []).sort((a, b) => b.customerCount - a.customerCount || a.industry.localeCompare(b.industry)), [customerAccounts]);

  const groupedTrends = useMemo(() => Object.entries(styleTrends.reduce<Record<string, StyleAdoptionTrend[]>>((groups, item) => {
    (groups[item.tenantId] ||= []).push(item);
    return groups;
  }, {})).slice(0, 6), [styleTrends]);

  const load = async (options: { silent?: boolean } = {}) => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const [accountResp, trendResp] = await Promise.all([
        fetch(`/api/overseas/admin/demo-accounts?_=${Date.now()}`, {
          headers: authHeader(),
          cache: 'no-store',
          signal: controller.signal,
        }),
        fetch(`/api/overseas/admin/style-adoption-trends?_=${Date.now()}`, {
          headers: authHeader(),
          cache: 'no-store',
          signal: controller.signal,
        }),
      ]);
      const accountJson = await accountResp.json().catch(() => ({}));
      if (!accountResp.ok) throw new Error(accountJson.error || '读取失败');
      const trendJson = await trendResp.json().catch(() => ({}));
      setTrialAccounts(Array.isArray(accountJson.trialAccounts) ? accountJson.trialAccounts : accountJson.accounts ?? []);
      setCustomerAccounts(Array.isArray(accountJson.customerAccounts) ? accountJson.customerAccounts : []);
      setAccountsLoaded(true);
      setStyleTrends(trendResp.ok ? trendJson.items ?? [] : []);
    } catch (err) {
      if (controller.signal.aborted) {
        if (!options.silent) setError('读取超时，请稍后重试');
        return;
      }
      setError(err instanceof Error ? err.message : '读取失败');
    } finally {
      window.clearTimeout(timeout);
      if (loadControllerRef.current === controller) loadControllerRef.current = null;
      loadInFlightRef.current = false;
      if (!options.silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    }, 10_000);
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      loadControllerRef.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, []);

  const enterTenant = async (target: { tenantId: string; tenantName: string }) => {
    if (!target.tenantId) return;
    setSupportBusyTenantId(target.tenantId);
    setSupportError(null);
    try {
      const response = await fetch('/api/overseas/admin/support-access/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(target),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) {
        throw new Error(data.error === 'support_access_disabled' ? '该租户已关闭技术支持授权' : data.error || '进入失败');
      }
      startSupportSession(data.token);
      const supportSession = await authApi.me();
      if (!supportSession?.supportAccess) {
        exitSupportSession();
        throw new Error('协助会话校验失败，请重试');
      }
      onSupportSessionStarted(supportSession);
    } catch (cause) {
      setSupportError({
        tenantId: target.tenantId,
        message: cause instanceof Error ? cause.message : '进入失败',
      });
      setSupportBusyTenantId(null);
    }
  };

  const promoteTrial = async (account: AdminAccount) => {
    if (!account.tenantId || promotingTenantId) return;
    const confirmed = window.confirm(`将 ${account.email} 转为正式客户？原客户空间、历史内容和社媒授权都会保留。`);
    if (!confirmed) return;
    setPromotingTenantId(account.tenantId);
    setError(null);
    setNotice('');
    try {
      const response = await fetch(`/api/overseas/admin/trial-accounts/${encodeURIComponent(account.tenantId)}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ companyName: account.tenantName || account.email.split('@')[0] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '转为正式客户失败');
      setNotice(data.message || '已转为正式客户，原客户空间保持不变。');
      await load({ silent: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '转为正式客户失败');
    } finally {
      setPromotingTenantId(null);
    }
  };

  const openContentLimits = async (account: CustomerAccount) => {
    setLimitTenant(account);
    setLimitBusy(true);
    setLimitError('');
    try {
      const response = await fetch(`/api/overseas/admin/content-execution-limits/${encodeURIComponent(account.tenantId)}`, {
        headers: authHeader(), cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '读取并发上限失败');
      const limits = Array.isArray(data.limits) ? data.limits as ContentExecutionLimitView[] : [];
      const value = (scope: ContentExecutionLimitView['scope'], scopeKey: string, fallback: number) => String(
        limits.find(item => item.scope === scope && item.scopeKey === scopeKey)?.maxRunning ?? fallback,
      );
      setLimitDraft({
        tenantMaxRunning: value('tenant', '*', Number(data.defaults?.tenantMaxRunning) || 2),
        accountDefaultMaxRunning: value('account', '*', Number(data.defaults?.accountMaxRunning) || 1),
        weeklyMaxRunning: value('task_type', 'social_content_weekly', Number(data.defaults?.taskTypeMaxRunning) || 2),
        instantMaxRunning: value('task_type', 'social_content_instant', Number(data.defaults?.taskTypeMaxRunning) || 2),
      });
    } catch (cause) {
      setLimitError(cause instanceof Error ? cause.message : '读取并发上限失败');
    } finally {
      setLimitBusy(false);
    }
  };

  const saveContentLimits = async () => {
    if (!limitTenant || limitBusy) return;
    const values = Object.values(limitDraft).map(Number);
    if (values.some(value => !Number.isInteger(value) || value < 1 || value > 100)) {
      setLimitError('并发上限必须是 1–100 的整数');
      return;
    }
    setLimitBusy(true);
    setLimitError('');
    try {
      const response = await fetch(`/api/overseas/admin/content-execution-limits/${encodeURIComponent(limitTenant.tenantId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(Object.fromEntries(Object.entries(limitDraft).map(([key, value]) => [key, Number(value)]))),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '保存并发上限失败');
      setNotice(`已更新 ${limitTenant.companyName} 的内容任务并发上限。`);
      setLimitTenant(null);
    } catch (cause) {
      setLimitError(cause instanceof Error ? cause.message : '保存并发上限失败');
    } finally {
      setLimitBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-ink">
      <LsPageHeader title="账号总控" description="管理试用、客户与行业账号" extra={
        <Button onClick={() => void load()} loading={loading} icon={<RefreshCcw size={16} />}>刷新</Button>
      } />

      <div className="flex-1 min-h-0 overflow-auto p-5">
        {error && <Alert className="mb-3" type="error" showIcon title={error} />}
        {notice && <Alert className="mb-3" type="success" showIcon title={notice} />}

        <section className="mb-6 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-text-primary">销售风格采纳率趋势</span>
            <span className="text-[10px] text-text-muted">草稿未修改直接发送率，按周聚合</span>
          </div>
          {!groupedTrends.length ? <p className="px-3 py-4 text-xs text-text-muted">暂无风格学习采纳数据。</p> : (
            <div className="grid gap-2 p-3 md:grid-cols-2">
              {groupedTrends.map(([tenantId, items]) => (
                <div key={tenantId} className="rounded-lg border border-border bg-white p-3">
                  <p className="truncate text-xs font-semibold text-text-primary">tenant {tenantId}</p>
                  <div className="mt-3 space-y-2">
                    {items.slice(0, 6).reverse().map(item => (
                      <div key={`${tenantId}-${item.week}`} className="grid grid-cols-[64px_1fr_48px] items-center gap-2 text-[10px] text-text-muted">
                        <span>{item.week}</span><LsGradientProgress percent={Math.max(0, Math.min(100, item.rate * 100))} showInfo={false} size="small" /><span className="text-right">{Math.round(item.rate * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section id="admin-trial-accounts" className="scroll-mt-5">
          <div className="mb-2 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-text-primary">试用账号表</h2><p className="mt-0.5 text-xs text-text-muted">后台不保存或展示密码；试用凭据仅通过受控渠道一次性设置或重置。</p></div><span className="text-xs text-text-muted">{accountsLoaded ? `${trialAccounts.length} 个账号` : loading ? '读取中' : '读取失败'}</span></div>
          <div className="overflow-auto border border-border rounded-lg">
            <table className="min-w-[1440px] w-full text-xs">
              <thead className="bg-surface-2 text-text-muted">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">账号</th>
                  <th className="px-3 py-2 font-semibold">凭据状态 / 重置说明</th>
                  <th className="px-3 py-2 font-semibold">流转状态</th>
                  <th className="px-3 py-2 font-semibold">试用进度</th>
                  <th className="px-3 py-2 font-semibold">激活时间</th>
                  <th className="px-3 py-2 font-semibold">到期时间</th>
                  <th className="px-3 py-2 font-semibold">Token 今日/总计</th>
                  <th className="px-3 py-2 font-semibold">今日功能次数</th>
                  <th className="px-3 py-2 font-semibold">最近安全处置</th>
                  <th className="px-3 py-2 font-semibold">客户状态</th>
                  <th className="px-3 py-2 font-semibold">租户后台</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && !accountsLoaded && <tr><td colSpan={11} className="px-3 py-8 text-center text-text-muted">读取中...</td></tr>}
                {(!loading || accountsLoaded) && trialAccounts.map(account => {
                  const busy = supportBusyTenantId === account.tenantId;
                  return (
                    <tr key={account.email} className="hover:bg-surface-2/60">
                      <td className="px-3 py-2 font-semibold text-text-primary whitespace-nowrap">{account.email}</td>
                      <td className="px-3 py-2 text-text-secondary"><span className="font-semibold text-text-primary">{credentialStateLabel(account.credentialState)}</span><p className="mt-0.5 max-w-64 text-[10px] leading-4 text-text-muted">{account.credentialAction}</p></td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.status}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.trialDays ? `第 ${account.trialDay ?? '-'} / ${account.trialDays} 天，剩余 ${account.daysRemaining ?? '-'} 天` : '长期有效'}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.activatedAt)}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.expiresAt)}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtTokens(account.tokenUsedToday)} / {fmtTokens(account.tokenUsedTotal)}{account.tokenLimit ? ` / ${fmtTokens(account.tokenLimit)}` : ''}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">对话 {account.aiChatToday} · 生成 {account.generationToday} · 渲染 {account.renderToday} · 视频 {account.videoGenerationToday}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.rotatedAt ? `${fmtDate(account.rotatedAt)} · 已锁定，恢复前须重置` : '未发生后台轮换'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void promoteTrial(account)}
                          disabled={Boolean(promotingTenantId)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          {promotingTenantId === account.tenantId ? <Loader2 size={12} className="animate-spin" /> : <UserCheck size={12} />}
                          {promotingTenantId === account.tenantId ? '转正中' : '转为正式客户'}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void enterTenant({ tenantId: account.tenantId, tenantName: account.tenantName || account.email })}
                          disabled={busy || !account.tenantId}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
                          {busy ? '正在进入' : '进入后台'}
                        </button>
                        {supportError?.tenantId === account.tenantId && <p className="mt-1 max-w-36 whitespace-normal text-[10px] leading-4 text-red-600">{supportError.message}</p>}
                      </td>
                    </tr>
                  );
                })}
                {accountsLoaded && !trialAccounts.length && <tr><td colSpan={11} className="px-3 py-8 text-center text-text-muted">暂无试用账号</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section id="admin-customer-accounts" className="mt-6 scroll-mt-5">
          <div className="mb-2 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-text-primary">客户账号表</h2><p className="mt-0.5 text-xs text-text-muted">客户密码仅由认证系统哈希校验；后台只显示凭据状态与重置动作，不保存初始密码。</p></div><span className="text-xs text-text-muted">{accountsLoaded ? `${customerAccounts.length} 个客户` : loading ? '读取中' : '读取失败'}</span></div>
          <div className="overflow-auto border border-border rounded-lg">
            <table className="min-w-[1810px] w-full text-xs">
              <thead className="bg-surface-2 text-text-muted">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">客户主体</th>
                  <th className="px-3 py-2 font-semibold">联系人</th>
                  <th className="px-3 py-2 font-semibold">所属行业</th>
                  <th className="px-3 py-2 font-semibold">登录账号</th>
                  <th className="px-3 py-2 font-semibold">凭据状态 / 重置说明</th>
                  <th className="px-3 py-2 font-semibold">已使用邀请码</th>
                  <th className="px-3 py-2 font-semibold">订阅方案</th>
                  <th className="px-3 py-2 font-semibold">账号状态</th>
                  <th className="px-3 py-2 font-semibold">AI Token 今日/总计</th>
                  <th className="px-3 py-2 font-semibold">今日功能次数</th>
                  <th className="px-3 py-2 font-semibold">注册时间</th>
                  <th className="px-3 py-2 font-semibold">到期时间</th>
                  <th className="px-3 py-2 font-semibold">租户 ID</th>
                  <th className="px-3 py-2 font-semibold">内容任务并发</th>
                  <th className="px-3 py-2 font-semibold">租户后台</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && !accountsLoaded && <tr><td colSpan={15} className="px-3 py-8 text-center text-text-muted">读取中...</td></tr>}
                {(!loading || accountsLoaded) && customerAccounts.map(account => {
                  const busy = supportBusyTenantId === account.tenantId;
                  const registered = account.emails.length > 0;
                  return (
                    <tr key={account.tenantId} className="hover:bg-surface-2/60">
                      <td className="px-3 py-2 font-semibold text-text-primary whitespace-nowrap">{account.companyName}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.contactName || '-'}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.industry || '未标注行业'}</td>
                      <td className="px-3 py-2 text-text-secondary">{registered ? account.emails.join('、') : '待客户注册'}</td>
                      <td className="px-3 py-2 text-text-secondary"><span className="font-semibold text-text-primary">{credentialStateLabel(account.credentialState)}</span><p className="mt-0.5 max-w-64 text-[10px] leading-4 text-text-muted">{account.credentialAction}</p></td>
                      <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{account.inviteCode || '-'}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.subscriptionPlan}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.subscriptionStatus}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtTokens(account.tokenUsedToday)} / {fmtTokens(account.tokenUsedTotal)}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">对话 {account.aiChatToday} · 生成 {account.generationToday} · 渲染 {account.renderToday} · 视频 {account.videoGenerationToday}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.registeredAt || account.createdAt)}</td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.expiresAt)}</td>
                      <td className="px-3 py-2 font-mono text-text-muted whitespace-nowrap">{account.tenantId}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void openContentLimits(account)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 font-semibold text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                        >
                          <Settings2 size={12} /> 设置上限
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void enterTenant({ tenantId: account.tenantId, tenantName: account.companyName })}
                          disabled={busy || !registered}
                          title={registered ? `进入 ${account.companyName} 后台` : '客户注册后可进入后台'}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
                          {busy ? '正在进入' : '进入后台'}
                        </button>
                        {supportError?.tenantId === account.tenantId && <p className="mt-1 max-w-36 whitespace-normal text-[10px] leading-4 text-red-600">{supportError.message}</p>}
                      </td>
                    </tr>
                  );
                })}
                {accountsLoaded && !customerAccounts.length && <tr><td colSpan={15} className="px-3 py-8 text-center text-text-muted">暂无客户账号</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section id="admin-industry-accounts" className="mt-6 scroll-mt-5">
          <div className="mb-2 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-text-primary">行业账号表</h2><p className="mt-0.5 text-xs text-text-muted">按客户所属行业汇总客户覆盖和登录账号规模。</p></div><span className="text-xs text-text-muted">{industryAccounts.length} 个行业</span></div>
          <div className="overflow-auto border border-border rounded-lg"><table className="min-w-[840px] w-full text-xs"><thead className="bg-surface-2 text-text-muted"><tr className="text-left"><th className="px-3 py-2 font-semibold">行业</th><th className="px-3 py-2 font-semibold">客户数</th><th className="px-3 py-2 font-semibold">登录账号数</th><th className="px-3 py-2 font-semibold">已开通客户</th><th className="px-3 py-2 font-semibold">客户主体</th></tr></thead><tbody className="divide-y divide-border">{loading ? <tr><td colSpan={5} className="px-3 py-8 text-center text-text-muted">读取中...</td></tr> : industryAccounts.map(account => <tr key={account.industry} className="hover:bg-surface-2/60"><td className="px-3 py-2 font-semibold text-text-primary whitespace-nowrap">{account.industry}</td><td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.customerCount}</td><td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.accountCount}</td><td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.activeCount}</td><td className="px-3 py-2 text-text-secondary">{account.customers.join('、')}</td></tr>)}{!loading && !industryAccounts.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-text-muted">暂无客户行业资料</td></tr>}</tbody></table></div>
        </section>
      </div>

      {limitTenant && (
        <Modal open title="内容任务并发上限" width={560} onCancel={() => setLimitTenant(null)} mask={{ closable: false }} closable={!limitBusy} keyboard={!limitBusy}
          footer={<><Button onClick={() => setLimitTenant(null)} disabled={limitBusy}>取消</Button><Button type="primary" onClick={() => void saveContentLimits()} loading={limitBusy}>保存上限</Button></>}
        >
            <p className="mb-4 text-sm text-text-secondary">{limitTenant.companyName} · 大批量任务会在数据库队列中等待，不挤占其他客户。</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                ['tenantMaxRunning', '客户总并发', '该客户所有内容任务合计'],
                ['accountDefaultMaxRunning', '单账号并发', '避免一个账号占满客户额度'],
                ['weeklyMaxRunning', '周计划任务并发', '智能经营生成的内容任务'],
                ['instantMaxRunning', '单次任务并发', '用户手动创建的单个任务'],
              ] as const).map(([key, label, help]) => (
                <label key={key} className="block">
                  <span className="text-xs font-semibold text-text-primary">{label}</span>
                  <Input
                    type="number" min={1} max={100} step={1}
                    value={limitDraft[key]}
                    onChange={event => setLimitDraft(current => ({ ...current, [key]: event.target.value }))}
                    disabled={limitBusy}
                    className="mt-1.5 w-full"
                  />
                  <span className="mt-1 block text-[10px] leading-4 text-text-muted">{help}</span>
                </label>
              ))}
            </div>
            {limitError && <Alert className="mt-4" type="error" showIcon title={limitError} />}
        </Modal>
      )}
    </div>
  );
}
