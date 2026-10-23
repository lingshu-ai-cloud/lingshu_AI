import { authHeader } from './auth';

declare global {
  interface Window {
    FB?: { init: (options: Record<string, unknown>) => void;
      login: (callback: (response: { authResponse?: { code?: string }; status?: string }) => void, options: Record<string, unknown>) => void };
    fbAsyncInit?: () => void;
  }
}
export interface WhatsAppSignupConfig {
  appId: string; configId: string; tenantId: string; graphVersion: string;
  signupMode: 'standard' | 'coexistence'; configured: boolean; storageReady: boolean; connected: boolean;
  account: null | { phoneNumber: string; phoneNumberId: string; wabaId: string; status: string; tokenExpiresAt: string; legacy: boolean };
}
export interface PreparedWhatsAppSignup { config: WhatsAppSignupConfig; state: string; expiresAt: number; authorization: string }
const SDK_ID = 'facebook-jssdk';
let sdkPromise: Promise<void> | null = null;
let signupActive = false;
function loadSdk(): Promise<void> {
  if (window.FB) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Meta 授权组件加载超时，请刷新重试。')), 15_000);
    window.fbAsyncInit = () => { window.clearTimeout(timeout); resolve(); };
    if (document.getElementById(SDK_ID)) return;
    const script = document.createElement('script'); script.id = SDK_ID; script.async = true; script.defer = true;
    script.crossOrigin = 'anonymous'; script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.onerror = () => { window.clearTimeout(timeout); reject(new Error('Meta 授权组件加载失败，请刷新重试。')); };
    document.body.appendChild(script);
  });
  return sdkPromise;
}
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/oauth/whatsapp/${path}`, { signal: AbortSignal.timeout(90_000), method: body === undefined ? 'GET' : 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) {
    const messages: Record<string, string> = {
      whatsapp_admin_required: '请由企业管理员连接号码。',
      whatsapp_platform_not_configured: '平台配置尚未完成，请联系管理员。',
      whatsapp_atomic_storage_required: '平台接入存储尚未就绪，请联系管理员。',
      whatsapp_existing_meta_app_conflict: '现有 Meta 应用与平台应用不同，请联系管理员安排迁移。',
      whatsapp_number_change_requires_migration: '该企业已绑定其他号码，请先安排号码迁移。',
      whatsapp_account_change_requires_migration: '该企业已绑定其他 WhatsApp 企业账户，请先安排迁移。',
      whatsapp_asset_owned_by_foreign_tenant: '该号码或企业账户已绑定其他企业，请联系管理员核对。',
      whatsapp_signup_session_invalid: '授权准备已失效，请重新开始连接。',
      whatsapp_phone_registration_required: '号码尚未完成 Cloud API 注册，请先在 Meta 后台完成注册，再重新授权。',
      whatsapp_token_expired: 'Meta 授权已失效，请重新开始连接。',
      whatsapp_binding_busy: '另一个企业正在完成连接，请稍后重新开始。',
    };
    throw new Error(messages[data.error] || 'WhatsApp 连接未完成，请重新授权；持续失败时请联系管理员。');
  }
  return data;
}
export async function getWhatsAppEmbeddedSignupConfig(): Promise<WhatsAppSignupConfig> { return api('config'); }
/** Prepare first, then call login directly from the next user click to preserve browser popup permission. */
export async function prepareWhatsAppEmbeddedSignup(config: WhatsAppSignupConfig): Promise<PreparedWhatsAppSignup> {
  if (!config.configured || !config.storageReady) throw new Error('平台接入尚未就绪，请联系管理员。');
  const authorization = authHeader().Authorization || '';
  await loadSdk();
  const session = await api('session', {});
  if (authorization !== authHeader().Authorization || session.tenantId !== config.tenantId) throw new Error('登录身份已变化，请重新开始连接。');
  window.FB!.init({ appId: config.appId, cookie: true, xfbml: false, version: config.graphVersion });
  return { config, state: session.state, expiresAt: session.expiresAt, authorization };
}
export function startWhatsAppEmbeddedSignup(prepared: PreparedWhatsAppSignup): Promise<{ ok: boolean }> {
  if (signupActive || !window.FB || Date.now() >= prepared.expiresAt || prepared.authorization !== authHeader().Authorization)
    return Promise.reject(new Error('授权准备已失效，请重新开始连接。'));
  signupActive = true;
  return new Promise((resolve, reject) => {
    let code = '', sessionInfo: Record<string, unknown> | undefined, exchanging = false, settled = false;
    const cleanup = () => { settled = true; signupActive = false; window.clearTimeout(timer); window.removeEventListener('message', onMessage); };
    const fail = (message: string) => { if (settled) return; cleanup(); reject(new Error(message)); };
    const exchange = () => {
      if (settled || !code || !sessionInfo || exchanging) return;
      if (prepared.authorization !== authHeader().Authorization) { fail('登录身份已变化，请重新开始连接。'); return; }
      exchanging = true; window.clearTimeout(timer);
      void api('exchange', { code, sessionInfo, state: prepared.state }).then(data => { cleanup(); resolve(data); }, error => { cleanup(); reject(error); });
    };
    const onMessage = (event: MessageEvent) => {
      if (settled || exchanging) return;
      if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return;
      let value: any;
      try { value = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (value?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (['CANCEL', 'ERROR'].includes(value.event)) { fail('Meta 授权未完成，请重新开始连接。'); return; }
      if (value.event !== 'FINISH') return;
      const data = value.data;
      if (!/^\d{1,64}$/.test(String(data?.waba_id || '')) || !/^\d{1,64}$/.test(String(data?.phone_number_id || ''))) return;
      sessionInfo = data; exchange();
    };
    const timer = window.setTimeout(() => fail('Meta 授权超时，请重新开始连接。'), 120_000);
    window.addEventListener('message', onMessage);
    try {
      window.FB!.login(response => {
        if (settled || exchanging) return;
        if (!response.authResponse?.code) { fail('Meta 授权已取消，请重新开始连接。'); return; }
        code = response.authResponse.code; exchange();
      }, { config_id: prepared.config.configId, response_type: 'code', override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '3',
          ...(prepared.config.signupMode === 'coexistence' ? { featureType: 'whatsapp_business_app_onboarding' } : {}) } });
    } catch { fail('无法打开 Meta 授权窗口，请重新开始连接。'); }
  });
}
export async function disconnectWhatsApp(): Promise<void> { await api('disconnect', {}); }

export async function verifyWhatsAppConnection(): Promise<{ connected: boolean }> { return api('verify', {}); }
