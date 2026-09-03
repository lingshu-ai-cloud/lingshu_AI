import { getTenantPlatformApp } from '../lib/tenantPlatformApps.js';
import { store } from '../storage/index.js';
import { compareAndSetRecord } from '../digitalEmployees/reliableKernel.js';
import type { Where } from '../storage/datastore.js';
import { withPublishQueueProjection } from './publishQueueProjection.js';

export interface PostRecord {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  content_id?: string;
  platform: string;
  platform_post_id?: string;
  title?: string;
  published_at?: string;
  track_code: string;
  wa_link?: string;
  stats?: Record<string, unknown>;
  inquiries?: number;
  deals?: number;
  digital_employee_idempotency_key?: string;
  digital_employee_run_id?: string;
  digital_employee_approval_id?: string;
  digital_employee_action_hash?: string;
  digital_employee_fence_revision?: number;
  publish_lease_owner?: string;
  publish_lease_expires_at?: string;
  publish_revision?: number;
  reconciliation_required?: boolean;
  direct_publish_fence_key?: string;
  direct_publish_content_digest?: string;
  direct_publish_account_id?: string;
  publish_operation_id?: string;
  publish_operation_state?: string;
  publish_operation_quiesced_at?: string;
  publish_retry_not_before?: string;
  publish_queue_state?: 'pending' | 'direct' | 'blocked' | 'terminal' | '';
  publish_available_at?: string;
  created?: string;
  updated?: string;
}

