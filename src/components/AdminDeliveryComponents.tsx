import { useState } from 'react';
import { Input } from 'antd';
import { CheckCircle2, Clipboard, KeyRound, Link2, Loader2, Save, ShieldCheck } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { SocialPlatformIcon } from './SocialPlatformIcon';
type Platform = 'meta' | 'google' | 'tiktok' | 'wecom'; type Status = 'pending' | 'configuring' | 'waiting_customer' | 'importing_history' | 'verifying' | 'active' | 'needs_permanent_token' | 'token_expired' | 'error';
interface DeliveryApp {
  id: string;
  tenantId: string;
  platform: Platform;
  appId: string;
  appSecret: string;
  appSecretSet: boolean;
  appSecretLength: number;
  waConfigId: string;
  businessId: string;
  wabaId: string;
  phoneNumberId: string;
  waPublicNumber: string;
  pageId: string;
  igUserId: string;
  youtubeChannelId: string;
  webhookVerifyToken: string; webhookVerifyTokenSet?: boolean; webhookVerifyTokenLength?: number;
  wecomEncodingAesKeySet: boolean;
  wecomEncodingAesKeyLength: number;
  webhookUrl: string;
  oauthRedirectUri: string;
  tokenType: 'user_60d' | 'system_user_permanent';
  accessTokenSet: boolean;
  accessTokenLength: number;
  tokenExpiresAt: string;
  status: Status;
  checklist: Record<string, boolean | string>;
  notes: string;
}

interface TenantCard {
  tenantId: string;
  name: string;
  contactName?: string;
  industry?: string;
  notes?: string;
  inviteCode?: string;
  inviteUrl?: string;
  registrationState?: 'waiting_registration' | 'registered' | 'existing';
  registeredEmail?: string;
  subscriptionPlan?: string;
  subscriptionStatus?: string;
  accountType?: 'customer' | 'trial' | 'admin' | 'existing';
  apps: DeliveryApp[];
}

interface GeneratedInvite { companyName: string; inviteCode: string; inviteUrl: string }

type Draft = Record<string, Partial<DeliveryApp> & { appSecret?: string; accessToken?: string; webhookVerifyToken?: string; wecomEncodingAesKey?: string }>;
type TestState = Record<string, Record<string, 'idle' | 'running' | 'ok' | 'error'>>;
type AssistLinkState = Record<string, { link: string; loading?: boolean }>;
type ProgressStageKey = 'email_connected' | 'business_verification' | 'permanent_token_replaced';
type ProgressStageState = 'done' | 'pending' | 'todo';
interface KnowledgeCompletionState { completed: number; total: number }

const STATUS_LABEL: Record<Status, string> = {
  pending: '待配置',
  configuring: '配置中',
  waiting_customer: '等客户操作',
  importing_history: '历史导入中',
  verifying: '验收中',
  active: '已交付',
  needs_permanent_token: '待换永久 token',
  token_expired: 'Token 过期',
  error: '异常',
};

const META_STEPS = [
  { id: 'metaApp', title: '1. Meta 开发者应用', desc: '录入 App ID / Secret，保存后可继续核对。' },
  { id: 'webhook', title: '2. Webhook 回调', desc: '复制 Webhook URL 和 Verify Token 到 Meta 后台。' },
  { id: 'whatsapp', title: '3. WhatsApp 接入', desc: '录入 Config ID / WABA / Phone Number ID，完成扫码或新号接入。' },
  { id: 'social', title: '4. FB / IG 资产（可选）', desc: 'OAuth 会自动识别；仅在多主页时填写 ID 锁定资产。' },
  { id: 'acceptance', title: '5. 验收', desc: '测试 WhatsApp 收发、Webhook 订阅和主页列表。' },
];

const GOOGLE_STEPS = [
  { id: 'googleApp', title: '1. Google OAuth 应用', desc: '录入 Client ID / Secret。' },
  { id: 'youtube', title: '2. YouTube 授权', desc: '记录频道 ID，并提醒客户通过未验证应用提示。' },
  { id: 'acceptance', title: '3. 验收', desc: '检查 YouTube 连接能读到频道。' },
];

