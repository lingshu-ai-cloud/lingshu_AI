import { DownloadBudget } from '../lib/downloadExecution.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { ANALYSIS_DIR } from './runtimeConfig.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createVideoDownloadFallbacks(deps: Pick<VideoApplicationPorts, 'canUseApifyVideoFallback' | 'recordApifyVideoFallbackUse' | 'runApifyActorDatasetItems'>) {
  const canUseApifyVideoFallback: VideoApplicationPorts['canUseApifyVideoFallback'] = (...args) => deps.canUseApifyVideoFallback(...args);
  const recordApifyVideoFallbackUse: VideoApplicationPorts['recordApifyVideoFallbackUse'] = (...args) => deps.recordApifyVideoFallbackUse(...args);
  const runApifyActorDatasetItems: VideoApplicationPorts['runApifyActorDatasetItems'] = (...args) => deps.runApifyActorDatasetItems(...args);

  async function downloadTikTokVideoViaApify(sourceUrl: string, tenantId?: string, budget = new DownloadBudget(Math.max(10_000, Number(process.env.VIDEO_ANALYSIS_DOWNLOAD_TIMEOUT_MS || 150_000)))): Promise<{ filePath: string; fileName: string; mimeType: string; size: number }> {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) throw new Error('APIFY_TOKEN is not configured');
    if (!canUseApifyVideoFallback(tenantId)) throw new Error('Apify video fallback daily limit reached for this account or server');
    const actor = process.env.APIFY_TIKTOK_ACTOR?.trim() || 'clockworks/tiktok-scraper';
    const input = {
      postURLs: [sourceUrl],
      resultsPerPage: 1,
      shouldDownloadVideos: true,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
      shouldDownloadAvatars: false,
      shouldDownloadMusicCovers: false,
      shouldDownloadMusic: false,
    };
    const runUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?clean=true&token=${encodeURIComponent(token)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(budget.remaining(), Number(process.env.APIFY_VIDEO_TIMEOUT_MS || 180_000)));
    try {
      const r = await fetch(runUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`Apify TikTok video HTTP ${r.status}: ${text.slice(0, 300)}`);
      const rows = JSON.parse(text) as unknown;
      const row = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : undefined;
      const videoUrl = row ? findApifyVideoDownloadUrl(row) : '';
      if (!videoUrl) throw new Error('Apify did not return a downloadable video URL');
      const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(budget.remaining()) });
      if (!videoRes.ok) throw new Error(`Apify video download HTTP ${videoRes.status}`);
      const buf = Buffer.from(await videoRes.arrayBuffer());
      if (buf.length < 1024) throw new Error('Apify returned an empty video file');
      fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
      const fileName = `${randomUUID()}.mp4`;
      const filePath = path.join(ANALYSIS_DIR, fileName);
      fs.writeFileSync(filePath, buf);
      recordApifyVideoFallbackUse(tenantId);
      return {
        filePath,
        fileName,
        mimeType: videoRes.headers.get('content-type')?.split(';')[0] || 'video/mp4',
        size: buf.length,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function downloadYouTubeVideoViaApify(sourceUrl: string, tenantId?: string, budget = new DownloadBudget(Math.max(10_000, Number(process.env.VIDEO_ANALYSIS_DOWNLOAD_TIMEOUT_MS || 150_000)))): Promise<{ filePath: string; fileName: string; mimeType: string; size: number }> {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) throw new Error('APIFY_TOKEN is not configured');
    if (!canUseApifyVideoFallback(tenantId, 'youtube')) throw new Error('Apify YouTube fallback daily limit reached for this account or server');
    const actor = process.env.APIFY_YOUTUBE_VIDEO_ACTOR?.trim() || 'streamers/youtube-video-downloader';
    const rows = await runApifyActorDatasetItems(actor, {
      videos: [{ url: sourceUrl }],
      storeInKVStore: true,
      preferredQuality: '360p',
      preferredFormat: 'mp4',
      filenameTemplateParts: [],
    }, Math.min(budget.remaining(), Number(process.env.APIFY_YOUTUBE_VIDEO_TIMEOUT_MS || 300_000)), 'YouTube video');
    const videoUrl = String(rows[0]?.downloadedFileUrl || '').trim();
    if (!videoUrl) throw new Error('Apify did not return a downloaded YouTube video URL');
    const videoRes = await fetch(`${videoUrl}${videoUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(Math.min(budget.remaining(), Number(process.env.APIFY_YOUTUBE_FILE_TIMEOUT_MS || 120_000))),
    });
    if (!videoRes.ok) throw new Error(`Apify YouTube video download HTTP ${videoRes.status}`);
    const buf = Buffer.from(await videoRes.arrayBuffer());
    if (buf.length < 1024) throw new Error('Apify returned an empty YouTube video file');
    fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
    const fileName = `${randomUUID()}.mp4`;
    const filePath = path.join(ANALYSIS_DIR, fileName);
    fs.writeFileSync(filePath, buf);
    recordApifyVideoFallbackUse(tenantId);
    return {
      filePath,
      fileName,
      mimeType: videoRes.headers.get('content-type')?.split(';')[0] || 'video/mp4',
      size: buf.length,
    };
  }

  async function downloadInstagramVideoViaApify(sourceUrl: string, tenantId?: string, budget = new DownloadBudget(Math.max(10_000, Number(process.env.VIDEO_ANALYSIS_DOWNLOAD_TIMEOUT_MS || 150_000)))): Promise<{ filePath: string; fileName: string; mimeType: string; size: number }> {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) throw new Error('APIFY_TOKEN is not configured');
    if (!canUseApifyVideoFallback(tenantId, 'instagram')) throw new Error('Apify video fallback daily limit reached for this account or server');
    const actor = process.env.APIFY_INSTAGRAM_ACTOR?.trim() || 'apify/instagram-scraper';
    const input = {
      directUrls: [sourceUrl],
      resultsType: 'posts',
      resultsLimit: 1,
      addParentData: false,
    };
    const rows = await runApifyActorDatasetItems(actor, input, Math.min(budget.remaining(), Number(process.env.APIFY_VIDEO_TIMEOUT_MS || 240_000)), 'Instagram video');
    const row = rows[0];
    // IG 的 videoUrl 是 cdninstagram 签名直链（无扩展名），findApifyVideoDownloadUrl 的
    // 扩展名/白名单规则匹配不到，这里优先直接读 videoUrl 字段，再退回通用查找。
    const videoUrl = String(row?.videoUrl || '').trim() || (row ? findApifyVideoDownloadUrl(row) : '');
    if (!videoUrl) throw new Error('Apify did not return a downloadable video URL');
    const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(budget.remaining()) });
    if (!videoRes.ok) throw new Error(`Apify video download HTTP ${videoRes.status}`);
    const buf = Buffer.from(await videoRes.arrayBuffer());
    if (buf.length < 1024) throw new Error('Apify returned an empty video file');
    fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
    const fileName = `${randomUUID()}.mp4`;
    const filePath = path.join(ANALYSIS_DIR, fileName);
    fs.writeFileSync(filePath, buf);
    recordApifyVideoFallbackUse(tenantId);
    return {
      filePath,
      fileName,
      mimeType: videoRes.headers.get('content-type')?.split(';')[0] || 'video/mp4',
      size: buf.length,
    };
  }

  function findFacebookPlayableUrl(value: unknown, depth = 0): string {
    if (depth > 6 || value == null) return '';
    if (typeof value === 'string') return /^https?:\/\//i.test(value.trim()) ? value.trim() : '';
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFacebookPlayableUrl(item, depth + 1);
        if (found) return found;
      }
      return '';
    }
    if (typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    for (const key of ['browser_native_hd_url', 'playable_url_quality_hd', 'browser_native_sd_url', 'playable_url', 'videoUrl', 'downloadUrl']) {
      const found = findFacebookPlayableUrl(record[key], depth + 1);
      if (found) return found;
    }
    for (const item of Object.values(record)) {
      if (typeof item === 'object' && item) {
        const found = findFacebookPlayableUrl(item, depth + 1);
        if (found) return found;
      }
    }
    return '';
  }

  async function downloadFacebookVideoViaApify(sourceUrl: string, tenantId?: string, budget = new DownloadBudget(Math.max(10_000, Number(process.env.VIDEO_ANALYSIS_DOWNLOAD_TIMEOUT_MS || 150_000)))): Promise<{ filePath: string; fileName: string; mimeType: string; size: number }> {
    if (!process.env.APIFY_TOKEN?.trim()) throw new Error('APIFY_TOKEN is not configured');
    if (!canUseApifyVideoFallback(tenantId, 'facebook')) throw new Error('Apify video fallback daily limit reached for this account or server');
    const actor = process.env.APIFY_FACEBOOK_ACTOR?.trim() || 'apify/facebook-posts-scraper';
    const rows = await runApifyActorDatasetItems(actor, {
      startUrls: [{ url: sourceUrl }],
      resultsLimit: 1,
      maxPosts: 1,
    }, Math.min(budget.remaining(), Number(process.env.APIFY_VIDEO_TIMEOUT_MS || 180_000)), 'Facebook video');
    const videoUrl = rows[0] ? findFacebookPlayableUrl(rows[0]) : '';
    if (!videoUrl) throw new Error('Apify did not return a downloadable Facebook video URL');
    const videoRes = await fetch(videoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(Math.min(90_000, budget.remaining())) });
    if (!videoRes.ok) throw new Error(`Apify Facebook video download HTTP ${videoRes.status}`);
    const buf = Buffer.from(await videoRes.arrayBuffer());
    if (buf.length < 1024) throw new Error('Apify returned an empty Facebook video file');
    fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
    const fileName = `${randomUUID()}.mp4`;
    const filePath = path.join(ANALYSIS_DIR, fileName);
    fs.writeFileSync(filePath, buf);
    recordApifyVideoFallbackUse(tenantId);
    return {
      filePath,
      fileName,
      mimeType: videoRes.headers.get('content-type')?.split(';')[0] || 'video/mp4',
      size: buf.length,
    };
  }

  function findApifyVideoDownloadUrl(value: unknown, depth = 0): string {
    if (depth > 5 || value == null) return '';
    if (typeof value === 'string') {
      const text = value.trim();
      if (/^https?:\/\//i.test(text) && (/\.(mp4|mov|webm)(?:[?#]|$)/i.test(text) || /api\.apify\.com|api\.apifyusercontent\.com|storage\.googleapis\.com/i.test(text))) {
        return text;
      }
      return '';
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findApifyVideoDownloadUrl(item, depth + 1);
        if (found) return found;
      }
      return '';
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const priority = [
        'downloadedVideoUrl',
        'downloadUrl',
        'videoDownloadUrl',
        'videoUrl',
        'playAddr',
        'downloadAddr',
        'url',
      ];
      for (const key of priority) {
        const found = findApifyVideoDownloadUrl(record[key], depth + 1);
        if (found) return found;
      }
      for (const item of Object.values(record)) {
        const found = findApifyVideoDownloadUrl(item, depth + 1);
        if (found) return found;
      }
    }
    return '';
  }

  return { downloadTikTokVideoViaApify, downloadYouTubeVideoViaApify, downloadInstagramVideoViaApify, downloadFacebookVideoViaApify };
}
