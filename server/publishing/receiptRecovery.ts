import axios from 'axios';
import { store } from '../storage/index.js';
import { getAccessToken, type YouTubeConfig } from '../integrations/youtube.js';
import { withDigitalEmployeeRunLock } from '../digitalEmployees/runControl.js';
import type { PostRecord } from './waLink.js';

export type PublishingReceiptEvidence = { id: string; channelId: string; ownedChannelIds: string[]; description: string; publishedAt: string; privacyStatus: string };
type Lookup = (tenantId: string, accountId: string, platformPostId: string) => Promise<PublishingReceiptEvidence>;
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

async function lookupYouTube(tenantId: string, accountId: string, platformPostId: string): Promise<PublishingReceiptEvidence> {
  const account = await store.getById<YouTubeConfig & { id: string; tenantId: string }>('youtube_accounts', accountId);
  if (!account || account.tenantId !== tenantId) throw new Error('发布账号不属于当前租户');
  const token = await getAccessToken(account);
  const config = { headers: { Authorization: `Bearer ${token}` }, timeout: 20_000 };
  const [videoResponse, channelsResponse] = await Promise.all([
    axios.get('https://www.googleapis.com/youtube/v3/videos', { ...config, params: { part: 'snippet,status', id: platformPostId } }),
    axios.get('https://www.googleapis.com/youtube/v3/channels', { ...config, params: { part: 'id', mine: true, maxResults: 50 } }),
  ]);
  const video = videoResponse.data?.items?.find((row: { id: string }) => row.id === platformPostId);
  if (!video) throw new Error('平台未找到该视频；保持结果不明，不会重发');
  return { id: video.id, channelId: video.snippet?.channelId, ownedChannelIds: (channelsResponse.data?.items || []).map((row: { id: string }) => row.id), description: video.snippet?.description || '', publishedAt: video.snippet?.publishedAt || '', privacyStatus: video.status?.privacyStatus || '' };
}

/** Read provider evidence only. Never interprets a user supplied ID as a receipt. */
export async function recoverPublishingReceipt(input: { tenantId: string; postId: string; accountId: string; attemptId: string; platformPostId: string }, lookup: Lookup = lookupYouTube): Promise<PostRecord> {
  const post = await store.getById<PostRecord>('posts', input.postId);
  if (!post || post.tenant_id !== input.tenantId) throw new Error('发布记录不存在');
  return withDigitalEmployeeRunLock(input.tenantId, String(object(post.stats).workflowRunId || `publishing-recovery:${post.id}`), async () => {
    const current = await store.getById<PostRecord>('posts', input.postId);
    if (!current || current.tenant_id !== input.tenantId) throw new Error('发布记录不存在');
    const stats = object(current.stats), results = { ...object(stats.publishResults) }, attempt = object(results[input.accountId]);
    if (!input.attemptId || attempt.attemptId !== input.attemptId) throw new Error('发送尝试已变化，请重新核对');
    if (attempt.status === 'published' && attempt.platformPostId === input.platformPostId) return current;
    if (!['in_flight', 'unknown'].includes(attempt.status)) throw new Error('该账号没有待核对的未知发送尝试');
    if (attempt.status === 'in_flight' && Date.parse(attempt.startedAt) + 15 * 60_000 > Date.now()) throw new Error('发送尚在执行，请等待后核对');
    if (current.platform !== 'youtube') throw new Error('当前平台尚不支持可信回执查询，保持待核对且禁止自动重发');
    if (!/^[\w-]{1,128}$/.test(input.platformPostId)) throw new Error('平台视频 ID 无效');
    const statsSnapshot = JSON.stringify(current.stats);
    const evidence = await lookup(input.tenantId, input.accountId, input.platformPostId);
    const started = Date.parse(attempt.startedAt), published = Date.parse(evidence.publishedAt);
    if (evidence.id !== input.platformPostId || !evidence.channelId || !evidence.ownedChannelIds.includes(evidence.channelId)
      || !current.wa_link || !evidence.description.includes(current.wa_link)
      || evidence.privacyStatus !== 'public' || !Number.isFinite(started) || !Number.isFinite(published)
      || published < started - 60_000 || published > started + 24 * 60 * 60_000) {
      throw new Error('平台证据与账号、跟踪链接或发送时间不匹配，未补写成功');
    }
    // Re-read after network I/O. Never overwrite a changed attempt/version.
    const fresh = await store.getById<PostRecord>('posts', current.id);
    if (!fresh || JSON.stringify(fresh.stats) !== statsSnapshot) throw new Error('发布记录核对期间已变化，请重试');
    results[input.accountId] = { ...attempt, status: 'published', platformPostId: evidence.id, publishedAt: evidence.publishedAt, recoveredAt: new Date().toISOString(), evidenceSource: 'youtube.videos.list+channels.list', error: '' };
    const targets = Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds.map(String) : [];
    const complete = targets.length > 0 && targets.every((id: string) => results[id]?.status === 'published');
    const unknown = Object.values(results).some((result: any) => ['unknown', 'in_flight'].includes(result.status));
    const updatedStats = { ...stats, publishResults: results, status: complete ? 'finalize_pending' : unknown ? 'needs_attention' : 'scheduled', nextPublishAttemptAt: '', publishError: '' };
    if (!await store.update('posts', current.id, { stats: updatedStats })) throw new Error('恢复回执保存失败');
    return { ...current, stats: updatedStats };
  });
}