const TIKTOK_STEPS = [
  { id: 'tiktokApp', title: '1. TikTok 应用', desc: '录入客户的 Client Key / Secret。' },
  { id: 'tiktokCallback', title: '2. 回调地址', desc: '将授权回调地址填入 TikTok 开发者后台。' },
  { id: 'acceptance', title: '3. 验收', desc: '生成协助链接，让客户完成 TikTok 授权。' },
];

const WECOM_STEPS = [
  { id: 'wecomApp', title: '1. 企业微信应用', desc: '录入 CorpID / Secret / AgentId。' },
  { id: 'wecomWebhook', title: '2. 回调配置', desc: '复制回调 URL、Token、EncodingAESKey 到企业微信后台。' },
  { id: 'wecomArchive', title: '3. 会话存档', desc: '确认客户联系与会话内容存档已开通。' },
  { id: 'acceptance', title: '4. 验收', desc: '检查回调验证与消息链路配置。' },
];

function keyOf(tenantId: string, platform: Platform) {
  return `${tenantId}:${platform}`;
}

function appValue(drafts: Draft, app: DeliveryApp, field: keyof DeliveryApp) {
  const value = drafts[keyOf(app.tenantId, app.platform)]?.[field];
  return typeof value === 'string' ? value : String(app[field] ?? '');
}

function savedSecretHint(length: number, fallback: string) {
  return length > 0 ? `已保存 · ${length} 位` : fallback;
}

function savedSecretPlaceholder(length: number) {
  if (length <= 0) return '已加密保存，留空则不修改';
  const dots = '•'.repeat(Math.min(length, 48));
  return `${dots}${length > 48 ? '…' : ''}（${length} 位）`;
}

async function jsonFetch(url: string, init?: RequestInit) {
  const resp = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers ?? {}) },
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok && json.error === 'tenants_unavailable') {
    throw new Error(`租户数据源不可用：${json.detail || '请检查 PocketBase tenants 集合'}`);
  }
  if (!resp.ok && json.error === 'admin_required') {
    throw new Error('没有管理员权限：请使用管理员邮箱登录后再打开客户运维');
  }
  if (!resp.ok) throw new Error(json.error || '请求失败');
  return json;
}

function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-[11px] font-bold text-text-muted">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2 py-1 text-[11px] text-text-secondary">{value || '保存配置后生成'}</code>
      <button type="button" onClick={() => value && navigator.clipboard?.writeText(value)} className="rounded-lg border border-border bg-white p-1.5 text-text-muted hover:text-text-primary">
        <Clipboard size={12} />
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  placeholder,
  secret,
  required,
  completed,
  numericId,
  fieldName,
  onChange,
}: {
  label: string;
  hint: string;
  value?: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
  completed?: boolean;
  numericId?: boolean;
  fieldName?: string;
  onChange: (value: string) => void;
}) {
  const isCompleted = Boolean(value?.trim()) || Boolean(completed);

  return (
    <label className="grid gap-1 text-xs font-bold text-text-secondary">
      <span className="flex items-center justify-between gap-2">
        <span>
          {label}
          {required && <span className="ml-0.5 text-red-500" aria-label="必填">*</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-text-muted">{hint}</span>
          {isCompleted && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-bold text-emerald-600">
              <CheckCircle2 size={11} /> 填写完成
            </span>
          )}
        </span>
      </span>
      <Input
        name={fieldName}
        type={secret ? 'password' : 'text'}
        required={required}
        aria-required={required}
        inputMode={numericId ? 'numeric' : undefined}
        autoComplete={secret ? 'new-password' : 'off'}
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={event => onChange(numericId ? event.target.value.replace(/\D/g, '') : event.target.value)}
        className="w-full font-normal"
      />
    </label>
  );
}

