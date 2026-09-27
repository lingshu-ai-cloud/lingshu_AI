import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Clipboard, KeyRound, Loader2, Save, Trash2 } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { validateOAuthCredentialPairs } from '../lib/socialOAuthCredentialValidation';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { useModalFocus } from '../hooks/useModalFocus';

type AppInfo = {
  appId: string;
  appSecretSet: boolean;
  waConfigId: string;
  phoneNumberId: string;
  waPublicNumber: string;
  webhookVerifyToken: string;
  webhookVerifyTokenSet?: boolean;
  accessTokenSet: boolean;
  status: string;
} | null;
type Config = {
  callbacks: Record<'youtube' | 'instagram' | 'facebook' | 'messenger' | 'tiktok', string>;
  metaWebhookUrl: string;
  apps: Record<'google' | 'meta' | 'tiktok', AppInfo>;
};
type ConfigPlatform = keyof Config['apps'];
type Form = {
  youtubeOAuthClientId: string;
  youtubeOAuthClientSecret: string;
  metaSocialAppId: string;
  metaSocialAppSecret: string;
  metaWebhookVerifyToken: string;
  tiktokClientKey: string;
  tiktokClientSecret: string;
};
const EMPTY: Form = { youtubeOAuthClientId: '', youtubeOAuthClientSecret: '', metaSocialAppId: '', metaSocialAppSecret: '', metaWebhookVerifyToken: '', tiktokClientKey: '', tiktokClientSecret: '' };

const PLATFORM_LABELS: Record<ConfigPlatform, string> = {
  google: 'YouTube / Google',
  meta: 'Instagram / Facebook / Messenger',
  tiktok: 'TikTok',
};

function withoutPlatformCredentials(form: Form, platform: ConfigPlatform): Form {
  if (platform === 'google') return { ...form, youtubeOAuthClientId: '', youtubeOAuthClientSecret: '' };
  if (platform === 'meta') return { ...form, metaSocialAppId: '', metaSocialAppSecret: '', metaWebhookVerifyToken: '' };
  return { ...form, tiktokClientKey: '', tiktokClientSecret: '' };
}

