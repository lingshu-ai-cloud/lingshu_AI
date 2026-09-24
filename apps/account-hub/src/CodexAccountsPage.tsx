import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle, ArrowRightLeft, Check, CheckCircle2, Clipboard, Clock3, Gauge, Laptop, Link2, Loader2,
  LockKeyhole, LogIn, Plus, RefreshCw, ShieldAlert, ShieldCheck, Terminal, UserRound, X,
} from 'lucide-react';
import {
  accountHubApi,
  type AccountHubAccount,
  type AccountHubAccountStatus,
  type AccountHubLocalAuthState,
  type AccountHubProvider,
  type AccountHubUsage,
  type TeamMember,
} from './accountHubApi';

const PROVIDER_LABELS: Record<AccountHubProvider, string> = { codex: 'Codex', claude: 'Claude' };
const ACCOUNT_STATUS: Record<AccountHubAccountStatus, { label: string; tone: string }> = {
  pending: { label: '等待连接', tone: 'bg-slate-100 text-slate-700' },
  ready: { label: '可用', tone: 'bg-emerald-50 text-emerald-700' },
  busy: { label: '协调锁占用', tone: 'bg-violet-50 text-violet-700' },
  reauthorization_required: { label: '本机需重新登录', tone: 'bg-amber-50 text-amber-800' },
  unavailable: { label: '本机离线', tone: 'bg-red-50 text-red-700' },
  disabled: { label: '已停用', tone: 'bg-slate-100 text-slate-500' },
};
const AUTH_STATUS: Record<AccountHubLocalAuthState, { label: string; tone: string }> = {
  authenticated: { label: '本机已认证', tone: 'text-emerald-700' },
  unauthenticated: { label: '本机未登录', tone: 'text-amber-700' },
  unavailable: { label: '客户端不可用', tone: 'text-red-700' },
  unknown: { label: '认证状态未知', tone: 'text-text-muted' },
};

const TRANSFER_BLOCK_REASON: Record<string, string> = {
  local_logout_required: '成员本机仍登录旧 Provider 身份；请先退出旧账号并让连接器上报“未登录”快照。',
  fresh_local_logout_required: '本机快照缺失或已过期；请先运行连接器上报最新的“未登录”状态。',
  account_in_use: '账号占用中；请先退出原设备连接器并等待协调锁释放。',
  account_busy: '账号占用中；请先退出原设备连接器并等待协调锁释放。',
  account_lease_held: '账号占用中；请先退出原设备连接器并等待协调锁释放。',
  legacy_managed_profile_cleanup_required: '仍有遗留服务端托管凭据；请先由运维人员人工迁移并清理。',
  account_not_pending: '账号尚未进入“等待本机登录”状态，请先完成旧身份退出并上报最新快照。',
  target_provider_account_exists: '目标成员已有同 Provider 账号槽位。',
  member_provider_account_exists: '目标成员已有同 Provider 账号槽位。',
  target_member_disabled: '目标成员已停用，请先恢复成员状态。',
  member_disabled: '目标成员已停用，请先恢复成员状态。',
};

function transferBlockLabel(code: string, message: string | null): string {
  return message || TRANSFER_BLOCK_REASON[code] || `暂不可切换或转交（${code}）`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作未完成，请重试';
}

function formatTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }: { status: AccountHubAccountStatus }) {
  const meta = ACCOUNT_STATUS[status];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${meta.tone}`}>{meta.label}</span>;
}

function UsageWindow({ label, value }: { label: string; value: { remainingPercent: number; resetsAt: string | null } | null }) {
  if (!value) return <div><p className="text-[10px] text-text-muted">{label}</p><p className="mt-1 text-xs font-bold text-text-secondary">暂不可获取</p></div>;
  return <div><div className="flex items-end justify-between gap-2"><p className="text-[10px] text-text-muted">{label}</p><p className="text-xs font-black text-text-primary">{value.remainingPercent}%</p></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${value.remainingPercent}%` }} /></div><p className="mt-1 text-[9px] text-text-muted">重置：{formatTime(value.resetsAt)}</p></div>;
}

