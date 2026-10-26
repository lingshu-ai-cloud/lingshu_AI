import type { DataStore, Record_ } from '../storage/datastore.js';

/** Derive history from durable messages/receipts, never from a client timer or an acknowledgement. */
export async function mobileAssistantHistory(store: DataStore, session: Record_) {
  const list = await store.list<Record_>('mobile_assistant_messages', {
    where: { tenant_id: String(session.tenantId), user_id: String(session.userId), session_id: session.id },
    sort: '-created_at', page: 1, perPage: 100,
  });
  const rows = list.items.filter(row => row.tenant_id === session.tenantId && row.user_id === session.userId && row.session_id === session.id);
  const user = rows.find(row => row.role === 'user');
  const answer = user && rows.find(row => row.role === 'assistant' && !row.command_id && row.client_message_id === `${user.client_message_id}:answer` && String(row.text || '').trim());
  let status = !user ? 'empty' : answer ? 'completed' : Date.now() - Date.parse(String(user.created_at)) < 90000 ? 'processing' : 'unconfirmed';
  let resultMessageId = answer ? String(answer.id) : '';
  const command = rows.find(row => row.command_id);
  if (command && (!user || String(command.created_at) >= String(user.created_at))) {
    const receipt = await store.getById<Record_>('mobile_workbench_action_receipts', String(command.command_id));
    if (receipt && receipt.tenant_id === session.tenantId && receipt.user_id === session.userId) {
      status = receipt.status === 'succeeded' ? 'completed' : receipt.status === 'failed' ? 'failed' : receipt.status === 'cancelled' ? 'cancelled' : receipt.status === 'waiting_user' ? 'waiting_user' : 'processing';
      resultMessageId = receipt.status === 'succeeded' ? `${command.id}:succeeded` : '';
    }
  }
  return {
    title: session.title === '新对话' && user ? String(user.text).slice(0, 40) : session.title,
    status, resultMessageId, updatedAt: rows[0]?.created_at || session.updatedAt || session.createdAt,
  };
}