function Callback({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
    <div className="mb-1 flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-text-muted">{label}</span>
      <button type="button" onClick={async () => { await navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[10px] font-bold text-text-secondary hover:border-border-bright">
        {copied ? <CheckCircle2 size={11} className="text-accent" /> : <Clipboard size={11} />}{copied ? '已复制' : '复制'}
      </button>
    </div><code className="block break-all text-[11px] text-text-secondary">{value}</code>
  </div>;
}

function Field({ label, value, saved, secret, onChange }: { label: string; value: string; saved?: boolean; secret?: boolean; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-[11px] font-bold text-text-secondary">
    <span className="flex items-center justify-between"><span>{label}<span className="ml-0.5 text-red">*</span></span>{(value.trim() || saved) && <span className="inline-flex items-center gap-1 text-[10px] text-accent"><CheckCircle2 size={11} />已填写</span>}</span>
    <input type={secret ? 'password' : 'text'} autoComplete={secret ? 'new-password' : 'off'} data-1p-ignore data-lpignore="true" value={value} onChange={e => onChange(e.target.value)} placeholder={saved ? '已安全保存；留空表示不修改' : label} className="ui-field !rounded-md !bg-surface-2 font-normal" />
  </label>;
}

export default function UserSocialAppCredentials() {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [clearTarget, setClearTarget] = useState<ConfigPlatform | null>(null);
  const [clearing, setClearing] = useState(false);
  const clearRequestInFlight = useRef(false);
  const closeClearDialog = () => {
    if (!clearRequestInFlight.current) setClearTarget(null);
  };
  const clearDialogRef = useModalFocus<HTMLDivElement>({
    open: Boolean(clearTarget),
    onClose: closeClearDialog,
    closeOnEscape: () => !clearRequestInFlight.current,
  });

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/overseas/platform-integrations/oauth-config', { headers: authHeader() });
      const data = await response.json() as Config & { error?: string };
      if (!response.ok) throw new Error(data.error || '读取社媒应用配置失败');
      setConfig(data);
      setForm(current => ({ ...current, youtubeOAuthClientId: data.apps.google?.appId || '', metaSocialAppId: data.apps.meta?.appId || '', tiktokClientKey: data.apps.tiktok?.appId || '' }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取社媒应用配置失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const field = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }));
  async function save() {
    const validationError = validateOAuthCredentialPairs([
      { label: 'YouTube / Google', clientId: form.youtubeOAuthClientId, clientSecret: form.youtubeOAuthClientSecret, savedClientId: config?.apps.google?.appId || '', savedSecret: Boolean(config?.apps.google?.appSecretSet) },
      { label: 'Instagram / Facebook', clientId: form.metaSocialAppId, clientSecret: form.metaSocialAppSecret, savedClientId: config?.apps.meta?.appId || '', savedSecret: Boolean(config?.apps.meta?.appSecretSet) },
      { label: 'TikTok', clientId: form.tiktokClientKey, clientSecret: form.tiktokClientSecret, savedClientId: config?.apps.tiktok?.appId || '', savedSecret: Boolean(config?.apps.tiktok?.appSecretSet) },
    ]);
    if (validationError) { setError(validationError); return; }
    setSaving(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/overseas/platform-integrations/oauth-config', { method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || '保存失败');
      setMessage('已保存到你的企业空间。请把下方回调地址原样添加到各平台后台，再连接账号。');
      setForm(current => ({ ...current, youtubeOAuthClientSecret: '', metaSocialAppSecret: '', metaWebhookVerifyToken: '', tiktokClientSecret: '' }));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setSaving(false); }
  }
  async function clearPlatform() {
    if (!clearTarget || clearRequestInFlight.current) return;
    const target = clearTarget;
    clearRequestInFlight.current = true;
    setClearing(true); setMessage(''); setError('');
    try {
      const response = await fetch(`/api/overseas/platform-integrations/oauth-config/${target}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; detail?: string; disconnectedAccounts?: number };
      if (!response.ok) throw new Error(data.detail || data.error || '清除平台配置失败');
      const label = PLATFORM_LABELS[target];
      const accountCount = data.disconnectedAccounts ?? 0;
      setForm(current => withoutPlatformCredentials(current, target));
      setClearTarget(null);
      await load();
      setMessage(`${label} 配置已清除${accountCount > 0 ? `，并已断开 ${accountCount} 个已连接账号` : ''}。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '清除平台配置失败'); }
    finally { clearRequestInFlight.current = false; setClearing(false); }
  }
  const cards = config && [
    { key: 'google', title: 'YouTube / Google', icon: <SocialPlatformIcon platform="youtube" size={20} />, sub: 'Google Cloud OAuth Web application', idLabel: 'Client ID', idKey: 'youtubeOAuthClientId' as const, secretLabel: 'Client Secret', secretKey: 'youtubeOAuthClientSecret' as const, callbacks: [['Authorized redirect URI', config.callbacks.youtube]] },
    { key: 'meta', title: 'Instagram / Facebook / Messenger', icon: <span className="flex gap-1"><SocialPlatformIcon platform="instagram" size={19} /><SocialPlatformIcon platform="facebook" size={19} /><SocialPlatformIcon platform="messenger" size={19} /></span>, sub: '三个能力共用一套 Meta App', idLabel: 'App ID', idKey: 'metaSocialAppId' as const, secretLabel: 'App Secret', secretKey: 'metaSocialAppSecret' as const, callbacks: [['Instagram redirect URI', config.callbacks.instagram], ['Facebook redirect URI', config.callbacks.facebook], ['Messenger Webhook Callback URL', config.callbacks.messenger || config.metaWebhookUrl]] },
    { key: 'tiktok', title: 'TikTok', icon: <SocialPlatformIcon platform="tiktok" size={20} />, sub: 'Login Kit + Content Posting API', idLabel: 'Client Key', idKey: 'tiktokClientKey' as const, secretLabel: 'Client Secret', secretKey: 'tiktokClientSecret' as const, callbacks: [['Redirect URI', config.callbacks.tiktok]] },
  ];
  return <>
  <section className="mb-5 overflow-hidden rounded-lg border border-border bg-white">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="social-app-credentials-content" className="flex w-full items-center justify-between gap-3 border-l-2 border-accent bg-white px-4 py-4 text-left sm:px-5">
      <div><h2 className="flex items-center gap-2 text-sm font-bold text-text-primary"><KeyRound size={16} className="text-accent" />配置我自己的社媒应用</h2><p className="mt-1 text-xs text-text-secondary">凭证只用于你的企业空间，账号授权与发布不与其他用户共用出口配置。</p></div><ChevronDown aria-hidden="true" size={16} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id="social-app-credentials-content" className="space-y-4 border-t border-border p-4 sm:p-5">
      <p className="border-l-2 border-insight bg-insight-soft px-3 py-2 text-[11px] leading-5 text-insight-action">先在 Google、Meta 或 TikTok 开发者后台创建应用，再填写凭证。Secret 会加密保存，页面不会再次明文显示。</p>
      {message && <p role="status" className="border-l-2 border-accent bg-accent-glow px-3 py-2 text-xs font-bold text-accent">{message}</p>}{error && <p role="alert" className="border-l-2 border-red bg-red/5 px-3 py-2 text-xs font-bold text-red">{error}</p>}
      {loading ? <div className="flex h-24 items-center justify-center gap-2 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" />正在读取配置...</div> : <>
        <div className="grid gap-3 xl:grid-cols-3">{cards?.map(card => <div key={card.key} className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div><p className="flex items-center gap-2 text-sm font-black text-text-primary">{card.icon}{card.title}</p><p className="mt-1 text-[11px] text-text-muted">{card.sub}</p></div>
            <button
              type="button"
              onClick={() => setClearTarget(card.key as ConfigPlatform)}
              disabled={!config?.apps[card.key as ConfigPlatform] || clearing}
              aria-label={`清除 ${card.title} 平台配置`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red/30 bg-red/5 px-2 py-1.5 text-[10px] font-bold text-red transition hover:bg-red/10 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-text-muted"
            >
              <Trash2 size={11} />清除配置
            </button>
          </div>
          <Field label={card.idLabel} value={form[card.idKey]} onChange={value => field(card.idKey, value)} />
          <Field secret label={card.secretLabel} value={form[card.secretKey]} saved={config?.apps[card.key as keyof Config['apps']]?.appSecretSet} onChange={value => field(card.secretKey, value)} />
          {card.key === 'meta' && <Field secret label="Messenger Webhook Verify Token" value={form.metaWebhookVerifyToken} saved={config?.apps.meta?.webhookVerifyTokenSet} onChange={value => field('metaWebhookVerifyToken', value)} />}
          {card.callbacks.map(([label, value]) => <Callback key={label} label={label} value={value} />)}
        </div>)}</div>
        <div className="flex justify-end"><button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2.5 text-xs font-bold text-white hover:bg-accent-dim disabled:opacity-50">{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}保存我的平台凭证</button></div>
      </>}
    </div>}
  </section>
  {clearTarget && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeClearDialog(); }}>
    <div ref={clearDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-busy={clearing} aria-labelledby="clear-user-platform-title" aria-describedby="clear-user-platform-description" className="w-full max-w-md rounded-t-lg border border-border bg-white p-5 shadow-xl sm:rounded-lg" onMouseDown={event => event.stopPropagation()}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-insight-soft text-insight-action"><AlertTriangle size={19} /></span>
        <div>
          <h3 id="clear-user-platform-title" className="text-base font-bold text-text-primary">清除 {PLATFORM_LABELS[clearTarget]} 配置？</h3>
          <p id="clear-user-platform-description" className="mt-2 text-sm leading-6 text-text-secondary">应用凭证会从你的企业空间中删除，这个平台下已连接的账号也会同时断开。</p>
          <p className="mt-2 text-xs leading-5 text-text-muted">这不会撤销第三方平台后台的授权；如需彻底撤销，请同时到对应平台的账号安全设置中移除本应用。</p>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" data-modal-initial-focus onClick={closeClearDialog} disabled={clearing} className="rounded-md border border-border bg-white px-4 py-2.5 text-xs font-bold text-text-secondary hover:bg-surface-2 disabled:opacity-50">取消</button>
        <button type="button" onClick={() => void clearPlatform()} disabled={clearing} className="inline-flex items-center gap-1.5 rounded-md bg-red px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">
          {clearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}确认清除
        </button>
      </div>
    </div>
  </div>}
  </>;
}