export interface PostDraftInput {
  contentId?: string;
  platform: string;
  title?: string;
  language?: string;
  enabled?: boolean;
  digitalEmployeeIdempotencyKey?: string;
  directPublishFenceKey?: string;
  directPublishContentDigest?: string;
  directPublishAccountId?: string;
  directPublishRequestHash?: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanPhone(value: string): string {
  return value.replace(/[^\d]/g, '').replace(/^00/, '');
}

function platformLabel(platform: string): string {
  const normalized = platform.toLowerCase();
  if (normalized === 'youtube') return 'YouTube';
  if (normalized === 'tiktok') return 'TikTok';
  if (normalized === 'instagram') return 'Instagram';
  if (normalized === 'facebook') return 'Facebook';
  return platform || 'content';
}

function prefillText(language: string | undefined, code: string): string {
  const lang = text(language).toLowerCase();
  if (/es|spanish|西语|西班牙/.test(lang)) return `Hola, vi tu video [#${code}] y me interesa.`;
  if (/pt|portuguese|葡语|葡萄牙/.test(lang)) return `Ola, vi seu video [#${code}] e tenho interesse.`;
  return `Hi, I saw your video [#${code}] and I'm interested.`;
}

async function tenantWhatsAppNumber(tenantId: string): Promise<{ number: string; needsSetup: boolean }> {
  const app = await getTenantPlatformApp(tenantId, 'meta');
  const publicNumber = cleanPhone(text(app?.wa_public_number));
  if (publicNumber) return { number: publicNumber, needsSetup: false };
  const envNumber = cleanPhone(text(process.env[`WA_PUBLIC_NUMBER_${tenantId}`]) || text(process.env.WA_PUBLIC_NUMBER));
  if (envNumber) return { number: envNumber, needsSetup: false };
  return { number: cleanPhone(text(app?.phone_number_id)), needsSetup: true };
}

async function nextTrackCode(tenantId: string): Promise<string> {
  const result = await store.list<PostRecord>('posts', { where: { tenant_id: tenantId }, sort: '-track_code', perPage: 100 });
  const max = result.items.reduce((value, item) => {
    const match = text(item.track_code).match(/^V(\d{4})$/);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 999);
  if (max < 9999) return `V${Math.max(1000, max + 1)}`;
  // The normal path is monotonic. Only a tenant that exhausted V9999 needs a
  // bounded gap search; createIfAbsent below remains the final race guard.
  const used = new Set(result.items.map(item => text(item.track_code)).filter(Boolean));
  for (let page = 2; page <= result.totalPages; page += 1) {
    const records = await store.list<PostRecord>('posts', { where: { tenant_id: tenantId }, sort: '-track_code', page, perPage: result.perPage });
    for (const item of records.items) used.add(text(item.track_code));
  }
  for (let index = 1000; index <= 9999; index += 1) {
    const code = `V${index}`;
    if (!used.has(code)) return code;
  }
  throw new Error('track_code_exhausted');
}

export async function createTrackedPostDraft(
  tenantId: string,
  input: PostDraftInput,
): Promise<PostRecord & { trackingEnabled: boolean; needsWaNumberSetup: boolean }> {
  const enabled = input.enabled !== false;
  const now = new Date().toISOString();
  const wa = await tenantWhatsAppNumber(tenantId);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = await nextTrackCode(tenantId);
    const link = enabled && wa.number
      ? `https://wa.me/${wa.number}?text=${encodeURIComponent(prefillText(input.language, code))}`
      : '';
    const directPublishFenceKey = text(input.directPublishFenceKey);
    const uniqueWhere: Where = directPublishFenceKey
      ? { tenant_id: tenantId, direct_publish_fence_key: directPublishFenceKey }
      : { tenant_id: tenantId, track_code: code };
    const result = await store.createIfAbsent<PostRecord>('posts', uniqueWhere, {
      tenant_id: tenantId,
      content_id: text(input.contentId),
      platform: text(input.platform),
      platform_post_id: '',
      title: text(input.title),
      published_at: now,
      track_code: code,
      wa_link: link,
      stats: text(input.directPublishRequestHash)
        ? { directPublishRequestHash: text(input.directPublishRequestHash) }
        : {},
      inquiries: 0,
      deals: 0,
      digital_employee_idempotency_key: text(input.digitalEmployeeIdempotencyKey),
      digital_employee_run_id: '',
      digital_employee_approval_id: '',
      digital_employee_action_hash: '',
      digital_employee_fence_revision: 0,
      publish_lease_owner: '',
      publish_lease_expires_at: '',
      publish_revision: 0,
      reconciliation_required: false,
      direct_publish_fence_key: directPublishFenceKey,
      direct_publish_content_digest: text(input.directPublishContentDigest),
      direct_publish_account_id: text(input.directPublishAccountId),
      publish_queue_state: 'blocked',
      publish_available_at: '',
    });
    if (result.created) return { ...result.record, trackingEnabled: enabled, needsWaNumberSetup: wa.needsSetup };
  }
  throw new Error('post_track_record_create_conflict');
}

export function appendTrackedWaLink(platform: string, description: string, waLink: string): string {
  const body = text(description);
  if (!waLink) return body;
  const line = `WhatsApp inquiry: ${waLink}`;
  if (platform === 'youtube' || platform === 'facebook') return [line, body].filter(Boolean).join('\n\n');
  return [body, line].filter(Boolean).join('\n\n');
}

export async function finalizeTrackedPost(postId: string, patch: { platformPostId?: string; stats?: Record<string, unknown>; title?: string }): Promise<void> {
  const current = await store.getById<PostRecord>('posts', postId);
  const currentStats = current?.stats && typeof current.stats === 'object' && !Array.isArray(current.stats)
    ? current.stats
    : {};
  const update: Record<string, unknown> = {
    platform_post_id: text(patch.platformPostId),
    stats: { ...currentStats, ...(patch.stats ?? {}), status: text(patch.stats?.status) || 'published' },
    published_at: new Date().toISOString(),
  };
  const title = text(patch.title);
  if (title) update.title = title;
  await store.update('posts', postId, withPublishQueueProjection(current || {}, update));
}

export async function findPostByTrackCode(tenantId: string, code: string): Promise<PostRecord | null> {
  const result = await store.list<PostRecord>('posts', { where: { tenant_id: tenantId, track_code: code }, perPage: 1 });
  return result.items[0] ?? null;
}

export async function findPostById(postId: string): Promise<PostRecord | null> {
  return store.getById<PostRecord>('posts', postId);
}

export function extractTrackCode(message: string): string {
  return text(message).match(/\[#(V\d{4})\]/i)?.[1]?.toUpperCase() || '';
}

export async function incrementPostMetric(postId: string, field: 'inquiries' | 'deals'): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const post = await store.getById<PostRecord>('posts', postId);
    if (!post) return;
    const revision = Number(post.publish_revision || 0);
    const current = Number(post[field] || 0);
    const changed = await compareAndSetRecord<PostRecord>({
      store,
      collection: 'posts',
      id: postId,
      expected: { publish_revision: revision, [field]: current },
      patch: { [field]: current + 1, publish_revision: revision + 1 },
    });
    if (changed.ok) return;
  }
  throw new Error('post_metric_increment_conflict');
}

export async function recentPostCandidates(tenantId: string, hours = 72): Promise<PostRecord[]> {
  const result = await store.list<PostRecord>('posts', { where: { tenant_id: tenantId }, perPage: 100, sort: '-published_at' });
  const cutoff = Date.now() - hours * 3600_000;
  return result.items.filter(item => {
    const published = Date.parse(text(item.published_at) || text(item.created));
    return Number.isFinite(published) && published >= cutoff;
  });
}

export function sourceFromPost(post: PostRecord): string {
  return `whatsapp_from_${post.platform || 'content'}`.replace(/[^\w-]/g, '_');
}

export function attributionSystemText(post: PostRecord): string {
  return `客户来自【${platformLabel(post.platform)} · ${post.title || post.track_code}】`;
}
