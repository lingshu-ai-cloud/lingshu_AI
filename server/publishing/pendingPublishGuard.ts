import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../storage/index.js';
import type { PostRecord } from './waLink.js';
const object = (value: unknown): Record<string, any> => {
  if (typeof value === 'string') { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
};
export function publishingMutationBlocked(post: PostRecord): boolean {
  const stats = object(post.stats);
  return ['publishing', 'needs_attention', 'finalize_pending'].includes(String(stats.status))
    || Object.values(object(stats.publishResults)).some((result: any) => ['in_flight', 'unknown'].includes(result.status));
}
function file(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { return value.startsWith('file://') ? fileURLToPath(value) : path.resolve(value); } catch { return value; }
}
/** Guards manual/duplicate submissions against an already unresolved delivery.
 * The current scheduler may enter only with its server-created attempt token. */
export async function assertNoUnresolvedPublishing(input: {
  tenantId: string; platform: string; accountIds: string[]; contentId?: string; videoPath?: string; videoUrl?: string;
  currentPostId?: string; currentAttemptId?: string;
}): Promise<void> {
  for (let page = 1; ; page++) {
    const posts = await store.list<PostRecord>('posts', { where: { tenant_id: input.tenantId }, page, perPage: 500 });
    for (const post of posts.items) {
      if (post.tenant_id !== input.tenantId || post.platform !== input.platform || !publishingMutationBlocked(post)) continue;
      const stats = object(post.stats), results = object(stats.publishResults);
      const sameSource = (input.contentId && input.contentId === post.content_id)
        || (input.videoPath && file(input.videoPath) === file(stats.videoPath))
        || (input.videoUrl && input.videoUrl === stats.videoUrl);
      if (!sameSource && input.currentPostId !== post.id) continue;
      const targets = Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds.map(String) : Object.keys(results);
      if (input.accountIds.length && targets.length && !targets.some((id: string) => input.accountIds.includes(id))) continue;
      if (input.currentPostId === post.id && input.currentAttemptId && input.accountIds.length === 1
        && results[input.accountIds[0]]?.status === 'in_flight' && results[input.accountIds[0]]?.attemptId === input.currentAttemptId) continue;
      throw Object.assign(new Error('该视频已有待核对的发布尝试，请先恢复平台回执，禁止重复提交'), { statusCode: 409 });
    }
    if (!posts.items.length || page >= posts.totalPages) return;
  }
}