function UsageSnapshot({ usage }: { usage: AccountHubUsage | null }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2"><p className="inline-flex items-center gap-1 text-[10px] font-black text-text-secondary"><Gauge size={12} />本机上报额度快照</p><span className="text-[9px] text-text-muted">只读 · {formatTime(usage?.checkedAt ?? null)}</span></div>
      {usage?.available ? <div className="mt-3 grid gap-3 sm:grid-cols-3"><UsageWindow label="Primary" value={usage.primary} /><UsageWindow label="Secondary" value={usage.secondary} /><div><p className="text-[10px] text-text-muted">Credits 剩余</p><p className="mt-1 text-xs font-black text-text-primary">{usage.creditsRemaining === null ? '暂不可获取' : usage.creditsRemaining.toLocaleString('zh-CN')}</p></div></div> : <p className="mt-3 rounded-lg bg-white px-3 py-3 text-[10px] text-text-muted">暂不可获取。本机连接器未上报、服务商不支持或本机登录状态无法读取时，不会估算数据。</p>}
    </div>
  );
}

function AccountLoginGuide({
  firstAccount,
  onAddAccount,
  onOpenConnector,
}: {
  firstAccount: AccountHubAccount | null;
  onAddAccount: () => void;
  onOpenConnector: (account: AccountHubAccount) => void;
}) {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const copyCommand = async (command: string) => {
    await navigator.clipboard.writeText(command);
    setCopiedCommand(command);
    window.setTimeout(() => setCopiedCommand(null), 1_500);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-sky-100 bg-sky-50/80 p-4 sm:p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-700 text-white"><LogIn size={18} /></span>
        <div>
          <h2 className="text-sm font-black text-sky-950">先看这里：账号怎么登录？</h2>
          <p className="mt-1 text-xs leading-5 text-sky-900/75">中台不会显示 Provider 密码输入框。管理员创建账号槽位后，成员在自己的电脑通过 Codex / Claude 官方客户端登录，再运行本地连接器同步状态。</p>
        </div>
      </div>
      <div className="grid gap-px bg-border lg:grid-cols-3">
        <div className="bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">1</span><p className="text-xs font-black text-text-primary">创建账号槽位</p></div>
          <p className="mt-3 text-[11px] leading-5 text-text-muted">选择 Provider、填写备注并绑定唯一成员。这一步只建立管理关系，不会触发 Provider 登录。</p>
          <button type="button" onClick={onAddAccount} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-text-primary px-3 py-2 text-[10px] font-bold text-white"><Plus size={12} />添加账号槽位</button>
        </div>
        <div className="bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">2</span><p className="text-xs font-black text-text-primary">成员在本机登录</p></div>
          <p className="mt-3 text-[11px] leading-5 text-text-muted">Codex CLI 在成员电脑依次运行；登录命令会打开浏览器完成授权：</p>
          <div className="mt-2 space-y-2">
            {['codex login', 'codex login status'].map(command => <button key={command} type="button" onClick={() => void copyCommand(command)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-left font-mono text-[10px] text-text-secondary"><span>{command}</span>{copiedCommand === command ? <Check size={12} className="text-emerald-600" /> : <Clipboard size={12} />}</button>)}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-text-muted">Claude：打开成员电脑上的官方 Claude / Claude Code，按客户端登录提示完成授权。</p>
        </div>
        <div className="bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">3</span><p className="text-xs font-black text-text-primary">连接并自动同步</p></div>
          <p className="mt-3 text-[11px] leading-5 text-text-muted">保持本机连接器运行。中台会自动刷新认证状态、最后心跳、套餐与可读取的额度快照。</p>
          <button type="button" disabled={!firstAccount} onClick={() => firstAccount && onOpenConnector(firstAccount)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[10px] font-bold text-sky-800 disabled:cursor-not-allowed disabled:opacity-45"><Terminal size={12} />{firstAccount ? '查看连接器步骤' : '先添加账号槽位'}</button>
        </div>
      </div>
    </section>
  );
}

function ConnectorGuide({ account, onClose }: { account: AccountHubAccount; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const configTemplate = JSON.stringify({
    endpoint: `${window.location.origin}/api/overseas/account-hub/telemetry/v1/account-state`,
    connectorToken: '<CONNECTOR_TOKEN：从团队用量页创建成员或轮换配置后手动填入>',
    provider: account.provider,
    accountId: account.id,
    deviceId: '<成员设备稳定 ID>',
    deviceLabel: `${account.memberName || account.label} 的电脑`,
    intervalSeconds: 60,
  }, null, 2);
  const copy = async () => {
    await navigator.clipboard.writeText(configTemplate);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-4"><div className="flex min-w-0 gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-700 text-white"><Link2 size={18} /></span><div><h2 className="text-sm font-black text-sky-950">完成官方登录后，再运行本地连接器</h2><p className="mt-1 text-xs leading-5 text-sky-900/75">Codex 成员先在自己的电脑运行 <code className="font-mono">codex login</code> 并完成浏览器授权，再用 <code className="font-mono">codex login status</code> 确认已登录。然后保存下面的配置模板并手动填入成员连接器令牌（<code className="font-mono">cdc_…</code>），不要填遥测令牌（<code className="font-mono">cdu_…</code>）。两种令牌权限分离；配置文件权限必须设为 <code className="font-mono">0600</code>。</p></div></div><button type="button" onClick={onClose} aria-label="关闭本机连接指引" className="rounded-lg p-1.5 text-sky-800 hover:bg-white"><X size={16} /></button></div>
      <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950 p-4 text-[11px] leading-5 text-slate-100">{configTemplate}</pre>
      <div className="mt-3 rounded-xl border border-sky-200 bg-white/70 px-3 py-2 text-[10px] leading-5 text-sky-950"><p><strong>持续运行：</strong><code className="ml-1 font-mono">pnpm account-hub:connector -- --config &lt;path&gt; --watch --hold</code></p><p><code className="font-mono">--watch --hold</code> 会持续心跳并维护协调锁；停止连接器只停止续租，锁会在 TTL 后自然到期。只有官方客户端明确变为“未登录”时才会立即精确释放；Provider 登录始终由成员本机管理。一次性状态测试可省略这两个参数。</p><p className="mt-1"><strong>Codex 凭据：</strong>推荐在成员机 <code className="font-mono">~/.codex/config.toml</code> 设置 <code className="font-mono">cli_auth_credentials_store = &quot;keyring&quot;</code>，让官方客户端使用系统钥匙链；中台不迁移现有会话。</p></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[10px] leading-4 text-sky-900/70">连接器只上报安全快照，不上传密码、Token、Cookie、提示词或代码。</p><button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 rounded-xl bg-sky-700 px-3 py-2 text-xs font-bold text-white">{copied ? <Check size={13} /> : <Clipboard size={13} />}{copied ? '已复制' : '复制配置模板'}</button></div>
    </section>
  );
}

export function CodexAccountsPage() {
  const [accounts, setAccounts] = useState<AccountHubAccount[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [provider, setProvider] = useState<AccountHubProvider>('codex');
  const [label, setLabel] = useState('');
  const [memberId, setMemberId] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [ownerDrafts, setOwnerDrafts] = useState<Record<string, string>>({});
  const [transferAccountId, setTransferAccountId] = useState<string | null>(null);
  const [transferDrafts, setTransferDrafts] = useState<Record<string, string>>({});
  const [connectorAccount, setConnectorAccount] = useState<AccountHubAccount | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const [nextAccounts, nextMembers] = await Promise.all([accountHubApi.listAccounts(), accountHubApi.listTeamMembers()]);
      setAccounts(nextAccounts);
      setMembers(nextMembers);
      setMemberId(current => current || nextMembers[0]?.id || '');
      setError('');
    } catch (loadError) { setError(errorMessage(loadError)); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => void load(true), 10_000); return () => window.clearInterval(timer); }, [load]);

  const enabledMembers = members.filter(member => member.enabled);
  const memberNames = useMemo(() => new Map(members.map(member => [member.id, member.name])), [members]);
  const replaceAccount = (account: AccountHubAccount) => setAccounts(current => current.map(item => item.id === account.id ? account : item));

  const addAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim() || !memberId || adding) return;
    setAdding(true); setError('');
    try {
      const account = await accountHubApi.createAccount({ provider, label: label.trim(), memberId });
      setAccounts(current => [account, ...current]); setConnectorAccount(account); setLabel(''); setShowAdd(false);
      setSuccess('账号已添加并绑定成员，请在成员电脑启动本地连接器');
    } catch (addError) { setError(errorMessage(addError)); }
    finally { setAdding(false); }
  };

  const accountAction = async (account: AccountHubAccount, action: () => Promise<AccountHubAccount>, message: string) => {
    setBusyAccountId(account.id); setError('');
    try { replaceAccount(await action()); setSuccess(message); }
    catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusyAccountId(null); }
  };

  const assignOwner = async (account: AccountHubAccount) => {
    const nextMemberId = ownerDrafts[account.id] || enabledMembers[0]?.id;
    if (!nextMemberId) { setError('请先添加并启用团队成员'); return; }
    await accountAction(account, () => accountHubApi.assignAccountOwner(account.id, nextMemberId), '旧账号已绑定成员归属；绑定后不可更改');
  };

  const reassignOwner = async (account: AccountHubAccount) => {
    const nextMemberId = transferDrafts[account.id] || account.memberId;
    const targetMember = members.find(member => member.id === nextMemberId);
    if (!targetMember?.enabled) { setError('请选择一个已启用的目标成员'); return; }
    if (accounts.some(item => item.id !== account.id && item.provider === account.provider && item.memberId === nextMemberId)) {
      setError(`目标成员 ${targetMember.name} 已有同 Provider 账号槽位`);
      return;
    }
    const switchingSelf = nextMemberId === account.memberId;
    const confirmed = window.confirm(switchingSelf
      ? `确认清除“${account.label}”记录的旧 Provider 身份并切换自己的账号？此操作不会转移或取消 Pro 订阅，也不会携带登录凭据。`
      : `确认把“${account.label}”的中台账号槽位转交给 ${targetMember.name}？此操作不会转移 Pro 订阅或登录凭据。`);
    if (!confirmed) return;
    setBusyAccountId(account.id); setError('');
    try {
      const reassigned = await accountHubApi.reassignAccountOwner(account.id, nextMemberId);
      const nextAccount = { ...reassigned, memberName: reassigned.memberName || targetMember.name };
      replaceAccount(nextAccount);
      setTransferAccountId(null);
      setConnectorAccount(nextAccount);
      setSuccess(switchingSelf
        ? '旧 Provider 身份记录已清除。请在自己的电脑登录另一个账号，再按下方指引启动连接器。'
        : `中台账号槽位已转交给 ${targetMember.name}。请让目标成员在自己的电脑登录自己的账号，再按下方指引启动连接器。`);
      await load(true);
    } catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusyAccountId(null); }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="text-[11px] font-black uppercase tracking-[0.2em] text-accent">Local connector accounts</p><span className="rounded-full bg-sky-50 px-2 py-1 text-[9px] font-black text-sky-700">心跳快照 · 页面约 10 秒刷新</span></div><h1 className="mt-1 text-2xl font-black text-text-primary">AI 账号</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-text-secondary">Codex 与 Claude 凭据留在成员电脑；中台只保存归属、连接器安全快照和协调锁，不提供服务端登录、额度探测或账号轮换。</p></div><div className="flex gap-2"><button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary shadow-sm disabled:opacity-50"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />刷新</button><button type="button" onClick={() => setShowAdd(value => !value)} className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white shadow-sm"><Plus size={14} />添加账号</button></div></header>

      <AccountLoginGuide firstAccount={accounts[0] ?? null} onAddAccount={() => setShowAdd(true)} onOpenConnector={setConnectorAccount} />

      <section className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-emerald-950"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-emerald-700" /><div><p className="text-sm font-black">本机认证，最小化上报</p><p className="mt-1 text-xs leading-5 text-emerald-900/75">成员在自己的电脑登录 Codex 或 Claude；登录态由官方客户端的原生存储或系统钥匙链保持。中台不保存 <code className="font-mono">auth.json</code>、刷新令牌、密码、Token 或 Cookie。本机连接器只上报认证状态、最后心跳、套餐与额度快照；提示词和代码也不会进入中台。页面展示的是最近一次心跳快照，并非 Provider 实时在线证明，请结合“最后心跳”判断新鲜度。</p></div></section>
      <section className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50/75 p-4 text-amber-950"><ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-700" /><div><p className="text-sm font-black">协调锁不是 Provider 的强制锁</p><p className="mt-1 text-xs leading-5 text-amber-900/75">协调锁只能约束通过中台连接器发起的使用，无法阻止成员绕过中台、直接启动官方客户端。团队仍需通过制度约定避免同一账号并发使用。</p></div></section>

      {error && <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-800"><span className="flex items-center gap-2"><AlertCircle size={15} />{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭错误提示"><X size={14} /></button></div>}
      {success && <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800"><span className="flex items-center gap-2"><CheckCircle2 size={15} />{success}</span><button type="button" onClick={() => setSuccess('')} aria-label="关闭成功提示"><X size={14} /></button></div>}

      {showAdd && <form onSubmit={event => void addAccount(event)} className="grid gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm lg:grid-cols-[150px_1fr_1fr_auto] lg:items-end"><label className="grid gap-1.5 text-xs font-bold text-text-secondary">Provider<select value={provider} onChange={event => setProvider(event.target.value as AccountHubProvider)} className="ui-field !rounded-xl !bg-surface-2"><option value="codex">Codex</option><option value="claude">Claude</option></select></label><label className="grid gap-1.5 text-xs font-bold text-text-secondary">账号备注<input value={label} onChange={event => setLabel(event.target.value)} required maxLength={80} placeholder="例如：研发组 Codex" className="ui-field !rounded-xl !bg-surface-2" /></label><label className="grid gap-1.5 text-xs font-bold text-text-secondary">绑定成员<select value={memberId} onChange={event => setMemberId(event.target.value)} required className="ui-field !rounded-xl !bg-surface-2"><option value="">请选择成员</option>{enabledMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><button type="submit" disabled={adding || !label.trim() || !memberId} className="inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl bg-text-primary px-4 text-xs font-bold text-white disabled:opacity-50">{adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}添加并绑定</button>{enabledMembers.length === 0 && <p className="text-xs text-amber-700 lg:col-span-4">请先在“团队用量”页签添加并启用成员，再绑定账号。</p>}</form>}
      {connectorAccount && <ConnectorGuide account={connectorAccount} onClose={() => setConnectorAccount(null)} />}

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5"><div><h2 className="text-sm font-black text-text-primary">账号列表</h2><p className="mt-0.5 text-[11px] text-text-muted">{accounts.length} 个账号 · 本机连接器模式</p></div><Laptop size={18} className="text-text-muted" /></div>
        {loading ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-text-muted"><Loader2 size={18} className="animate-spin" />正在读取账号快照</div> : accounts.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><Link2 size={30} className="text-text-muted" /><p className="mt-3 text-sm font-black text-text-primary">还没有本机账号连接</p><p className="mt-1 max-w-md text-xs leading-5 text-text-muted">先创建账号并绑定唯一成员，再在成员电脑运行本地连接器。</p><button type="button" onClick={() => setShowAdd(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white"><Plus size={13} />添加第一个账号</button></div> : <div className="divide-y divide-border">
          {accounts.map(account => {
            const busy = busyAccountId === account.id;
            const legacyUnassigned = account.memberId.startsWith('legacy_unassigned:');
            const ownerName = legacyUnassigned ? '旧账号 · 待绑定' : account.memberName || memberNames.get(account.memberId) || '未知成员';
            const holderName = account.holderMemberId ? memberNames.get(account.holderMemberId) || account.holderMemberId : null;
            const localState = account.localState;
            const authMeta = localState ? AUTH_STATUS[localState.state] : null;
            const plan = localState?.plan || account.plan;
            const transferMemberId = transferDrafts[account.id] || account.memberId;
            const transferTargetHasProvider = accounts.some(item => item.id !== account.id && item.provider === account.provider && item.memberId === transferMemberId);
            return <article key={account.id} className="p-4 sm:p-5">
              {account.legacyManagedProfilePresent && <div role="alert" className="mb-4 flex gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[11px] leading-5 text-red-800"><ShieldAlert size={16} className="mt-0.5 shrink-0" /><div><p className="font-black">发现旧版服务端托管凭据目录</p><p>请由运维人员按迁移手册人工核验并清理。管理台不会自动删除，以免误删仍需保留的账号数据。</p></div></div>}
              <div className="grid gap-4 xl:grid-cols-[minmax(220px,.9fr)_minmax(240px,1fr)_minmax(300px,1.1fr)] xl:items-start">
                <div className="flex min-w-0 gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-black text-white ${account.provider === 'codex' ? 'bg-slate-900' : 'bg-orange-600'}`}>{account.provider === 'codex' ? 'C' : 'A'}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-black text-text-primary">{account.label}</h3><StatusBadge status={account.status} /></div><p className="mt-1 text-[10px] text-text-muted">{PROVIDER_LABELS[account.provider]} · {plan || '套餐暂未上报'}</p>{account.statusDetail && <p className="mt-1 text-[10px] text-amber-700">{account.statusDetail}</p>}</div></div>
                <div className="rounded-xl bg-surface-2 p-3 text-[10px]"><p className="flex items-center gap-1 font-black text-text-secondary"><UserRound size={11} />账号归属</p><p className="mt-1 text-xs font-bold text-text-primary">{ownerName}</p>{legacyUnassigned && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><select aria-label={`为 ${account.label} 选择归属成员`} value={ownerDrafts[account.id] || enabledMembers[0]?.id || ''} onChange={event => setOwnerDrafts(current => ({ ...current, [account.id]: event.target.value }))} className="ui-field !h-8 !rounded-lg !bg-white !px-2 !text-[10px]"><option value="">请选择成员</option>{enabledMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select><button type="button" onClick={() => void assignOwner(account)} disabled={busy || enabledMembers.length === 0} className="rounded-lg bg-text-primary px-2.5 py-1.5 text-[9px] font-bold text-white disabled:opacity-40">绑定现有账号归属</button></div>}</div>
                <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3"><div className="flex items-start justify-between gap-2"><div><p className="inline-flex items-center gap-1 text-[10px] font-black text-text-secondary"><Laptop size={11} />成员本机安全快照</p><p className={`mt-1 text-xs font-black ${authMeta?.tone || 'text-text-muted'}`}>{authMeta?.label || '等待连接器首次心跳'}</p></div>{localState && <span className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-sky-700">{localState.deviceLabel || '未命名设备'}</span>}</div><p className="mt-2 text-[9px] text-text-muted">最后心跳：{formatTime(localState?.reportedAt ?? null)}{localState?.email ? ` · ${localState.email}` : ''}</p></div>
              </div>
              {!account.transferEligible && account.transferBlockedReasons.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[10px] leading-5 text-amber-900"><p className="flex items-center gap-1.5 font-black"><ShieldAlert size={12} />暂不可切换或转交</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{account.transferBlockedReasons.map((reason, index) => <li key={`${reason.code}-${index}`}>{transferBlockLabel(reason.code, reason.message)}</li>)}</ul></div>}
              {account.transferEligible && transferAccountId === account.id && <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4"><div className="flex gap-2.5"><ArrowRightLeft size={16} className="mt-0.5 shrink-0 text-indigo-700" /><div><p className="text-xs font-black text-indigo-950">切换自己的账号 / 转交账号席位</p><p className="mt-1 text-[10px] leading-5 text-indigo-900/75">这里只变更中台账号槽位与安全快照，不会转移、取消或共享 Pro 订阅，也不会携带旧登录态或登录凭据。目标成员必须在自己的电脑登录自己的账号。</p></div></div><div className="mt-3 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_auto]"><label className="grid gap-1 text-[10px] font-bold text-text-secondary">目标成员<select aria-label={`为 ${account.label} 选择切换或转交成员`} value={transferMemberId} onChange={event => setTransferDrafts(current => ({ ...current, [account.id]: event.target.value }))} className="ui-field !h-9 !rounded-lg !bg-white !px-2 !text-[10px]">{enabledMembers.map(member => { const alreadyHasProvider = accounts.some(item => item.id !== account.id && item.provider === account.provider && item.memberId === member.id); return <option key={member.id} value={member.id} disabled={alreadyHasProvider}>{member.name}{member.id === account.memberId ? '（切换自己的账号）' : alreadyHasProvider ? `（已有 ${PROVIDER_LABELS[account.provider]} 槽位）` : '（转交中台槽位）'}</option>; })}</select></label><button type="button" onClick={() => void reassignOwner(account)} disabled={busy || enabledMembers.length === 0 || transferTargetHasProvider} className="self-end rounded-lg bg-indigo-700 px-3 py-2.5 text-[10px] font-bold text-white disabled:opacity-40">{busy ? '正在处理…' : transferMemberId === account.memberId ? '确认切换自己的账号' : '确认转交账号席位'}</button></div>{transferTargetHasProvider && <p className="mt-2 text-[10px] font-bold text-amber-800">目标成员已有同 Provider 账号槽位，不能重复转交。</p>}<p className="mt-2 text-[9px] leading-4 text-indigo-900/70">选择当前成员会清除中台记录的旧 Provider 身份，随后可在本机登录自己的另一个账号；选择其他成员只转交中台账号槽位。登录态仍由各成员本机官方 Codex / Claude 原生存储或钥匙链保持。</p></div>}
              <div className="mt-4"><UsageSnapshot usage={localState?.usage ?? null} /></div>
              <div className={`mt-4 rounded-xl border p-3 ${account.holderMemberId ? 'border-violet-200 bg-violet-50/60' : 'border-emerald-200 bg-emerald-50/60'}`}><div><p className="inline-flex items-center gap-1 text-[10px] font-black text-text-secondary"><LockKeyhole size={11} />中台协调锁</p><p className="mt-1 text-xs font-black text-text-primary">{account.holderMemberId ? `${holderName} · ${account.deviceLabel || '未命名设备'}` : '当前无人占用'}</p></div><p className="mt-2 text-[9px] text-text-muted">{account.holderMemberId ? `取得：${formatTime(account.acquiredAt)} · 续租：${formatTime(account.renewedAt)} · 到期：${formatTime(account.expiresAt)}` : '本机连接器使用前会获取协调锁；直接启动官方客户端仍可绕过此锁。'}</p></div>
              <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => setConnectorAccount(account)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[10px] font-bold text-text-secondary"><Link2 size={11} />查看连接指引</button>{account.transferEligible && <button type="button" onClick={() => { setTransferAccountId(current => current === account.id ? null : account.id); setTransferDrafts(current => ({ ...current, [account.id]: current[account.id] || account.memberId })); }} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[10px] font-bold text-indigo-700"><ArrowRightLeft size={11} />切换自己的账号 / 转交账号席位</button>}<span className="grow" /><button type="button" onClick={() => void accountAction(account, () => accountHubApi.updateAccount(account.id, !account.enabled), account.enabled ? '账号已停用' : '账号已启用')} disabled={busy || Boolean(account.holderMemberId)} className="rounded-lg border border-border px-3 py-2 text-[10px] font-bold text-text-secondary disabled:opacity-40">{account.enabled ? '停用账号' : '启用账号'}</button></div>
            </article>;
          })}
        </div>}
      </section>
      <section className="flex gap-3 rounded-2xl border border-border bg-white p-4 text-text-secondary shadow-sm"><Clock3 size={18} className="mt-0.5 shrink-0 text-text-muted" /><div><p className="text-xs font-black text-text-primary">协调锁由本机连接器维护</p><p className="mt-1 text-[11px] leading-5">连接器负责获取、续租与仅本地释放；停止连接器后协调锁会自然到期。仅本地释放不会修改成员电脑的 Provider 登录状态，管理网页也不会持有成员采集令牌。</p></div></section>
    </div>
  );
}

export default CodexAccountsPage;
