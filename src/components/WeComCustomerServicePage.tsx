import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldAlert,
  UserRoundCheck,
} from 'lucide-react';
import { PAGE_REGISTRY } from '../pageRegistry';
import {
  createWeComReplyDraft,
  getWeComConnectionStatus,
  getWeComConversation,
  handoffWeComConversation,
  listWeComConversations,
  recoverWeComCallbacks,
  sendWeComReply,
  type WeComConnectionStatus,
  type WeComConversationDetail,
  type WeComConversationStatus,
  type WeComConversationSummary,
  type WeComReplyDraft,
} from '../lib/wecomCustomerService';

const STATUS_LABELS: Record<WeComConversationStatus | 'all', string> = {
  all: '全部',
  waiting_first_response: '待首次响应',
  draft_pending: '草稿待确认',
  in_progress: '处理中',
  waiting_customer: '待客户回复',
  human_required: '需人工接管',
  send_failed: '发送失败',
  resolved: '已解决',
};

function timeLabel(value?: string) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function connectionMeta(connection: WeComConnectionStatus | null) {
  if (!connection) return { tone: 'border-slate-200 bg-white text-slate-700', label: '正在读取连接状态' };
  if (connection.connected && connection.status === 'connected') {
    return { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', label: connection.label || '微信客服已连接' };
  }
  if (connection.status === 'degraded' || connection.status === 'error') {
    return { tone: 'border-amber-200 bg-amber-50 text-amber-900', label: connection.label || '微信客服连接需要处理' };
  }
  return { tone: 'border-slate-200 bg-slate-50 text-slate-700', label: connection.label || '微信客服尚未完成真实链路验收' };
}

export default function WeComCustomerServicePage() {
  const [connection, setConnection] = useState<WeComConnectionStatus | null>(null);
  const [conversations, setConversations] = useState<WeComConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<WeComConversationDetail | null>(null);
  const [filter, setFilter] = useState<WeComConversationStatus | 'all'>('all');
  const [instruction, setInstruction] = useState('');
  const [activeDraft, setActiveDraft] = useState<WeComReplyDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let nextConnection = await getWeComConnectionStatus();
      setConnection(nextConnection);
      if (nextConnection.status === 'unconfigured') {
        setConversations([]);
        setSelectedId('');
        return;
      }
      // Recovery is best-effort here: a busy callback lease must not block the
      // operator from reading conversations that are already durable.
      await recoverWeComCallbacks().catch(() => undefined);
      const [refreshedConnection, nextConversations] = await Promise.all([
        getWeComConnectionStatus(),
        listWeComConversations(filter === 'all' ? undefined : filter),
      ]);
      nextConnection = refreshedConnection;
      setConnection(nextConnection);
      setConversations(nextConversations);
      setSelectedId(current => current && nextConversations.some(item => item.id === current)
        ? current
        : (nextConversations[0]?.id || ''));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取企业微信客服');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadDetail = useCallback(async (conversationId: string) => {
    if (!conversationId) {
      setDetail(null);
      setActiveDraft(null);
      return;
    }
    setDetailLoading(true);
    setError('');
    try {
      const next = await getWeComConversation(conversationId);
      setDetail(next);
      setActiveDraft(next.drafts?.find(draft => draft.status === 'pending') || next.drafts?.[0] || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取会话详情');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadDetail(selectedId); }, [selectedId, loadDetail]);

  const selected = useMemo(
    () => conversations.find(item => item.id === selectedId) || detail?.conversation || null,
    [conversations, selectedId, detail],
  );
  const connectionView = connectionMeta(connection);

  const createDraft = async () => {
    if (!selectedId) return;
    setActing(true);
    setError('');
    setNotice('');
    try {
      const draft = await createWeComReplyDraft(selectedId, instruction);
      setActiveDraft(draft);
      setInstruction('');
      setNotice(draft.requiresHumanReview ? '草稿已生成，需要人工确认后发送。' : '低风险草稿已生成，请确认内容。');
      await loadDetail(selectedId);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '生成回复草稿失败');
    } finally {
      setActing(false);
    }
  };

  const sendDraft = async () => {
    if (!selectedId || !activeDraft) return;
    setActing(true);
    setError('');
    setNotice('');
    try {
      const result = await sendWeComReply({
        conversationId: selectedId,
        draftId: activeDraft.id,
        humanApproved: true,
      });
      setNotice(result.status === 'accepted'
        ? '企业微信已接收发送请求，最终送达状态等待平台事件确认。'
        : (result.message || '回复已提交。'));
      await Promise.all([loadOverview(), loadDetail(selectedId)]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '回复发送失败');
    } finally {
      setActing(false);
    }
  };

  const handoff = async () => {
    if (!selectedId) return;
    setActing(true);
    setError('');
    setNotice('');
    try {
      await handoffWeComConversation(selectedId);
      setNotice('已转入人工接管队列，自动发送已停止。');
      await Promise.all([loadOverview(), loadDetail(selectedId)]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '转人工失败');
    } finally {
      setActing(false);
    }
  };

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-surface-2 p-4 md:p-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold text-accent">客户咨询承接</p>
            <h1 className="mt-1 text-2xl font-black text-text-primary">{PAGE_REGISTRY.wecomCustomerService.canonicalTitle}</h1>
            <p className="mt-1 text-sm text-text-muted">AI 负责整理和起草，客服负责确认承诺与处理高风险问题。</p>
          </div>
          <button type="button" onClick={() => void loadOverview()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-text-secondary disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />刷新
          </button>
        </header>

        <section className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 md:flex-row md:items-center md:justify-between ${connectionView.tone}`}>
          <div className="flex items-start gap-3">
            {connection?.connected ? <CheckCircle2 size={20} className="mt-0.5 shrink-0" /> : <AlertCircle size={20} className="mt-0.5 shrink-0" />}
            <div>
              <p className="text-sm font-black">{connectionView.label}</p>
              <p className="mt-0.5 text-xs opacity-80">{connection?.reason || '只有完成真实消息接收、草稿、发送与回执链路后，状态才会显示为已连接。'}</p>
            </div>
          </div>
          <div className="flex gap-4 text-xs font-bold">
            <span>待处理 {connection?.pendingCount ?? 0}</span>
            <span>需人工 {connection?.humanRequiredCount ?? 0}</span>
            <span>同步 {connection?.lastSyncAt ? timeLabel(connection.lastSyncAt) : '尚未完成'}</span>
          </div>
        </section>

        {(error || notice) && (
          <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {error || notice}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(Object.entries(STATUS_LABELS) as Array<[WeComConversationStatus | 'all', string]>).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${filter === key ? 'border-accent bg-accent text-white' : 'border-border bg-white text-text-secondary'}`}>
              {label}
            </button>
          ))}
        </div>

        <section className="grid min-h-[620px] overflow-hidden rounded-2xl border border-border bg-white lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="border-b border-border lg:border-b-0 lg:border-r">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-text-muted"><Loader2 size={17} className="animate-spin" />正在读取会话</div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center"><MessageSquareText size={28} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-bold text-text-primary">当前没有会话</p><p className="mt-1 text-xs leading-5 text-text-muted">连接微信客服并完成真实入站消息后，会话会出现在这里。</p></div>
            ) : conversations.map(item => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full border-b border-border px-4 py-4 text-left hover:bg-surface-2 ${selectedId === item.id ? 'bg-[#edf4ef]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-black text-text-primary">{item.customerName || '微信客户'}</p>
                  <span className="shrink-0 text-[10px] text-text-muted">{timeLabel(item.lastMessageAt)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">{item.lastMessagePreview || '等待读取消息内容'}</p>
                <div className="mt-2 flex items-center gap-2 text-[10px] font-bold">
                  <span className={`rounded-full px-2 py-1 ${item.status === 'human_required' || item.status === 'send_failed' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{STATUS_LABELS[item.status] || item.status}</span>
                  {item.sourceTitle && <span className="truncate text-text-muted">来自：{item.sourceTitle}</span>}
                </div>
              </button>
            ))}
          </aside>

          <div className="flex min-w-0 flex-col">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-text-muted">选择左侧会话开始处理</div>
            ) : detailLoading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-text-muted"><Loader2 size={18} className="animate-spin" />正在读取消息</div>
            ) : (
              <>
                <div className="flex flex-col gap-3 border-b border-border px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-black text-text-primary">{selected.customerName || '微信客户'}</h2>
                    <p className="mt-1 text-xs text-text-muted">{selected.sourceTitle ? `来源内容：${selected.sourceTitle}` : '来源未知，不做猜测归因'}</p>
                  </div>
                  <button type="button" disabled={acting} onClick={() => void handoff()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800 disabled:opacity-50">
                    <UserRoundCheck size={14} />转人工接管
                  </button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-5 py-5">
                  {(detail?.messages ?? []).length === 0 ? (
                    <p className="py-10 text-center text-sm text-text-muted">尚未同步到可显示的消息</p>
                  ) : (detail?.messages ?? []).map(message => (
                    <div key={message.id} className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${message.direction === 'outbound' ? 'bg-emerald-700 text-white' : 'border border-border bg-white text-text-primary'}`}>
                        <p>{message.body || '暂不支持预览的消息类型'}</p>
                        <p className={`mt-1 text-[10px] ${message.direction === 'outbound' ? 'text-emerald-100' : 'text-text-muted'}`}>{timeLabel(message.sentAt)}{message.status ? ` · ${message.status}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border p-5">
                  {activeDraft ? (
                    <div className={`rounded-2xl border p-4 ${activeDraft.riskLevel === 'high' ? 'border-red-200 bg-red-50' : activeDraft.riskLevel === 'medium' ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          {activeDraft.requiresHumanReview ? <ShieldAlert size={17} className="text-amber-700" /> : <Bot size={17} className="text-emerald-700" />}
                          <p className="text-xs font-black text-text-primary">AI 回复草稿 · {activeDraft.riskLevel === 'high' ? '高风险' : activeDraft.riskLevel === 'medium' ? '需确认' : '低风险'}</p>
                        </div>
                        <span className="text-[10px] font-bold text-text-muted">尚未发送</span>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-primary">{activeDraft.body}</p>
                      {!!activeDraft.riskReasons?.length && <p className="mt-2 text-xs text-amber-800">需确认：{activeDraft.riskReasons.join('；')}</p>}
                      {!!activeDraft.knowledgeCitations?.length && <p className="mt-2 text-xs text-text-muted">依据：{activeDraft.knowledgeCitations.map(item => item.title).join('、')}</p>}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" disabled={acting} onClick={() => void sendDraft()} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-black text-white disabled:opacity-50"><Send size={13} />人工确认并发送</button>
                        <button type="button" disabled={acting} onClick={() => setActiveDraft(null)} className="rounded-xl border border-border bg-white px-4 py-2 text-xs font-black text-text-secondary disabled:opacity-50">放弃草稿</button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-bold text-text-secondary">补充回复要求（可选）</span>
                        <textarea value={instruction} onChange={event => setInstruction(event.target.value)} rows={3} placeholder="例如：先确认客户需要的规格，不要直接报价" className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-accent" />
                      </label>
                      <button type="button" disabled={acting || !connection?.connected} onClick={() => void createDraft()} className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-black text-white disabled:opacity-50">
                        {acting ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />}生成回复草稿
                      </button>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted"><Clock3 size={13} />发送仍受企业微信会话状态、48 小时窗口和条数限制；平台接收不等于最终送达。</div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
