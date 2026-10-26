import { AdProviderError, type MetaAdsAdapter, type MetaVideoInput } from './metaAdapter.js';
import { readAuthorizationEdge } from './metaAuthorization.js';
/** Validate destination ownership before any creation; never create or modify lead assets. */
export async function assertMetaLeadAssets(adapter: MetaAdsAdapter, pageAdapter: MetaAdsAdapter, accountId: string, input: MetaVideoInput, goal: string | boolean) {
  if (goal === '获取Meta表单线索') {
    const page = await pageAdapter.request(input.pageId, { fields: 'id,leadgen_tos_accepted' });
    if (String(page.id) !== input.pageId || page.leadgen_tos_accepted !== true) throw new AdProviderError('请在 Meta 主页完成即时表单线索广告条款，再创建表单广告', 'LEAD_TERMS_REQUIRED');
    const forms = await readAuthorizationEdge(pageAdapter, `${input.pageId}/leadgen_forms`, 'id,status');
    if (!forms.some(f => String(f.id) === input.leadFormId && f.status === 'ACTIVE')) throw new AdProviderError('表单不属于所选主页、未发布或不可用，请核对已有即时表单及主页线索广告条款', 'LEAD_FORM_UNAVAILABLE');
  }
  if (goal === '获取独立站询盘') {
    const pixels = await readAuthorizationEdge(adapter, `act_${accountId}/adspixels`, 'id,name');
    if (!pixels.some(p => String(p.id) === input.pixelId)) throw new AdProviderError('Pixel 不在当前广告账户可用资产中，请先分配数据源并配置网站 Lead 事件', 'PIXEL_UNAVAILABLE');
  }
  if (goal === '获取消息会话' && input.messageDestination !== 'MESSENGER') {
    const page = await pageAdapter.request(input.pageId, { fields: input.messageDestination === 'WHATSAPP' ? 'id,whatsapp_number' : 'id,instagram_business_account{id,username}' });
    const phone = (s: unknown) => String(s || '').replace(/\D/g, '');
    if (String(page.id) !== input.pageId || (input.messageDestination === 'WHATSAPP' ? phone(page.whatsapp_number) !== phone(input.whatsappPhoneNumber) : (String(page.instagram_business_account?.id) !== input.instagramActorId || String(page.instagram_business_account?.username).toLowerCase() !== input.instagramUsername?.toLowerCase()))) throw new AdProviderError('消息目的地未与所选 Facebook 主页关联，请先核对 WhatsApp 号码或 Instagram 专业账户', 'MESSAGE_DESTINATION_UNAVAILABLE');
  }
}
