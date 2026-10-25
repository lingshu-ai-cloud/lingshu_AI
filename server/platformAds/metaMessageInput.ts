import type { PlatformAdTask } from './tasks.js';
import { getMetaDestinationAssets } from './metaDestinationAssets.js';
import { normalizeMetaMessageChoice } from '../../shared/metaMessageChoice.js';
import { AdProviderError } from './metaAdapter.js';
/** Resolve saved recipient using existing authorization directory; never switch the chosen channel. */
export async function resolveSavedMetaMessage(tenantId: string, task: PlatformAdTask, connectionId: string, raw: unknown, read = getMetaDestinationAssets): Promise<unknown> {
  if (task.goal !== '获取消息会话' || !task.configuration.metaMessage) return raw;
  let choice;
  try { choice = normalizeMetaMessageChoice(task.configuration.metaMessage)!; }
  catch { throw new AdProviderError('已保存的聊天渠道配置无效，请编辑计划重新确认', 'INVALID_INPUT'); }
  if (!choice.destination) throw new AdProviderError('请在计划中选择接收客户咨询的聊天渠道', 'MESSAGE_DESTINATION_REQUIRED');
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (input.pageId && input.pageId !== choice.pageId || input.messageDestination && input.messageDestination !== choice.destination) throw new AdProviderError('聊天渠道或主页与已保存计划不同，请先编辑计划再确认', 'MESSAGE_DESTINATION_CHANGED');
  const assets = await read(tenantId, connectionId, { pageId: choice.pageId, kind: 'messages' });
  const recipient = choice.destination === 'MESSENGER' ? choice.pageId : choice.destination === 'WHATSAPP' ? assets.whatsappPhoneNumber : assets.instagram?.id || '';
  if (!recipient || recipient.replace(/\D/g, '') !== choice.recipientId.replace(/\D/g, '')) throw new AdProviderError('已确认的聊天接收账号已变更或不可用，请重新同步并编辑计划确认；不会自动切换渠道', 'MESSAGE_RECIPIENT_CHANGED');
  return { ...input, pageId: choice.pageId, messageDestination: choice.destination, whatsappPhoneNumber: assets.whatsappPhoneNumber, instagramActorId: assets.instagram?.id || '', instagramUsername: assets.instagram?.username || '' };
}
