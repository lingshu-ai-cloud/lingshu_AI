import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, KeyRound, Loader2, LogOut, ServerCog, ShieldCheck } from 'lucide-react';
import AccountHubPage from './AccountHubPage';
import { authApi, getToken, setToken, type AuthSession } from '../../../src/lib/auth';

function canOperateAccountHub(session: AuthSession | null): session is AuthSession {
  return Boolean(session && !session.supportAccess && session.platformAdmin === true);
}

function LoadingScreen() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-6">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-white px-5 py-4 text-sm font-semibold text-text-secondary shadow-sm">
        <Loader2 size={18} className="animate-spin text-accent" />
        正在核验管理员身份…
      </div>
    </main>
  );
}

function LoginScreen({ initialError = '', onAuthed }: { initialError?: string; onAuthed: (session: AuthSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setError(initialError); }, [initialError]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await authApi.login(email.trim(), password);
      setToken(result.token);
      const verified = await authApi.me();
      if (!canOperateAccountHub(verified)) {
        authApi.logout();
        throw new Error('该账号不是平台管理员，无法进入团队管理台');
      }
      onAuthed(verified);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-5 py-12">
      <div aria-hidden="true" className="absolute left-[-7rem] top-[-8rem] h-80 w-80 rounded-full border-[64px] border-emerald-900/[0.035]" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-[0_32px_90px_rgba(22,61,49,0.14)] backdrop-blur md:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden min-h-[590px] overflow-hidden bg-[#123e31] p-12 text-white md:flex md:flex-col md:justify-between">
          <div aria-hidden="true" className="absolute -right-20 -top-20 h-72 w-72 rounded-full border-[54px] border-white/[0.045]" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold tracking-wide text-emerald-50">
              <ServerCog size={14} /> 独立运维应用
            </div>
            <h1 className="mt-8 max-w-md text-4xl font-black leading-[1.12] tracking-[-0.04em]">
              团队 Codex 管理台
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-emerald-50/75">
              汇总脱敏 Token 遥测，管理账号归属与设备占用协调，同时保留每位成员的本地开发工作流。
            </p>
          </div>
          <div className="relative space-y-4 text-sm text-emerald-50/80">
            <div className="flex items-center gap-3"><ShieldCheck size={18} /> 只允许平台管理员访问</div>
            <div className="flex items-center gap-3"><KeyRound size={18} /> 成员本机登录，不收集密码，不自动轮换账号</div>
          </div>
        </section>

        <section className="flex min-h-[590px] items-center p-7 sm:p-12">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-9 flex items-center gap-3 md:hidden">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#123e31] text-white"><ServerCog size={21} /></span>
              <div>
                <p className="text-lg font-black text-text-primary">团队 Codex 管理台</p>
                <p className="text-xs text-text-muted">独立运维应用</p>
              </div>
            </div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">Host operations</p>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-text-primary">平台管理员登录</h2>
            <p className="mt-2 text-sm leading-6 text-text-muted">使用灵枢平台管理员账号验证身份。这里不开放注册。</p>

            {error && (
              <div role="alert" className="mt-6 flex gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={submit} className="mt-7 space-y-5">
              <label className="block">
                <span className="mb-2 block text-xs font-bold text-text-secondary">管理员邮箱</span>
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  placeholder="admin@example.com"
                  className="h-12 w-full border px-4 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-bold text-text-secondary">密码</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="输入登录密码"
                  className="h-12 w-full border px-4 text-sm"
                />
              </label>
              <button type="submit" disabled={submitting} className="btn-primary flex h-12 w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60">
                {submitting ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />}
                {submitting ? '正在验证…' : '进入团队管理台'}
              </button>
            </form>

            <p className="mt-7 text-xs leading-5 text-text-muted">
              用量遥测不包含提示词或代码；账号由成员在本机官方客户端登录，中台不收集密码、Token 或浏览器 Cookie。
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [restoreError, setRestoreError] = useState('');

  useEffect(() => {
    let active = true;
    const restore = async () => {
      if (!getToken()) {
        if (active) setLoading(false);
        return;
      }
      try {
        const restored = await authApi.me();
        if (!active) return;
        if (canOperateAccountHub(restored)) {
          setSession(restored);
        } else if (restored) {
          authApi.logout();
          setRestoreError('该账号不是平台管理员，无法进入团队管理台');
        }
      } catch {
        if (active) setRestoreError('暂时无法连接认证服务，请稍后重试');
      } finally {
        if (active) setLoading(false);
      }
    };
    void restore();
    return () => { active = false; };
  }, []);

  if (loading) return <LoadingScreen />;
  if (!session) return <LoginScreen initialError={restoreError} onAuthed={setSession} />;

  const logout = () => {
    authApi.logout();
    setSession(null);
    setRestoreError('');
  };

  return (
    <div className="min-h-[100dvh] bg-[#f6f8f5]">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#123e31] text-white"><ServerCog size={18} /></span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-text-primary">团队 Codex 管理台</p>
              <p className="truncate text-[11px] text-text-muted">独立运维应用</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-64 truncate text-xs text-text-muted sm:block">{session.user.email}</span>
            <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:border-border-bright hover:text-text-primary">
              <LogOut size={14} /> 退出
            </button>
          </div>
        </div>
      </header>
      <AccountHubPage />
    </div>
  );
}
