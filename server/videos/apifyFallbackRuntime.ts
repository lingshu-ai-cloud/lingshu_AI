import { asRecord } from '../routes/videoCrawlerProviderProjection.js';
import fs from 'fs';
import path from 'path';
import type { Platform } from '../types/index.js';
import { APIFY_USAGE_FILE } from './runtimeConfig.js';
import type { ApifyVideoUsageDay, ApifyVideoUsageStore } from './contracts.js';

export async function runApifyActorDatasetItems(actor: string, input: Record<string, unknown>, timeoutMs: number, label: string): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error('APIFY_TOKEN is not configured');
  const deadline = Date.now() + Math.max(1, timeoutMs);
  const startUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/runs?token=${encodeURIComponent(token)}`;
  const start = await apifyJsonRequest(startUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, deadline, `${label} start`);
  const startRecord = asRecord(start);
  const run = asRecord(startRecord.data) || startRecord;
  const runId = String(run.id || '').trim();
  const datasetId = String(run.defaultDatasetId || '').trim();
  if (!runId || !datasetId) throw new Error(`Apify ${label} did not return run/dataset identifiers`);

  const pollIntervalMs = Math.max(1000, Number(process.env.APIFY_POLL_INTERVAL_MS || 5000));
  let status = String(run.status || '').toUpperCase();
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    if (Date.now() >= deadline) throw new Error(`Apify ${label} timed out while waiting for run ${runId}`);
    await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
    const current = await apifyJsonRequest(
      `https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      deadline,
      `${label} poll`,
    );
    const currentRecord = asRecord(current);
    const currentRun = asRecord(currentRecord.data) || currentRecord;
    status = String(currentRun.status || '').toUpperCase();
  }
  if (status !== 'SUCCEEDED') throw new Error(`Apify ${label} run ${runId} ended with status ${status}`);

  const items = await apifyJsonRequest(
    `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&token=${encodeURIComponent(token)}`,
    { method: 'GET' },
    deadline,
    `${label} dataset`,
  );
  return Array.isArray(items) ? items as Record<string, unknown>[] : [];
}

export async function apifyJsonRequest(url: string, init: RequestInit, deadline: number, label: string): Promise<unknown> {
  const controller = new AbortController();
  if (deadline <= Date.now()) throw new Error(`Apify ${label} 下载累计超时`);
  const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
  try {
    const r = await fetch(url, { ...init, signal: controller.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`Apify ${label} HTTP ${r.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) as unknown : {};
  } finally {
    clearTimeout(timer);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function loadApifyVideoUsage(): ApifyVideoUsageStore {
  try {
    return JSON.parse(fs.readFileSync(APIFY_USAGE_FILE, 'utf8')) as ApifyVideoUsageStore;
  } catch {
    return {};
  }
}

export function apifyVideoDailyLimit(): number {
  return Math.max(0, Number(process.env.APIFY_TIKTOK_VIDEO_DAILY_LIMIT || 25));
}

export function apifyVideoTenantDailyLimit(): number {
  return Math.max(0, Number(process.env.APIFY_TIKTOK_VIDEO_TENANT_DAILY_LIMIT || 3));
}

export function normalizeApifyUsageDay(raw: number | ApifyVideoUsageDay | undefined): ApifyVideoUsageDay {
  if (typeof raw === 'number') {
    return { total: raw, tenants: {} };
  }
  if (raw && typeof raw === 'object') {
    return {
      total: Math.max(0, Number(raw.total || 0)),
      tenants: raw.tenants && typeof raw.tenants === 'object' ? raw.tenants : {},
    };
  }
  return { total: 0, tenants: {} };
}

export function apifyTenantKey(tenantId?: string): string {
  return tenantId?.trim() || '__unknown__';
}

export function apifyTenantIdFromRecord(record?: Record<string, unknown> | null): string | undefined {
  const tenantId = String(record?.tenantId || '').trim();
  return tenantId || undefined;
}

export function apifyVideoUsageToday(tenantId?: string): { total: number; tenant: number } {
  const usage = loadApifyVideoUsage();
  const day = normalizeApifyUsageDay(usage[todayKey()]);
  return {
    total: day.total,
    tenant: day.tenants[apifyTenantKey(tenantId)] || 0,
  };
}

export function canUseApifyVideoFallback(tenantId?: string, platform: Platform = 'tiktok'): boolean {
  const enableEnv = platform === 'instagram'
    ? 'APIFY_INSTAGRAM_VIDEO_FALLBACK_ENABLED'
    : platform === 'facebook'
      ? 'APIFY_FACEBOOK_VIDEO_FALLBACK_ENABLED'
      : platform === 'youtube'
        ? 'APIFY_YOUTUBE_VIDEO_FALLBACK_ENABLED'
        : 'APIFY_TIKTOK_VIDEO_FALLBACK_ENABLED';
  if (process.env[enableEnv] === '0') return false;
  if (!process.env.APIFY_TOKEN?.trim()) return false;
  // TikTok / Instagram 共用同一份 Apify 视频下载日额度（apify-video-usage.json）。
  const globalLimit = apifyVideoDailyLimit();
  const tenantLimit = apifyVideoTenantDailyLimit();
  if (globalLimit <= 0 || tenantLimit <= 0) return false;
  const usage = apifyVideoUsageToday(tenantId);
  return usage.total < globalLimit && usage.tenant < tenantLimit;
}

export function canUseApifyInstagramCrawlFallback(): boolean {
  return process.env.APIFY_INSTAGRAM_CRAWL_FALLBACK_ENABLED !== '0' && Boolean(process.env.APIFY_TOKEN?.trim());
}

export function canUseApifyFacebookCrawlFallback(): boolean {
  return process.env.APIFY_FACEBOOK_CRAWL_FALLBACK_ENABLED !== '0' && Boolean(process.env.APIFY_TOKEN?.trim());
}

export function canUseApifyTikTokCrawlFallback(): boolean {
  return process.env.APIFY_TIKTOK_CRAWL_FALLBACK_ENABLED !== '0' && Boolean(process.env.APIFY_TOKEN?.trim());
}

export function recordApifyVideoFallbackUse(tenantId?: string): void {
  const usage = loadApifyVideoUsage();
  const key = todayKey();
  const day = normalizeApifyUsageDay(usage[key]);
  const tenantKey = apifyTenantKey(tenantId);
  day.total += 1;
  day.tenants[tenantKey] = (day.tenants[tenantKey] || 0) + 1;
  usage[key] = day;
  fs.mkdirSync(path.dirname(APIFY_USAGE_FILE), { recursive: true });
  fs.writeFileSync(APIFY_USAGE_FILE, JSON.stringify(usage, null, 2), 'utf8');
}