function ChecklistButton({
  app,
  id,
  label,
  drafts,
  setDrafts,
}: {
  app: DeliveryApp;
  id: string;
  label: string;
  drafts: Draft;
  setDrafts: (next: Draft | ((current: Draft) => Draft)) => void;
}) {
  const appKey = keyOf(app.tenantId, app.platform);
  const checklist = { ...(app.checklist ?? {}), ...(drafts[appKey]?.checklist ?? {}) };
  const checked = Boolean(checklist[id]);
  return (
    <button
      type="button"
      onClick={() => setDrafts(current => ({
        ...current,
        [appKey]: {
          ...current[appKey],
          checklist: { ...checklist, [id]: !checked },
        },
      }))}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${checked ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-border bg-white text-text-muted'}`}
    >
      <CheckCircle2 size={12} /> {label}
    </button>
  );
}

function appFor(tenant: TenantCard, platform: Platform) {
  return tenant.apps.find(app => app.platform === platform);
}

function hasCheck(app: DeliveryApp | undefined, id: string) {
  return Boolean(app?.checklist?.[id]);
}

function DeploymentProgressStrip({
  tenant,
  busyKey,
  onToggle,
  knowledgeCompletion,
}: {
  tenant: TenantCard;
  busyKey: string;
  onToggle: (tenant: TenantCard, key: ProgressStageKey) => Promise<void>;
  knowledgeCompletion: KnowledgeCompletionState | null;
}) {
  const meta = appFor(tenant, 'meta');
  const google = appFor(tenant, 'google');
  const tiktok = appFor(tenant, 'tiktok');
  const wecom = appFor(tenant, 'wecom');
  const businessApproved = hasCheck(meta, 'business_verification_approved');
  const businessSubmitted = hasCheck(meta, 'business_verification_submitted');
  const stages: Array<{
    key: string;
    label: string;
    state: ProgressStageState;
    manual?: ProgressStageKey;
    hint: string;
  }> = [
    {
      key: 'meta_app',
      label: 'Meta App 已录入',
      state: meta?.appId && meta.appSecretSet ? 'done' : meta?.appId ? 'pending' : 'todo',
      hint: '由 App ID / Secret 自动判断',
    },
    {
      key: 'webhook',
      label: 'Webhook 已验证',
      state: hasCheck(meta, 'webhook_verified') || hasCheck(meta, 'messages_subscribed') || hasCheck(meta, 'webhook_test_passed') ? 'done' : 'todo',
      hint: '由 Webhook checklist / 自检结果判断',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp 已接通',
      state: hasCheck(meta, 'customer_scanned') || hasCheck(meta, 'wa_message_received') || hasCheck(meta, 'whatsapp_test_passed') || Boolean(meta?.phoneNumberId) ? 'done' : 'todo',
      hint: '由 Phone Number ID / WhatsApp 验收项判断',
    },
    {
      key: 'fb_ig',
      label: 'FB/IG 已授权',
      state: hasCheck(meta, 'fb_ig_authorized') || hasCheck(meta, 'pages_test_passed') || Boolean(meta?.pageId || meta?.igUserId) ? 'done' : 'todo',
      hint: '由主页 / IG ID 或授权 checklist 判断',
    },
    {
      key: 'youtube',
      label: 'YouTube 已授权',
      state: hasCheck(google, 'youtube_authorized') || hasCheck(google, 'google_test_passed') || Boolean(google?.youtubeChannelId) ? 'done' : 'todo',
      hint: '由频道 ID 或 YouTube checklist 判断',
    },
    {
      key: 'tiktok',
      label: 'TikTok 已授权',
      state: hasCheck(tiktok, 'tiktok_authorized') || hasCheck(tiktok, 'tiktok_test_passed') ? 'done' : 'todo',
      hint: '由 TikTok 授权与自检结果判断',
    },
    {
      key: 'wecom',
      label: '企业微信已接通',
      state: hasCheck(wecom, 'wecom_callback_verified') && hasCheck(wecom, 'wecom_message_test_passed') ? 'done' : 'todo',
      hint: '由企业微信回调验证与消息自检判断',
    },
    {
      key: 'email',
      label: '邮箱已接通',
      state: hasCheck(meta, 'email_connected') ? 'done' : 'todo',
      manual: 'email_connected',
      hint: '手动勾选，记录顾问已完成邮箱接入',
    },
    {
      key: 'business_data',
      label: `业务资料导入 ${knowledgeCompletion?.completed ?? 0}/${knowledgeCompletion?.total ?? 6}`,
      state: (knowledgeCompletion?.completed ?? 0) >= 5 ? 'done' : 'todo',
      hint: '读取该租户知识库完成度，>=5/6 视为完成',
    },
    {
      key: 'business',
      label: businessApproved ? '企业认证：已通过' : businessSubmitted ? '企业认证：审核中' : '企业认证',
      state: businessApproved ? 'done' : businessSubmitted ? 'pending' : 'todo',
      manual: 'business_verification',
      hint: '点击循环：未提交 → 审核中 → 已通过',
    },
    {
      key: 'token',
      label: '永久令牌已替换',
      state: meta?.tokenType === 'system_user_permanent' || hasCheck(meta, 'permanent_token_replaced') ? 'done' : 'todo',
      manual: 'permanent_token_replaced',
      hint: '可由 Token 类型自动判断，也可手动标记',
    },
  ];

  const doneCount = stages.filter(stage => stage.state === 'done').length;
  const total = stages.length;

  return (
    <div className="mb-3 rounded-lg border border-border bg-white px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-text-primary">部署进度</p>
          <p className="mt-0.5 text-[11px] text-text-muted">按 SOP 阶段交接，自动项会随配置和验收更新。</p>
        </div>
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-text-secondary">{doneCount}/{total}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {stages.map(stage => {
          const tone = stage.state === 'done'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : stage.state === 'pending'
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-border bg-surface-2 text-text-muted';
          const content = (
            <>
              <CheckCircle2 size={12} className={stage.state === 'todo' ? 'opacity-35' : ''} />
              {stage.label}
              {busyKey === `${tenant.tenantId}:${stage.manual}` && <Loader2 size={12} className="animate-spin" />}
            </>
          );
          if (stage.manual) {
            return (
              <button
                key={stage.key}
                type="button"
                title={stage.hint}
                onClick={() => void onToggle(tenant, stage.manual!)}
                disabled={busyKey === `${tenant.tenantId}:${stage.manual}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-60 ${tone}`}
              >
                {content}
              </button>
            );
          }
          return (
            <span key={stage.key} title={stage.hint} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${tone}`}>
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PlatformWizard({
  app,
  drafts,
  setDrafts,
  tests,
  onSave,
  onTest,
  onComplete,
  onAssistLink,
  assistLink,
  saving,
}: {
  app: DeliveryApp;
  drafts: Draft;
  setDrafts: (next: Draft | ((current: Draft) => Draft)) => void;
  tests: TestState;
  onSave: (app: DeliveryApp, options?: { silent?: boolean }) => Promise<boolean>;
  onTest: (app: DeliveryApp, kind: string) => Promise<void>;
  onComplete: (app: DeliveryApp) => Promise<void>;
  onAssistLink: (app: DeliveryApp) => Promise<void>;
  assistLink?: { link: string; loading?: boolean };
  saving: boolean;
}) {
  const appKey = keyOf(app.tenantId, app.platform);
  const [activeStep, setActiveStep] = useState(app.platform === 'meta' ? 'metaApp' : app.platform === 'google' ? 'googleApp' : app.platform === 'tiktok' ? 'tiktokApp' : 'wecomApp');
  const test = tests[appKey] ?? {};
  const steps = app.platform === 'meta' ? META_STEPS : app.platform === 'google' ? GOOGLE_STEPS : app.platform === 'tiktok' ? TIKTOK_STEPS : WECOM_STEPS;
  const update = (patch: Record<string, string | Record<string, boolean>>) => {
    setDrafts(current => ({ ...current, [appKey]: { ...current[appKey], ...patch } }));
  };
  const platformName = app.platform === 'meta' ? 'Meta / WhatsApp' : app.platform === 'google' ? 'Google / YouTube' : app.platform === 'tiktok' ? 'TikTok' : '企业微信';
  const draftStatus = (drafts[appKey]?.status as Status | undefined) ?? app.status;

  const testItems = app.platform === 'meta'
    ? [
      ['whatsapp', 'WhatsApp 配置'],
      ['pages', '主页列表'],
      ['webhook', 'Webhook 订阅'],
    ]
    : app.platform === 'google'
      ? [['google', 'Google OAuth']]
      : app.platform === 'tiktok'
        ? [['tiktok', 'TikTok OAuth']]
      : [['wecom_webhook', '企业微信回调'], ['wecom', '企业微信消息']];

  const statusTone = draftStatus === 'active'
    ? 'bg-emerald-50 text-emerald-700'
    : draftStatus === 'error' || draftStatus === 'token_expired'
      ? 'bg-red-50 text-red-700'
      : draftStatus === 'needs_permanent_token'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-surface-2 text-text-secondary';

  return (
    <div className="rounded-lg border border-border bg-white p-4 shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              {app.platform === 'meta' && <>
                <SocialPlatformIcon platform="facebook" size={18} />
                <SocialPlatformIcon platform="instagram" size={18} />
                <SocialPlatformIcon platform="whatsapp" size={18} />
              </>}
              {app.platform === 'google' && <SocialPlatformIcon platform="youtube" size={20} />}
              {app.platform === 'tiktok' && <SocialPlatformIcon platform="tiktok" size={20} />}
            </span>
            <p className="text-sm font-semibold text-text-primary">{platformName}</p>
          </div>
          <p className="mt-1 text-xs text-text-muted">顾问在客户电脑上录入，Secret / Token 加密保存，不经过微信和邮件。</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {app.platform !== 'wecom' && (
            <button
              type="button"
              onClick={() => void onAssistLink(app)}
              disabled={assistLink?.loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 disabled:opacity-60"
            >
              {assistLink?.loading ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
              生成协助链接
            </button>
          )}
          <select
            value={draftStatus}
            onChange={event => update({ status: event.target.value })}
            className={`rounded-full border border-transparent px-2.5 py-1 text-[11px] font-semibold outline-none ${statusTone}`}
          >
            {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </div>

      {assistLink?.link && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
          <span className="shrink-0 text-[11px] font-semibold text-emerald-800">协助链接</span>
          <code className="min-w-0 flex-1 truncate text-[11px] text-emerald-900">{assistLink.link}</code>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(assistLink.link)}
            className="rounded-lg bg-white p-1.5 text-emerald-700"
            title="复制协助链接"
          >
            <Clipboard size={12} />
          </button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-[160px_1fr] gap-4">
        <div className="space-y-2">
          {steps.map(step => (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveStep(step.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${activeStep === step.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-border bg-surface-2 text-text-secondary hover:bg-white'}`}
            >
              <span className="font-semibold">{step.title}</span>
              <span className={`mt-1 block text-[10px] leading-4 ${activeStep === step.id ? 'text-white/70' : 'text-text-muted'}`}>{step.desc}</span>
            </button>
          ))}
        </div>

        <div className="min-w-0 space-y-3">
          {activeStep === 'metaApp' && (
            <div className="grid gap-3">
              <Field required label="App ID" hint="开发者后台首页" value={appValue(drafts, app, 'appId')} onChange={value => update({ appId: value })} />
              <Field required secret completed={app.appSecretSet} label="App Secret" hint={savedSecretHint(app.appSecretLength, '应用设置 > 基本')} value={appValue(drafts, app, 'appSecret')} placeholder={app.appSecretSet ? savedSecretPlaceholder(app.appSecretLength) : '填写 App Secret'} onChange={value => update({ appSecret: value })} />
              <Field label="Business ID" hint="BM 设置里可找到" value={appValue(drafts, app, 'businessId')} onChange={value => update({ businessId: value })} />
              <ChecklistButton app={app} id="privacy_domain_saved" label="隐私政策和域名已填" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'webhook' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-dashed border-border bg-surface-2 p-3">
                <p className="mb-2 text-xs font-semibold text-text-primary">复制到 Meta 后台</p>
                <div className="space-y-2">
                  <CopyLine label="Webhook URL" value={app.webhookUrl} />
                  <Field required secret completed={app.webhookVerifyTokenSet} label="Verify Token（新建/轮换）" hint={app.webhookVerifyTokenSet ? savedSecretHint(app.webhookVerifyTokenLength ?? 0, '已保存') : '请与 Meta 后台填写相同值'} value={appValue(drafts, app, 'webhookVerifyToken')} placeholder={app.webhookVerifyTokenSet ? savedSecretPlaceholder(app.webhookVerifyTokenLength ?? 0) : '填写自定义 Verify Token'} onChange={value => update({ webhookVerifyToken: value })} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ChecklistButton app={app} id="webhook_verified" label="Webhook 验证成功" drafts={drafts} setDrafts={setDrafts} />
                <ChecklistButton app={app} id="messages_subscribed" label="已订阅 messages / message_status" drafts={drafts} setDrafts={setDrafts} />
              </div>
            </div>
          )}

          {activeStep === 'whatsapp' && (
            <div className="grid gap-3">
              <Field required label="Embedded Signup Config ID" hint="WhatsApp > Embedded Signup" value={appValue(drafts, app, 'waConfigId')} onChange={value => update({ waConfigId: value })} />
              <Field label="WABA ID" hint="WhatsApp Business Account" value={appValue(drafts, app, 'wabaId')} onChange={value => update({ wabaId: value })} />
              <Field required label="Phone Number ID" hint="号码详情页" value={appValue(drafts, app, 'phoneNumberId')} onChange={value => update({ phoneNumberId: value })} />
              <Field label="WhatsApp 真实手机号" hint="用于 wa.me 询盘追踪，如 971501234567" value={appValue(drafts, app, 'waPublicNumber')} onChange={value => update({ waPublicNumber: value })} />
              <Field required completed={app.accessTokenSet} label="Access Token" hint={app.accessTokenSet ? savedSecretHint(app.accessTokenLength, '已保存') : '60天或永久 token'} secret placeholder={app.accessTokenSet ? savedSecretPlaceholder(app.accessTokenLength) : 'EAAB...'} onChange={value => update({ accessToken: value })} />
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs font-bold text-text-secondary">
                  Token 类型
                  <select value={appValue(drafts, app, 'tokenType') || 'user_60d'} onChange={event => update({ tokenType: event.target.value })} className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none">
                    <option value="user_60d">60天用户 token</option>
                    <option value="system_user_permanent">系统用户永久 token</option>
                  </select>
                </label>
                <Field label="到期时间" hint="ISO 时间" value={appValue(drafts, app, 'tokenExpiresAt')} placeholder="2026-08-01T00:00:00.000Z" onChange={value => update({ tokenExpiresAt: value })} />
              </div>
              <div className="flex flex-wrap gap-2">
                <ChecklistButton app={app} id="customer_scanned" label="客户已扫码/完成新号验证" drafts={drafts} setDrafts={setDrafts} />
                <ChecklistButton app={app} id="history_import_started" label="历史导入已启动" drafts={drafts} setDrafts={setDrafts} />
              </div>
            </div>
          )}

          {activeStep === 'social' && (
            <div className="grid gap-3">
              <Field fieldName="facebook-page-id" label="Facebook Page ID（可选）" hint="OAuth 可自动识别" numericId placeholder="有多个主页时填写数字 ID" value={appValue(drafts, app, 'pageId')} onChange={value => update({ pageId: value })} />
              <Field fieldName="instagram-user-id" label="Instagram User ID（可选）" hint="OAuth 可自动识别" numericId placeholder="有多个 IG 时填写数字 ID" value={appValue(drafts, app, 'igUserId')} onChange={value => update({ igUserId: value })} />
              <ChecklistButton app={app} id="fb_ig_authorized" label="客户已授权正确主页/IG" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'wecomApp' && (
            <div className="grid gap-3">
              <Field required label="企业 ID / CorpID" hint="企业微信管理后台 > 我的企业" value={appValue(drafts, app, 'appId')} onChange={value => update({ appId: value })} />
              <Field required secret completed={app.appSecretSet} label="应用 Secret" hint={savedSecretHint(app.appSecretLength, '自建应用 Secret')} value={appValue(drafts, app, 'appSecret')} placeholder={app.appSecretSet ? savedSecretPlaceholder(app.appSecretLength) : '填写应用 Secret'} onChange={value => update({ appSecret: value })} />
              <Field required label="AgentId" hint="自建应用详情页" value={appValue(drafts, app, 'businessId')} onChange={value => update({ businessId: value })} />
              <ChecklistButton app={app} id="wecom_app_visible_range_set" label="应用可见范围已包含客户接待人员" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'wecomWebhook' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-dashed border-border bg-surface-2 p-3">
                <p className="mb-2 text-xs font-semibold text-text-primary">复制到企业微信后台</p>
                <div className="space-y-2">
                  <CopyLine label="回调 URL" value={app.webhookUrl} />
                  <Field required secret completed={app.webhookVerifyTokenSet} label="Token（新建/轮换）" hint={app.webhookVerifyTokenSet ? savedSecretHint(app.webhookVerifyTokenLength ?? 0, '已保存') : '请与企业微信后台填写相同值'} value={appValue(drafts, app, 'webhookVerifyToken')} placeholder={app.webhookVerifyTokenSet ? savedSecretPlaceholder(app.webhookVerifyTokenLength ?? 0) : '填写自定义 Token'} onChange={value => update({ webhookVerifyToken: value })} />
                </div>
              </div>
              <Field required completed={app.wecomEncodingAesKeySet} label="EncodingAESKey" hint={app.wecomEncodingAesKeySet ? savedSecretHint(app.wecomEncodingAesKeyLength, '已保存') : '企业微信后台随机生成'} secret placeholder={app.wecomEncodingAesKeySet ? savedSecretPlaceholder(app.wecomEncodingAesKeyLength) : '43 位 EncodingAESKey'} onChange={value => update({ wecomEncodingAesKey: value })} />
              <ChecklistButton app={app} id="wecom_callback_verified" label="企业微信后台 URL 验证通过" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'wecomArchive' && (
            <div className="grid gap-3">
              <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3 text-xs leading-6 text-amber-800">
                企业微信要同步外部联系人聊天到“我的客户”，必须开通“客户联系”和“会话内容存档”。如果只配置自建应用回调，只能收到应用事件，不能完整读取客户聊天内容。
              </div>
              <ChecklistButton app={app} id="wecom_customer_contact_enabled" label="客户联系已开通" drafts={drafts} setDrafts={setDrafts} />
              <ChecklistButton app={app} id="wecom_archive_enabled" label="会话内容存档已开通并完成密钥配置" drafts={drafts} setDrafts={setDrafts} />
              <ChecklistButton app={app} id="wecom_staff_authorized" label="接待员工已授权存档" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'googleApp' && (
            <div className="grid gap-3">
              <Field required label="Client ID" hint="Google Cloud OAuth" value={appValue(drafts, app, 'appId')} onChange={value => update({ appId: value })} />
              <Field required secret completed={app.appSecretSet} label="Client Secret" hint={savedSecretHint(app.appSecretLength, 'Google Cloud OAuth')} value={appValue(drafts, app, 'appSecret')} placeholder={app.appSecretSet ? savedSecretPlaceholder(app.appSecretLength) : '填写 Client Secret'} onChange={value => update({ appSecret: value })} />
              <ChecklistButton app={app} id="google_consent_published" label="OAuth 同意屏幕已发布到生产" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'youtube' && (
            <div className="grid gap-3">
              <Field label="YouTube Channel ID" hint="授权后可自动识别" value={appValue(drafts, app, 'youtubeChannelId')} onChange={value => update({ youtubeChannelId: value })} />
              <ChecklistButton app={app} id="youtube_authorized" label="客户已完成 YouTube 授权" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'tiktokApp' && (
            <div className="grid gap-3">
              <Field required label="Client Key" hint="TikTok for Developers > Manage apps" value={appValue(drafts, app, 'appId')} onChange={value => update({ appId: value })} />
              <Field required secret completed={app.appSecretSet} label="Client Secret" hint={savedSecretHint(app.appSecretLength, 'TikTok for Developers > Manage apps')} value={appValue(drafts, app, 'appSecret')} placeholder={app.appSecretSet ? savedSecretPlaceholder(app.appSecretLength) : '填写 Client Secret'} onChange={value => update({ appSecret: value })} />
            </div>
          )}

          {activeStep === 'tiktokCallback' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-dashed border-border bg-surface-2 p-3">
                <p className="mb-2 text-xs font-semibold text-text-primary">复制到 TikTok 开发者后台</p>
                <CopyLine label="Redirect URI" value={app.oauthRedirectUri} />
              </div>
              <ChecklistButton app={app} id="tiktok_callback_registered" label="回调地址已添加并保存" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'acceptance' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(app.platform === 'meta'
                  ? ['wa_message_received', 'wa_reply_sent', 'boss_alert_received', 'fb_comment_received']
                  : app.platform === 'google'
                    ? ['youtube_channel_read']
                    : app.platform === 'tiktok'
                      ? ['tiktok_authorized']
                      : ['wecom_callback_verified', 'wecom_message_test_passed', 'wecom_archive_enabled']
                ).map(id => (
                  <ChecklistButton key={id} app={app} id={id} label={{
                    wa_message_received: '30秒内收到 WhatsApp 消息',
                    wa_reply_sent: '测试手机收到回复',
                    boss_alert_received: '老板提醒卡已收到',
                    fb_comment_received: '主页评论已进入收件箱',
                    youtube_channel_read: '能读取 YouTube 频道',
                    tiktok_authorized: '客户已完成 TikTok 授权',
                    wecom_callback_verified: '企业微信回调验证通过',
                    wecom_message_test_passed: '企业微信消息链路已验收',
                    wecom_archive_enabled: '会话内容存档已开通',
                  }[id] || id} drafts={drafts} setDrafts={setDrafts} />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {testItems.map(([kind, label]) => (
                  <button key={kind} type="button" onClick={() => void onTest(app, kind)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">
                    {test[kind] === 'running' ? <Loader2 size={13} className="animate-spin" /> : test[kind] === 'ok' ? <CheckCircle2 size={13} className="text-emerald-600" /> : <ShieldCheck size={13} />}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="grid gap-1 text-xs font-bold text-text-secondary">
            交付备注
            <textarea value={appValue(drafts, app, 'notes')} onChange={event => update({ notes: event.target.value })} rows={2} placeholder="记录客户选择：共存/新号、测试手机号、异常处理、下次跟进时间。" className="resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none" />
          </label>

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <button type="button" onClick={() => void onSave(app)} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:cursor-wait disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {saving ? '保存中' : '保存配置'}
            </button>
            {app.platform === 'meta' && app.tokenType === 'user_60d' && (
              <button type="button" onClick={() => void onSave({ ...app, status: 'needs_permanent_token' })} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                <KeyRound size={13} /> 标记待换永久 token
              </button>
            )}
            <button type="button" onClick={() => void onComplete(app)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">
              <CheckCircle2 size={13} /> 交付完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


export { DeploymentProgressStrip, PlatformWizard, keyOf, appFor, jsonFetch };
export type { DeliveryApp, TenantCard, GeneratedInvite, Draft, TestState, AssistLinkState, ProgressStageKey, KnowledgeCompletionState };
