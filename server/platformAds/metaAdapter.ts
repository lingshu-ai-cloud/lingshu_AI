import { metaAdObjective, type MetaLeadConfiguration } from '../../shared/metaAdObjectives.js';
import { assertMetaLeadAssets } from './metaLeadAssets.js';
import { buildMetaTargeting, normalizeMetaTargeting, type MetaTargeting } from '../../shared/metaTargeting.js';
/** Meta Graph transport. Never accepts caller-supplied hosts or logs provider bodies. */
export class AdProviderError extends Error {
  constructor(message: string, public readonly code = 'PROVIDER_ERROR', public readonly uncertain = false) { super(message); }
}
export function metaAccountId(value: string): string {
  const id = value.replace(/^act_/, '');
  if (!/^\d+$/.test(id)) throw new AdProviderError('广告账户 ID 无效', 'INVALID_INPUT');
  return id;
}
export class MetaAdsAdapter {
  constructor(
    private token: string,
    private transport: typeof fetch = fetch,
    private beforeProviderWrite?: () => Promise<void>,
  ) {}
  async request(path: string, params: Record<string, unknown> = {}, method: 'GET' | 'POST' = 'GET'): Promise<any> {
    if (!['me/accounts', 'me/adaccounts', 'search'].includes(path) && !/^(?:act_)?\d+(?:\/[a-z_]+)?$/.test(path)) throw new AdProviderError('广告资源路径无效', 'INVALID_INPUT');
    const version = process.env.META_ADS_API_VERSION;
    if (!version || !/^v\d+\.0$/.test(version)) throw new AdProviderError('请配置 META_ADS_API_VERSION', 'NOT_CONFIGURED');
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    if (method === 'GET') url.search = body.toString();
    if (method === 'POST') await this.beforeProviderWrite?.();
    let response: Response;
    try { response = await this.transport(url, { method, headers: { Authorization: `Bearer ${this.token}` }, body: method === 'POST' ? body : undefined, signal: AbortSignal.timeout(30000) }); }
    catch { throw new AdProviderError('广告平台请求超时或网络异常', 'NETWORK_ERROR', method === 'POST'); }
    let data: any;
    try { data = await response.json(); } catch { throw new AdProviderError('广告平台返回无法解析的结果', 'INVALID_RESPONSE', method === 'POST'); }
    if (!response.ok || data.error) {
      const code = Number.isSafeInteger(data.error?.code) ? data.error.code : response.status;
      const subcode = Number.isSafeInteger(data.error?.error_subcode) ? ` / ${data.error.error_subcode}` : '';
      // Keep Meta's actionable field/permission diagnostic, never its credentials
      // or credential-bearing URLs. Numeric code/subcode remain stable.
      const diagnostic = String(data.error?.error_user_msg || data.error?.message || '')
        .split(this.token).join('[redacted]')
        .replace(/https?:\/\/[^\s<>]+/gi, '[URL]')
        .replace(/EAA[A-Za-z0-9_-]{20,}/g, '[redacted]')
        .replace(/(?:access_token|client_secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500);
      throw new AdProviderError(`广告平台拒绝请求（${code}${subcode}）${diagnostic ? `：${diagnostic}` : ''}`, String(code), method === 'POST' && (response.status >= 500 || response.status === 408));
    }
    return data;
  }
  account(id: string) { return this.request(`act_${metaAccountId(id)}`, { fields: 'id,account_id,name,business_name,currency,account_status,timezone_id,timezone_name,timezone_offset_hours_utc,min_campaign_group_spend_cap,min_daily_budget' }); }
  /** Resolve only the selected Page's existing grant. Never persist or expose it. */
  async pageCreativeAdapter(pageId: string) {
    if (!/^\d+$/.test(pageId)) throw new AdProviderError('主页 ID 无效', 'INVALID_INPUT');
    const page = await this.request(pageId, { fields: 'id,access_token' });
    if (String(page.id) !== pageId || typeof page.access_token !== 'string' || !page.access_token) throw new AdProviderError('未取得所选主页的广告素材访问令牌，请核对主页授权', 'PAGE_AUTH_REQUIRED');
    return new MetaAdsAdapter(page.access_token, this.transport, this.beforeProviderWrite);
  }
  campaigns(id: string) { return this.request(`act_${metaAccountId(id)}/campaigns`, { fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget', limit: 100 }); }
  async assertOwnership(accountId: string, objectId: string) {
    const object = await this.request(objectId, { fields: 'account_id' });
    if (String(object.account_id) !== metaAccountId(accountId)) throw new AdProviderError('广告资源不属于授权账户', 'ACCOUNT_MISMATCH');
  }
  createPausedCampaign(accountId: string, input: { name: string; objective: string }) {
    return this.request(`act_${metaAccountId(accountId)}/campaigns`, { ...input, status: 'PAUSED', special_ad_categories: [] }, 'POST');
  }
  async setCampaignStatus(accountId: string, campaignId: string, status: 'ACTIVE' | 'PAUSED') {
    await this.assertOwnership(accountId, campaignId);
    return this.request(campaignId, { status }, 'POST');
  }
  async setDailyBudget(accountId: string, objectId: string, minorUnits: number) {
    if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) throw new AdProviderError('预算须为正整数最小货币单位', 'INVALID_INPUT');
    await this.assertOwnership(accountId, objectId);
    return this.request(objectId, { daily_budget: minorUnits }, 'POST');
  }
  async createPausedVideoTraffic(accountId: string, name: string, input: MetaVideoInput, totalBudget: number, onCreated: (kind: string, id: string) => Promise<void>, goal: string | boolean = false, channels = ['Facebook', 'Instagram'], schedule: { startsAt?: string; endsAt?: string } = {}) {
    const account = `act_${metaAccountId(accountId)}`;
    input = validateMetaVideoInput(input, totalBudget, goal);
    const targeting = buildMetaTargeting(input.countries, channels, input.targeting);
    const spec = metaAdObjective(goal, input.messageDestination);
    const lead = goal === '获取Meta表单线索', message = goal === '获取消息会话', websiteLead = goal === '获取独立站询盘';
    const promotedObject = message ? { page_id: input.pageId, ...(input.messageDestination === 'WHATSAPP' ? { whatsapp_phone_number: input.whatsappPhoneNumber } : input.messageDestination === 'INSTAGRAM_DIRECT' ? { instagram_actor_id: input.instagramActorId } : {}) } : lead ? { page_id: input.pageId } : websiteLead ? { pixel_id: input.pixelId, custom_event_type: 'LEAD' } : undefined;
    const cta = spec.destinationType === 'ON_VIDEO' ? undefined : lead ? { type: 'SIGN_UP', value: { lead_gen_form_id: input.leadFormId } } : message ? { type: input.messageDestination === 'WHATSAPP' ? 'WHATSAPP_MESSAGE' : 'MESSAGE_PAGE', value: input.messageDestination === 'WHATSAPP' ? { whatsapp_number: input.whatsappPhoneNumber, link: `https://wa.me/${input.whatsappPhoneNumber!.replace(/\D/g, '')}` } : { link: input.messageDestination === 'MESSENGER' ? `https://m.me/${input.pageId}` : `https://ig.me/m/${input.instagramUsername}` } } : { type: 'LEARN_MORE', value: { link: input.linkUrl } };
    // Account token manages the delivery hierarchy; unpublished Page stories
    // use the selected Page identity. Resolve before creating any resources.
    const creativeAdapter = await this.pageCreativeAdapter(input.pageId);
    await assertMetaLeadAssets(this, creativeAdapter, metaAccountId(accountId), input, goal);
    const create = async (kind: string, edge: string, params: Record<string, unknown>) => {
      const result = await (kind === 'creativeId' || kind === 'adId' ? creativeAdapter : this).request(`${account}/${edge}`, params, 'POST');
      if (!/^\d+$/.test(String(result.id || ''))) throw new AdProviderError('平台创建结果缺少资源 ID', 'INVALID_RESPONSE', true);
      await onCreated(kind, String(result.id));
      return String(result.id);
    };
    const campaignId = await create('campaignId', 'campaigns', { name, objective: spec.objective, status: 'PAUSED', spend_cap: Math.round(totalBudget * 100), special_ad_categories: [], is_adset_budget_sharing_enabled: false });
    const adsetId = await create('adsetId', 'adsets', { name: `${name} · 视频`, campaign_id: campaignId, status: 'PAUSED', daily_budget: Math.round(input.dailyBudget * 100), start_time: schedule.startsAt || undefined, end_time: schedule.endsAt || undefined, billing_event: 'IMPRESSIONS', optimization_goal: spec.optimizationGoal, destination_type: spec.destinationType, ...(promotedObject ? { promoted_object: promotedObject } : {}), bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting });
    const creativeId = await create('creativeId', 'adcreatives', { name: `${name} · 视频`, object_story_spec: { page_id: input.pageId, ...(message && input.messageDestination === 'INSTAGRAM_DIRECT' ? { instagram_actor_id: input.instagramActorId } : {}), video_data: { video_id: input.videoId, image_url: input.imageUrl, message: input.message, ...(cta ? { call_to_action: cta } : {}) } } });
    const adId = await create('adId', 'ads', { name, adset_id: adsetId, creative: { creative_id: creativeId }, status: 'PAUSED' });
    return { campaignId, adsetId, creativeId, adId };
  }
}
export type MetaVideoInput = { pageId: string; videoId: string; imageUrl: string; linkUrl: string; message: string; countries: string[]; dailyBudget: number; instagramUsername?: string; targeting?: MetaTargeting } & MetaLeadConfiguration;
export function validateMetaVideoInput(value: unknown, maxBudget: number, goal: string | boolean = false): MetaVideoInput {
  let spec: ReturnType<typeof metaAdObjective>;
  try { spec = metaAdObjective(goal); } catch { throw new AdProviderError('当前 Meta 创编目标不受支持', 'UNSUPPORTED_OBJECTIVE'); }
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const pageId = String(raw.pageId || ''), videoId = String(raw.videoId || '');
  if (!/^\d+$/.test(pageId) || !/^\d+$/.test(videoId)) throw new AdProviderError('主页或投放视频尚未关联，请同步账户并确认投放素材', 'INVALID_INPUT');
  const imageUrl = String(raw.imageUrl || ''), linkUrl = String(raw.linkUrl || '');
  const needsLink = spec.destinationType === 'WEBSITE';
  for (const value of needsLink || linkUrl ? [imageUrl, linkUrl] : [imageUrl]) {
    try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
    catch { throw new AdProviderError('缩略图及落地页须为有效 HTTPS 地址', 'INVALID_INPUT'); }
  }
  const countries = Array.isArray(raw.countries) ? [...new Set(raw.countries.map(String))] : [];
  if (!countries.length || countries.length > 50 || countries.some(x => !/^[A-Z]{2}$/.test(x))) throw new AdProviderError('请提供有效国家代码', 'INVALID_INPUT');
  const dailyBudget = Number(raw.dailyBudget);
  if (!Number.isFinite(dailyBudget) || dailyBudget < 1 || dailyBudget > maxBudget) throw new AdProviderError('日预算超出任务预算', 'INVALID_INPUT');
  if (!Number.isSafeInteger(Math.round(maxBudget * 100)) || Math.abs(maxBudget * 100 - Math.round(maxBudget * 100)) > 1e-7 || Math.abs(dailyBudget * 100 - Math.round(dailyBudget * 100)) > 1e-7) throw new AdProviderError('Meta 预算最多两位小数，不会静默四舍五入', 'INVALID_INPUT');
  const extra: MetaLeadConfiguration & { instagramUsername?: string } = {};
  const id = (key: string) => { if (typeof raw[key] !== 'string' || !/^\d+$/.test(raw[key] as string)) throw new AdProviderError(`${({ leadFormId: '获客表单', pixelId: '网站数据源', instagramActorId: 'Instagram 账户' } as Record<string, string>)[key] || '平台资产'}尚未关联，请同步可用资产后重试`, 'INVALID_INPUT'); return raw[key] as string; };
  if (goal === '获取Meta表单线索') extra.leadFormId = id('leadFormId');
  if (goal === '获取独立站询盘') extra.pixelId = id('pixelId');
  if (goal === '获取消息会话') {
    if (!['WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT'].includes(String(raw.messageDestination))) throw new AdProviderError('请选择消息目的地', 'INVALID_INPUT');
    extra.messageDestination = raw.messageDestination as MetaLeadConfiguration['messageDestination'];
    if (extra.messageDestination === 'WHATSAPP') {
      if (typeof raw.whatsappPhoneNumber !== 'string' || !/^\+?[1-9]\d{6,14}$/.test(raw.whatsappPhoneNumber)) throw new AdProviderError('WhatsApp 号码须含国家码（7–15 位数字）', 'INVALID_INPUT');
      extra.whatsappPhoneNumber = raw.whatsappPhoneNumber;
    }
    if (extra.messageDestination === 'INSTAGRAM_DIRECT') { extra.instagramActorId = id('instagramActorId'); if (typeof raw.instagramUsername !== 'string' || !/^[A-Za-z0-9_.]{1,30}$/.test(raw.instagramUsername)) throw new AdProviderError('请填写 Instagram 用户名', 'INVALID_INPUT'); extra.instagramUsername = raw.instagramUsername; }
  }
  let targeting;
  try { targeting = normalizeMetaTargeting(raw.targeting); } catch (e) { throw new AdProviderError((e as Error).message, 'INVALID_INPUT'); }
  return { ...extra, pageId, videoId, imageUrl, linkUrl, countries, dailyBudget, message: String(raw.message || '').slice(0, 2000), ...(targeting ? { targeting } : {}) };
}
