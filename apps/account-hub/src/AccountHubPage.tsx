import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Database,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import {
  accountHubApi,
  type TeamMember,
  type TeamUsageMember,
  type TeamUsageRange,
  type TeamUsageSummary,
} from './accountHubApi';
import CodexAccountsPage from './CodexAccountsPage';

const RANGE_LABELS: Record<TeamUsageRange, string> = {
  '1d': '最近 24 小时',
  '7d': '最近 7 天',
  '30d': '最近 30 天',
};

function compactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

function exactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatTime(value: string | null): string {
  if (!value) return '尚未上报';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作未完成，请重试';
}

function tokenConfig(token: string): string {
  const endpoint = `${window.location.origin}/api/overseas/account-hub/telemetry/v1/logs`;
  return `[otel]
environment = "prod"
log_user_prompt = false

[otel.exporter."otlp-http"]
endpoint = "${endpoint}"
protocol = "json"

[otel.exporter."otlp-http".headers]
Authorization = "Bearer ${token}"`;
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <article className="rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold text-text-muted">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-text-primary" title={exactNumber(value)}>{compactNumber(value)}</p>
          <p className="mt-1 text-[10px] text-text-muted">{detail}</p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      </div>
    </article>
  );
}

function MemberStatus({ member }: { member: TeamUsageMember }) {
  if (!member.enabled) return <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">已停用</span>;
  if (member.online) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />正在同步</span>;
  return <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">等待同步</span>;
}

