import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Building2, Eye, EyeOff, Loader2, Lock, Mail, Ticket } from 'lucide-react';
import { authApi, setToken, type AuthSession } from '../lib/auth';

const initialInviteCode = () => new URLSearchParams(window.location.search).get('invite')?.trim() || '';
const initialCompanyName = () => new URLSearchParams(window.location.search).get('company')?.trim() || '';

export default function AuthScreen({ onAuthed }: { onAuthed: (s: AuthSession) => void }) {
  const linkedInviteCode = initialInviteCode();
  const linkedCompanyName = initialCompanyName();
  const [mode, setMode] = useState<'login' | 'register'>(() => linkedInviteCode ? 'register' : 'login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [registrationCompany, setRegistrationCompany] = useState(linkedCompanyName);
  const [registrationCompanyLocked, setRegistrationCompanyLocked] = useState(Boolean(linkedCompanyName));
  const [registrationEmail, setRegistrationEmail] = useState('');
  const [registrationPassword, setRegistrationPassword] = useState('');
  const [showRegistrationPassword, setShowRegistrationPassword] = useState(false);
  const [registrationFieldsUnlocked, setRegistrationFieldsUnlocked] = useState(false);
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'register') return;
    const code = inviteCode.trim();
    if (!code) {
      setRegistrationCompany(linkedCompanyName);
      setRegistrationCompanyLocked(Boolean(linkedCompanyName));
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void authApi.invite(code)
        .then(result => {
          if (cancelled) return;
          setRegistrationCompany(result.companyName || linkedCompanyName);
          setRegistrationCompanyLocked(Boolean(result.companyName || linkedCompanyName));
          setError(result.valid ? null : '邀请码已使用，请联系管理员重新生成');
        })
        .catch(err => {
          if (cancelled) return;
          setRegistrationCompany(linkedCompanyName);
          setRegistrationCompanyLocked(Boolean(linkedCompanyName));
          setError(err instanceof Error ? err.message : '邀请码无效或已使用');
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inviteCode, linkedCompanyName, mode]);

  const submit = async () => {
    setError(null);
    const email = mode === 'register' ? registrationEmail.trim() : loginEmail.trim();
    const password = mode === 'register' ? registrationPassword : loginPassword.trim();
    if (mode === 'login' && password !== loginPassword) setLoginPassword(password);
    if (!email || !password) { setError('请填写邮箱和密码'); return; }
    if (password.length < 8) { setError('密码至少 8 位'); return; }
    if (mode === 'register' && !inviteCode.trim()) { setError('请输入管理员提供的邀请码'); return; }
    if (mode === 'register' && !registrationConsent) { setError('请先阅读并同意服务条款和隐私政策'); return; }
    setLoading(true);
    try {
      const r = mode === 'register'
        ? await authApi.register(email, password, inviteCode)
        : await authApi.login(email, password);
      setToken(r.token);
      onAuthed({ user: r.user, tenant: r.tenant, demo: r.demo });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '请求失败');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setError(null);
    if (nextMode === 'register') {
      setRegistrationCompany(linkedCompanyName);
      setRegistrationCompanyLocked(Boolean(linkedCompanyName));
      setRegistrationEmail('');
      setRegistrationPassword('');
      setRegistrationFieldsUnlocked(false);
      setRegistrationConsent(false);
    }
  };

  const inputCls = 'auth-field w-full pl-11 pr-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-[3px] focus:ring-accent/10';

  return (
    <main className="auth-shell">
      <section className="auth-visual flex flex-col p-7 text-white sm:p-10 lg:p-12" aria-label="灵枢品牌介绍">
        <div className="flex items-center gap-3 self-start rounded-2xl border border-white/45 bg-white/85 px-3 py-2 text-text-primary shadow-[0_12px_32px_rgba(23,61,49,.08)] backdrop-blur-sm">
          <span className="brand-logo-frame h-9 w-9 border-white/60 bg-white/90">
            <img src="/brand-logo.png" alt="" className="h-7 w-7 object-contain" />
          </span>
          <span className="pr-1 text-[15px] font-bold tracking-[-.02em]">灵枢 AI</span>
        </div>

      </section>

      <section className="auth-panel">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .34, ease: 'easeOut' }}
          className="auth-form-card"
        >
          <div className="auth-intro mb-8">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-accent">Lingshu workspace</p>
            <h1 aria-live="polite" className="text-[30px] font-semibold leading-tight tracking-[-.035em] text-text-primary">
              {mode === 'register' ? '创建你的工作账号' : '欢迎回来'}
            </h1>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              {mode === 'register'
                ? '使用管理员提供的邀请码，加入企业工作空间。'
                : '登录后继续处理今天的内容、客户与增长任务。'}
            </p>
          </div>

          <div role="group" aria-label="认证方式" className="mb-7 grid grid-cols-2 rounded-xl border border-border bg-surface-2 p-1">
            {[
              { id: 'login' as const, label: '账号登录' },
              { id: 'register' as const, label: '注册账号' },
            ].map(item => (
              <button
                key={item.id}
                type="button"
                aria-pressed={mode === item.id}
                onClick={() => switchMode(item.id)}
                className={`min-h-10 rounded-lg px-3 py-2 text-sm font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent/25 ${
                  mode === item.id
                    ? 'bg-white text-text-primary shadow-[0_2px_8px_rgba(23,61,49,.07)]'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {mode === 'register' ? (
            <form
              key={`registration-${linkedInviteCode || 'manual'}`}
              autoComplete="off"
              onSubmit={event => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-text-secondary">企业名称</span>
                  <span className="relative block">
                  <Building2 size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    name="customer-registration-company"
                    autoComplete="off"
                    readOnly
                    value={registrationCompany}
                    placeholder="公司名称由管理员填写"
                    className={`${inputCls} ${registrationCompanyLocked ? 'cursor-default' : ''}`}
                  />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-text-secondary">注册邮箱</span>
                  <span className="relative block">
                  <Mail size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="email"
                    name="customer-registration-email"
                    autoComplete="off"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    readOnly={!registrationFieldsUnlocked}
                    value={registrationEmail}
                    onFocus={() => setRegistrationFieldsUnlocked(true)}
                    onChange={event => setRegistrationEmail(event.target.value)}
                    placeholder="请客户填写注册邮箱"
                    className={inputCls}
                  />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-text-secondary">设置密码</span>
                  <span className="relative block">
                  <Lock size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type={showRegistrationPassword ? 'text' : 'password'}
                    name="customer-registration-new-password"
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    readOnly={!registrationFieldsUnlocked}
                    value={registrationPassword}
                    onFocus={() => setRegistrationFieldsUnlocked(true)}
                    onChange={event => setRegistrationPassword(event.target.value)}
                    placeholder="请客户设置登录密码（至少 8 位）"
                    className={`${inputCls} !pr-10`}
                  />
                  <button type="button" onClick={() => setShowRegistrationPassword(value => !value)} aria-label={showRegistrationPassword ? '隐藏密码' : '显示密码'} className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary">
                    {showRegistrationPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  </span>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-text-secondary">管理员邀请码</span>
                  <span className="relative block">
                  <Ticket size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    name="customer-registration-invite"
                    autoComplete="off"
                    value={inviteCode}
                    onChange={event => setInviteCode(event.target.value)}
                    placeholder="管理员邀请码"
                    className={inputCls}
                  />
                  </span>
                </label>
              </div>
              <label className="mt-4 flex items-start gap-2.5 text-xs leading-5 text-text-secondary">
                <input
                  type="checkbox"
                  name="legal-consent"
                  checked={registrationConsent}
                  onChange={event => setRegistrationConsent(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  required
                />
                <span>
                  我已阅读并同意
                  <a href="/terms" target="_blank" rel="noreferrer" className="mx-1 font-semibold text-accent hover:underline">《服务条款》</a>
                  和
                  <a href="/privacy" target="_blank" rel="noreferrer" className="mx-1 font-semibold text-accent hover:underline">《隐私政策》</a>
                  ，并确认我有权代表所属企业创建和使用本账号。
                </span>
              </label>
              {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-medium text-red">{error}</p>}
              <button type="submit" disabled={loading}
                className="btn-primary mt-6 flex min-h-12 w-full items-center justify-center gap-2 disabled:opacity-60">
                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                <span>注册并进入工作台</span>
                {!loading && <ArrowRight size={16} />}
              </button>
            </form>
          ) : (
            <form
              key="account-login"
              autoComplete="on"
              onSubmit={event => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-text-secondary">邮箱</span>
                  <span className="relative block">
                  <Mail size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="email"
                    name="email"
                    autoComplete="username"
                    value={loginEmail}
                    onChange={event => setLoginEmail(event.target.value)}
                    placeholder="邮箱"
                    className={inputCls}
                  />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-text-secondary">密码</span>
                  <span className="relative block">
                  <Lock size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={event => setLoginPassword(event.target.value)}
                    placeholder="密码"
                    className={`${inputCls} !pr-10`}
                  />
                  <button type="button" onClick={() => setShowLoginPassword(value => !value)} aria-label={showLoginPassword ? '隐藏密码' : '显示密码'} className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary">
                    {showLoginPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  </span>
                </label>
              </div>
              {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-medium text-red">{error}</p>}
              <button type="submit" disabled={loading}
                className="btn-primary mt-6 flex min-h-12 w-full items-center justify-center gap-2 disabled:opacity-60">
                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                <span>登录工作台</span>
                {!loading && <ArrowRight size={16} />}
              </button>
            </form>
          )}

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-[11px] text-text-muted">
            <span>© 2026 灵枢 AI</span>
            <span className="flex flex-wrap items-center gap-3">
              <a href="/privacy" className="font-semibold transition-colors hover:text-accent">隐私政策</a>
              <a href="/terms" className="font-semibold transition-colors hover:text-accent">服务条款</a>
              <a href="/data-deletion" className="font-semibold transition-colors hover:text-accent">数据删除</a>
            </span>
          </div>
        </motion.div>
      </section>
    </main>
  );
}