function OnboardingPanel({
  member,
  telemetryToken,
  connectorToken,
  onClose,
}: {
  member: TeamMember;
  telemetryToken: string;
  connectorToken: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const config = tokenConfig(telemetryToken);
  const copy = async () => {
    await navigator.clipboard.writeText(config);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-700 text-white"><KeyRound size={18} /></span>
          <div>
            <h2 className="text-sm font-black text-sky-950">为 {member.name} 配置 Codex 遥测</h2>
            <p className="mt-1 text-xs leading-5 text-sky-900/75">两个令牌只显示这一次且权限分离：遥测令牌只用于 OTel，连接器令牌只用于账号状态与协调锁。</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-sky-800 hover:bg-white" aria-label="关闭接入向导"><X size={16} /></button>
      </div>
      <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950 p-4 text-[11px] leading-5 text-slate-100">{config}</pre>
      <div className="mt-3 rounded-xl border border-sky-200 bg-white/75 p-3 text-[10px] leading-5 text-sky-950"><p className="font-black">本机连接器令牌（填入账号页生成的 connector.json）</p><code className="mt-1 block break-all font-mono">{connectorToken}</code><p className="mt-1 text-sky-900/70">不要把此令牌填入 OTel 配置，也不要通过聊天发送。</p></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[10px] leading-4 text-sky-900/70">若页面地址是 127.0.0.1，请先替换为成员电脑可访问的内网或 HTTPS 地址。不要覆盖成员已有的其他 Codex 配置。</p>
        <button type="button" onClick={() => void copy()} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-sky-700 px-3 py-2 text-xs font-bold text-white">
          {copied ? <Check size={13} /> : <Clipboard size={13} />} {copied ? '已复制' : '复制配置'}
        </button>
      </div>
    </section>
  );
}

function DailyChart({ summary }: { summary: TeamUsageSummary }) {
  const maximum = Math.max(1, ...summary.timeline.map(item => item.totalTokens));
  if (summary.timeline.length === 0) {
    return <div className="flex h-44 items-center justify-center text-xs text-text-muted">成员接入后，这里会出现每日 Token 趋势</div>;
  }
  return (
    <div className="mt-4 flex h-44 items-end gap-2 overflow-x-auto border-b border-border px-1 pb-7">
      {summary.timeline.map(item => (
        <div key={item.date} className="group relative flex h-full min-w-10 flex-1 items-end justify-center" title={`${item.date} · ${exactNumber(item.totalTokens)} Tokens`}>
          <div className="w-full max-w-12 overflow-hidden rounded-t-lg bg-emerald-100" style={{ height: `${Math.max(5, (item.totalTokens / maximum) * 100)}%` }}>
            <div className="h-full w-full bg-emerald-600/75" />
          </div>
          <span className="absolute -bottom-6 whitespace-nowrap text-[9px] text-text-muted">{item.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function TeamUsagePage() {
  const [range, setRange] = useState<TeamUsageRange>('7d');
  const [summary, setSummary] = useState<TeamUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<{
    member: TeamMember;
    telemetryToken: string;
    connectorToken: string;
  } | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      setSummary(await accountHubApi.teamUsage(range));
      setError('');
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const maximumMemberTokens = useMemo(
    () => Math.max(1, ...(summary?.members.map(member => member.totalTokens) ?? [])),
    [summary],
  );

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!memberName.trim() || adding) return;
    setAdding(true);
    setError('');
    try {
      const created = await accountHubApi.createTeamMember(memberName.trim());
      setOnboarding({
        member: created.member,
        telemetryToken: created.ingestToken,
        connectorToken: created.connectorToken,
      });
      setMemberName('');
      setShowAdd(false);
      setSuccess('成员已创建，请在该成员电脑上完成一次遥测配置');
      await load(true);
    } catch (addError) {
      setError(errorMessage(addError));
    } finally {
      setAdding(false);
    }
  };

  const toggleMember = async (member: TeamUsageMember) => {
    setBusyMemberId(member.id);
    setError('');
    try {
      await accountHubApi.updateTeamMember(member.id, !member.enabled);
      setSuccess(member.enabled ? '已停止接收该成员的遥测' : '已恢复接收该成员的遥测');
      await load(true);
    } catch (toggleError) {
      setError(errorMessage(toggleError));
    } finally {
      setBusyMemberId(null);
    }
  };

  const rotateToken = async (member: TeamUsageMember) => {
    if (!window.confirm(`重新生成“${member.name}”的采集令牌？旧令牌会立即失效。`)) return;
    setBusyMemberId(member.id);
    setError('');
    try {
      const rotated = await accountHubApi.rotateTeamMemberToken(member.id);
      setOnboarding({
        member: rotated.member,
        telemetryToken: rotated.ingestToken,
        connectorToken: rotated.connectorToken,
      });
      setSuccess('遥测与连接器令牌已同时更新，请同步修改该成员的本机配置');
    } catch (rotateError) {
      setError(errorMessage(rotateError));
    } finally {
      setBusyMemberId(null);
    }
  };

  const totals = summary?.totals;
  const cacheRate = totals?.inputTokens ? Math.round((totals.cachedInputTokens / totals.inputTokens) * 100) : 0;

  return (
    <div>
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-accent">Codex Team Console</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-black text-emerald-700"><Activity size={10} />约实时 · 5 秒刷新</span>
            </div>
            <h1 className="mt-1 text-2xl font-black text-text-primary">团队 Codex 用量管理台</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-text-secondary">每位成员继续使用自己的 Pro 账号和 Codex 桌面端；这里只汇总脱敏后的 Token 遥测，不托管登录态、不共享账号、不做额度轮换。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-xl border border-border bg-white p-1 shadow-sm">
              {(Object.keys(RANGE_LABELS) as TeamUsageRange[]).map(value => (
                <button key={value} type="button" onClick={() => setRange(value)} className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${range === value ? 'bg-text-primary text-white' : 'text-text-muted hover:text-text-primary'}`}>{value === '1d' ? '24H' : value.toUpperCase()}</button>
              ))}
            </div>
            <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary shadow-sm disabled:opacity-50">
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> 刷新
            </button>
            <button type="button" onClick={() => setShowAdd(value => !value)} className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white shadow-sm">
              <Plus size={14} /> 添加成员
            </button>
          </div>
        </header>

        <section className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50/75 p-4 text-amber-950">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-black">合规模式：一人一号，只观测不代理</p>
            <p className="mt-1 text-xs leading-5 text-amber-900/75">本页 Token 数据来自 Codex 官方 OTel 的 <code className="font-mono">response.completed</code> 事件，批量上报后更新，并非 OpenAI 最终账单。Pro 订阅费、额度百分比和 Token 折算成本不能混为实际支出。</p>
          </div>
        </section>

        {error && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-800">
            <span className="flex items-center gap-2"><AlertCircle size={15} />{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="关闭错误提示"><X size={14} /></button>
          </div>
        )}
        {success && (
          <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
            <span className="flex items-center gap-2"><CheckCircle2 size={15} />{success}</span>
            <button type="button" onClick={() => setSuccess('')} aria-label="关闭成功提示"><X size={14} /></button>
          </div>
        )}

        {showAdd && (
          <form onSubmit={event => void addMember(event)} className="grid gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="grid gap-1.5 text-xs font-bold text-text-secondary">
              成员姓名或内部标识
              <input value={memberName} onChange={event => setMemberName(event.target.value)} maxLength={80} required autoFocus placeholder="例如：吴小姐 · 产品研发" className="ui-field !rounded-xl !bg-surface-2" />
            </label>
            <button type="submit" disabled={adding || !memberName.trim()} className="inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl bg-text-primary px-4 text-xs font-bold text-white disabled:opacity-50">
              {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 创建并生成配置
            </button>
          </form>
        )}

        {onboarding && <OnboardingPanel member={onboarding.member} telemetryToken={onboarding.telemetryToken} connectorToken={onboarding.connectorToken} onClose={() => setOnboarding(null)} />}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label={`${RANGE_LABELS[range]} Token 支出`} value={totals?.totalTokens ?? 0} detail="输入与输出 Token 合计（遥测口径）" icon={<Database size={17} />} tone="bg-slate-100 text-slate-700" />
          <MetricCard label="输入 Token" value={totals?.inputTokens ?? 0} detail="其中可能包含缓存命中 Token" icon={<ArrowDownToLine size={17} />} tone="bg-sky-50 text-sky-700" />
          <MetricCard label="缓存输入 Token" value={totals?.cachedInputTokens ?? 0} detail={`占输入 Token ${cacheRate}%`} icon={<RefreshCw size={17} />} tone="bg-violet-50 text-violet-700" />
          <MetricCard label="输出 Token" value={totals?.outputTokens ?? 0} detail={`含推理 Token ${compactNumber(totals?.reasoningOutputTokens ?? 0)}`} icon={<ArrowUpFromLine size={17} />} tone="bg-emerald-50 text-emerald-700" />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.6fr)]">
          <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
              <div>
                <h2 className="text-sm font-black text-text-primary">成员用量</h2>
                <p className="mt-0.5 text-[11px] text-text-muted">{summary?.members.length ?? 0} 位成员 · {summary?.members.filter(member => member.online).length ?? 0} 台设备正在同步</p>
              </div>
              <UsersRound size={19} className="text-text-muted" />
            </div>
            {loading ? (
              <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-text-muted"><Loader2 size={18} className="animate-spin" /> 正在读取遥测</div>
            ) : !summary?.members.length ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                <UserRound size={30} className="text-text-muted" />
                <p className="mt-3 text-sm font-black text-text-primary">还没有团队成员</p>
                <p className="mt-1 max-w-md text-xs leading-5 text-text-muted">添加一位成员，把生成的 OTel 配置合并到该成员电脑的 Codex 配置中。无需更改登录账号或日常开发方式。</p>
                <button type="button" onClick={() => setShowAdd(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white"><Plus size={13} /> 添加第一位成员</button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {summary.members.map(member => {
                  const busy = busyMemberId === member.id;
                  const width = `${Math.max(member.totalTokens ? 3 : 0, (member.totalTokens / maximumMemberTokens) * 100)}%`;
                  return (
                    <article key={member.id} className="p-4 sm:p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-black text-white">{member.name.slice(0, 1)}</span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-black text-text-primary">{member.name}</h3>
                              <MemberStatus member={member} />
                            </div>
                            <p className="mt-1 text-[10px] text-text-muted">最近同步：{formatTime(member.lastSeenAt)}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button type="button" onClick={() => void rotateToken(member)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold text-text-secondary disabled:opacity-50"><RotateCw size={11} /> 更新配置</button>
                          <button type="button" onClick={() => void toggleMember(member)} disabled={busy} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold text-text-secondary disabled:opacity-50">{member.enabled ? '停用采集' : '启用采集'}</button>
                        </div>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width }} /></div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-[10px] sm:grid-cols-4">
                        <p><span className="block text-text-muted">总 Token</span><strong className="mt-0.5 block text-xs text-text-primary">{compactNumber(member.totalTokens)}</strong></p>
                        <p><span className="block text-text-muted">输入</span><strong className="mt-0.5 block text-xs text-text-primary">{compactNumber(member.inputTokens)}</strong></p>
                        <p><span className="block text-text-muted">缓存输入</span><strong className="mt-0.5 block text-xs text-text-primary">{compactNumber(member.cachedInputTokens)}</strong></p>
                        <p><span className="block text-text-muted">输出</span><strong className="mt-0.5 block text-xs text-text-primary">{compactNumber(member.outputTokens)}</strong></p>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black text-text-primary">每日趋势</h2>
                <p className="mt-0.5 text-[11px] text-text-muted">{RANGE_LABELS[range]}</p>
              </div>
              <Activity size={18} className="text-emerald-700" />
            </div>
            {summary && <DailyChart summary={summary} />}
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-surface-2 p-3 text-[10px]">
              <p><span className="block text-text-muted">完成请求</span><strong className="mt-1 block text-sm text-text-primary">{exactNumber(totals?.eventCount ?? 0)}</strong></p>
              <p><span className="block text-text-muted">最后刷新</span><strong className="mt-1 block text-xs text-text-primary">{formatTime(summary?.generatedAt ?? null)}</strong></p>
            </div>
          </section>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-sm font-black text-text-primary">最近 Token 事件</h2>
              <p className="mt-0.5 text-[11px] text-text-muted">只显示统计字段；不会保存提示词、代码或工具输出</p>
            </div>
            <Clock3 size={18} className="text-text-muted" />
          </div>
          {!summary?.recent.length ? (
            <div className="flex min-h-32 items-center justify-center text-xs text-text-muted">等待 Codex 完成一次模型请求并批量上报</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[11px]">
                <thead className="bg-surface-2 text-text-muted"><tr><th className="px-4 py-2.5 font-bold sm:px-5">成员</th><th className="px-4 py-2.5 font-bold">时间</th><th className="px-4 py-2.5 font-bold">模型</th><th className="px-4 py-2.5 text-right font-bold">输入</th><th className="px-4 py-2.5 text-right font-bold">缓存</th><th className="px-4 py-2.5 text-right font-bold">输出</th><th className="px-4 py-2.5 text-right font-bold sm:px-5">总计</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {summary.recent.map(event => {
                    const member = summary.members.find(item => item.id === event.memberId);
                    return <tr key={event.id}><td className="px-4 py-3 font-bold text-text-primary sm:px-5">{member?.name || '未知成员'}</td><td className="px-4 py-3 text-text-muted">{formatTime(event.eventAt)}</td><td className="px-4 py-3 font-mono text-text-secondary">{event.model || '未识别'}</td><td className="px-4 py-3 text-right text-text-secondary">{exactNumber(event.inputTokens)}</td><td className="px-4 py-3 text-right text-violet-700">{exactNumber(event.cachedInputTokens)}</td><td className="px-4 py-3 text-right text-emerald-700">{exactNumber(event.outputTokens)}</td><td className="px-4 py-3 text-right font-black text-text-primary sm:px-5">{exactNumber(event.totalTokens)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function AccountHubPage() {
  const [activeTab, setActiveTab] = useState<'usage' | 'accounts'>('usage');
  return (
    <main className="min-h-full bg-surface-2 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <nav aria-label="账号中心功能" className="mb-5 flex w-fit rounded-xl border border-border bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab('usage')}
            aria-current={activeTab === 'usage' ? 'page' : undefined}
            className={`rounded-lg px-4 py-2 text-xs font-black transition ${activeTab === 'usage' ? 'bg-[#123e31] text-white' : 'text-text-muted hover:text-text-primary'}`}
          >
            团队用量
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('accounts')}
            aria-current={activeTab === 'accounts' ? 'page' : undefined}
            className={`rounded-lg px-4 py-2 text-xs font-black transition ${activeTab === 'accounts' ? 'bg-[#123e31] text-white' : 'text-text-muted hover:text-text-primary'}`}
          >
            AI 账号
          </button>
        </nav>
        {activeTab === 'usage' ? <TeamUsagePage /> : <CodexAccountsPage />}
      </div>
    </main>
  );
}

export default AccountHubPage;
