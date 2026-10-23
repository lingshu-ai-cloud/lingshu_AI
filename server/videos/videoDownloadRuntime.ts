import { browserUserAgent, cookieBrowsers, cookieFiles, usesServerCookiesForCrawl } from '../routes/videoCrawlerRuntimeConfig.js';
import { DownloadBudget, terminalDownloadFailure } from '../lib/downloadExecution.js';
import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import type { Platform } from '../types/index.js';
import { tenantAssetDir, tenantAssetRelativePath } from '../lib/assetAccess.js';
import { buildDownloadedReferenceMaterial } from '../lib/downloadedReferenceMaterial.js';
import { validatePublicVideoSourceUrl } from '../lib/publicVideoSourceSecurity.js';
import { humanSize, mimeFromPath, safeMaterialName } from '../routes/videoCrawlerNormalization.js';
import { execFileAsync, MEDIA_DIR, ANALYSIS_DIR, ffmpegBin, MAX_DOWNLOAD_JOBS } from './runtimeConfig.js';
import type { Material } from './contracts.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createVideoDownloadRuntime(deps: Pick<VideoApplicationPorts, 'isWeeklyOriginalAccountCollectionRecord' | 'ytDlpPythonPath' | 'buildYtDlpArgs' | 'crawlerExecEnv' | 'execYtDlpWithCookieFallback' | 'apifyTenantIdFromRecord' | 'canUseApifyVideoFallback' | 'downloadInstagramVideoViaApify' | 'downloadTikTokVideoViaApify' | 'extractPoster' | 'probeDuration' | 'persistMaterials' | 'loadMaterials' | 'downloadFacebookVideoViaApify' | 'downloadYouTubeVideoViaApify' | 'readTikTokPublicApi'>) {
  const isWeeklyOriginalAccountCollectionRecord: VideoApplicationPorts['isWeeklyOriginalAccountCollectionRecord'] = (...args) => deps.isWeeklyOriginalAccountCollectionRecord(...args);
  const ytDlpPythonPath: VideoApplicationPorts['ytDlpPythonPath'] = (...args) => deps.ytDlpPythonPath(...args);
  const buildYtDlpArgs: VideoApplicationPorts['buildYtDlpArgs'] = (...args) => deps.buildYtDlpArgs(...args);
  const crawlerExecEnv: VideoApplicationPorts['crawlerExecEnv'] = (...args) => deps.crawlerExecEnv(...args);
  const execYtDlpWithCookieFallback: VideoApplicationPorts['execYtDlpWithCookieFallback'] = (...args) => deps.execYtDlpWithCookieFallback(...args);
  const apifyTenantIdFromRecord: VideoApplicationPorts['apifyTenantIdFromRecord'] = (...args) => deps.apifyTenantIdFromRecord(...args);
  const canUseApifyVideoFallback: VideoApplicationPorts['canUseApifyVideoFallback'] = (...args) => deps.canUseApifyVideoFallback(...args);
  const downloadInstagramVideoViaApify: VideoApplicationPorts['downloadInstagramVideoViaApify'] = (...args) => deps.downloadInstagramVideoViaApify(...args);
  const downloadTikTokVideoViaApify: VideoApplicationPorts['downloadTikTokVideoViaApify'] = (...args) => deps.downloadTikTokVideoViaApify(...args);
  const extractPoster: VideoApplicationPorts['extractPoster'] = (...args) => deps.extractPoster(...args);
  const probeDuration: VideoApplicationPorts['probeDuration'] = (...args) => deps.probeDuration(...args);
  const persistMaterials: VideoApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);
  const loadMaterials: VideoApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const downloadFacebookVideoViaApify: VideoApplicationPorts['downloadFacebookVideoViaApify'] = (...args) => deps.downloadFacebookVideoViaApify(...args);
  const downloadYouTubeVideoViaApify: VideoApplicationPorts['downloadYouTubeVideoViaApify'] = (...args) => deps.downloadYouTubeVideoViaApify(...args);
  const readTikTokPublicApi: VideoApplicationPorts['readTikTokPublicApi'] = (...args) => deps.readTikTokPublicApi(...args);

  let activeDownloadJobs = 0;

  async function withDownloadSlot<T>(fn: () => Promise<T>): Promise<T> {
    const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
    while (activeDownloadJobs >= MAX_DOWNLOAD_JOBS) {
      await sleep(150);
    }
    activeDownloadJobs += 1;
    try {
      return await fn();
    } finally {
      activeDownloadJobs = Math.max(0, activeDownloadJobs - 1);
    }
  }

  async function downloadVideoToMaterial(input: {
    sourceUrl: string;
    title: string;
    platform: Platform;
    duration: number;
    tenantId: string;
    record?: Record<string, unknown> | null;
  }): Promise<Material> {
    if(isWeeklyOriginalAccountCollectionRecord(input.record))throw Error('weekly_original_account_media_requires_same_run_kv');
    const tenantMediaDir = tenantAssetDir(MEDIA_DIR, input.tenantId);
    fs.mkdirSync(tenantMediaDir, { recursive: true });
    const id = randomUUID();
    const outTpl = path.join(tenantMediaDir, `${id}.%(ext)s`);
    const downloadArgs = [
      '--no-playlist',
      '--merge-output-format', 'mp4',
      '--max-filesize', '120m',
      '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/best[height<=720]/best',
      '-o', outTpl,
    ];
    const cleanupIncompleteDownload = () => {
      try {
        for (const filename of fs.readdirSync(tenantMediaDir)) {
          if (filename.startsWith(`${id}.`) && filename.endsWith('.part')) fs.unlinkSync(path.join(tenantMediaDir, filename));
        }
      } catch { /* best effort */ }
    };

    let ytDlpError: unknown = null;
    try {
      await execFileAsync(ytDlpPythonPath(), buildYtDlpArgs(downloadArgs, input.sourceUrl, false), { maxBuffer: 4 * 1024 * 1024, timeout: 180_000, env: crawlerExecEnv() });
    } catch (e) {
      ytDlpError = e;
      if (usesServerCookiesForCrawl(input.platform)) {
        try {
          await execYtDlpWithCookieFallback(downloadArgs, input.sourceUrl, 180_000, 4 * 1024 * 1024);
          ytDlpError = null;
        } catch (cookieError) {
          ytDlpError = cookieError;
        }
      }
    }
    if (ytDlpError && (input.platform === 'instagram' || input.platform === 'tiktok')) {
      const tenantId = apifyTenantIdFromRecord(input.record);
      if (canUseApifyVideoFallback(tenantId, input.platform)) {
        const downloaded = input.platform === 'instagram'
          ? await downloadInstagramVideoViaApify(input.sourceUrl, tenantId)
          : await downloadTikTokVideoViaApify(input.sourceUrl, tenantId);
        const materialPath = path.join(tenantMediaDir, `${id}.mp4`);
        fs.copyFileSync(downloaded.filePath, materialPath);
        cleanupTempVideo(downloaded.filePath);
        ytDlpError = null;
      }
    }
    if (ytDlpError) {
      cleanupIncompleteDownload();
      throw ytDlpError instanceof Error ? ytDlpError : new Error('yt-dlp failed for material download');
    }
    const downloaded = pickDownloadedVideoFile(id, tenantMediaDir);
    if (!downloaded) {
      cleanupIncompleteDownload();
      throw new Error('yt-dlp did not produce a video file');
    }

    const fullPath = path.join(tenantMediaDir, downloaded);
    const posterFile = `${id}.poster.jpg`;
    const posterPath = path.join(tenantMediaDir, posterFile);
    const posterOk = await extractPoster(fullPath, posterPath, input.duration > 1 ? 1 : 0);
    const createdAt = new Date().toISOString();
    const material = buildDownloadedReferenceMaterial({
      id,
      tenantId: input.tenantId,
      name: safeMaterialName(input.title, input.platform),
      platform: input.platform,
      sourceUrl: input.sourceUrl,
      duration: input.duration || await probeDuration(fullPath),
      size: humanSize(fs.statSync(fullPath).size),
      file: tenantAssetRelativePath(input.tenantId, downloaded),
      poster: posterOk ? tenantAssetRelativePath(input.tenantId, posterFile) : undefined,
      contentSha256: createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex'),
      createdAt,
    }) as Material;
    persistMaterials([material, ...loadMaterials().filter(m => m.id !== material.id)]);
    return material;
  }

  async function downloadVideoForAnalysis(input: {
    sourceUrl: string;
    title: string;
    platform: Platform;
    record?: Record<string, unknown> | null;
    allowPaidFallback?: boolean;
    allowCookieFallback?: boolean;
  }, executeDownload = execFileAsync, budget = new DownloadBudget(Math.max(10_000, Number(process.env.VIDEO_ANALYSIS_DOWNLOAD_TIMEOUT_MS || 150_000)))): Promise<{ filePath: string; fileName: string; mimeType: string; size: number }> {
    if(isWeeklyOriginalAccountCollectionRecord(input.record))throw Error('weekly_original_account_media_requires_same_run_kv');
    const source = validatePublicVideoSourceUrl(input.sourceUrl, input.platform);
    if (!source) throw new Error('unsafe_public_video_source');
    input = { ...input, ...source };
    fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
    const tenantId = apifyTenantIdFromRecord(input.record);
    if (input.platform === 'tiktok') {
      try {
        return await downloadTikTokViaPublicApi(input.sourceUrl, budget);
      } catch (error) {
        budget.record('TikTok public API', error);
        budget.remaining();
        console.warn('[videos] TikTok public API download failed, trying authenticated yt-dlp:', error instanceof Error ? error.message : error);
      }
    }
    // Facebook's public page frequently blocks yt-dlp or makes it retry several
    // formats before failing. The configured posts actor already exposes the
    // playable CDN URL, so use it first for an explicit analysis request.
    if (input.allowPaidFallback !== false && input.platform === 'facebook' && canUseApifyVideoFallback(tenantId, 'facebook')) {
      try {
        return await downloadFacebookVideoViaApify(input.sourceUrl, tenantId, budget);
      } catch (error) {
        budget.record('Apify', error);
        budget.remaining();
        console.warn('[videos] Facebook Apify analysis video fallback failed, trying yt-dlp:', error instanceof Error ? error.message : error);
      }
    }
    // Datacenter YouTube traffic is commonly challenged before yt-dlp can obtain
    // media bytes. A dedicated downloader actor stores one low-res MP4 in Apify
    // KVS, which we immediately copy into our own PocketBase-backed pipeline.
    if (input.allowPaidFallback !== false && input.platform === 'youtube' && canUseApifyVideoFallback(tenantId, 'youtube')) {
      try {
        return await downloadYouTubeVideoViaApify(input.sourceUrl, tenantId, budget);
      } catch (error) {
        budget.record('Apify', error);
        budget.remaining();
        console.warn('[videos] YouTube Apify analysis video fallback failed, trying yt-dlp:', error instanceof Error ? error.message : error);
      }
    }
    const id = randomUUID();
    const outTpl = path.join(ANALYSIS_DIR, `${id}.%(ext)s`);
    const clipSeconds = Math.max(30, Number(process.env.VIDEO_ANALYSIS_CLIP_SECONDS || 180));
    const baseDownloadArgs = [
      '--no-playlist',
      '--merge-output-format', 'mp4',
      '--max-filesize', process.env.VIDEO_ANALYSIS_MAX_FILESIZE || '80m',
      ...(ffmpegBin ? ['--ffmpeg-location', ffmpegBin] : []),
      '-o', outTpl,
    ];
    const formatCandidates: Array<{ format?: string; section?: boolean; label: string }> = [
      { format: 'h264_720p_1023806-1/h264_720p_1023806-0/download/best[height<=720]/best', section: false, label: 'tiktok-h264-full' },
      { format: 'bv*[height<=480]+ba/bv*[height<=480]/b[height<=480][vcodec!=none]/best[height<=480][vcodec!=none]/best[vcodec!=none]', section: false, label: '480-full' },
      { format: 'bv*+ba/bv*/b[vcodec!=none]/best[vcodec!=none]', section: false, label: 'best-full' },
      { section: false, label: 'auto-full' },
      { format: 'bv*[height<=360]+ba/bv*[height<=360]/b[height<=360][vcodec!=none]/best[height<=360][vcodec!=none]/best[vcodec!=none]', section: true, label: '360-section' },
      { format: 'bv*[height<=480]+ba/bv*[height<=480]/b[height<=480][vcodec!=none]/best[height<=480][vcodec!=none]/best[vcodec!=none]', section: true, label: '480-section' },
      { format: 'bv*+ba/bv*/b[vcodec!=none]/best[vcodec!=none]', section: true, label: 'best-section' },
    ];

    let lastError: unknown = null;
    for (const candidate of formatCandidates) {
      const downloadArgs = [
        ...baseDownloadArgs,
        ...(candidate.section && ffmpegBin ? ['--download-sections', `*0-${clipSeconds}`] : []),
        ...(candidate.format ? ['-f', candidate.format] : []),
      ];
      try {
        await executeDownload(ytDlpPythonPath(), buildYtDlpArgs(downloadArgs, input.sourceUrl, false), { maxBuffer: 4 * 1024 * 1024, timeout: budget.remaining(), env: crawlerExecEnv() });
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        budget.record(candidate.label, e);
        if (terminalDownloadFailure(e)) break;
        if (input.allowCookieFallback !== false && usesServerCookiesForCrawl(input.platform) && (cookieBrowsers().length > 0 || cookieFiles().length > 0)) {
          try {
            await execYtDlpWithCookieFallback(downloadArgs, input.sourceUrl, budget.remaining(), 4 * 1024 * 1024, budget);
            lastError = null;
            break;
          } catch (cookieError) {
            lastError = cookieError;
            if (terminalDownloadFailure(cookieError)) break;
          }
        }
        try { budget.remaining(); } catch (error) { lastError = error; break; }
        console.warn(`[videos] analysis download attempt failed (${candidate.label}):`, lastError instanceof Error ? lastError.message : lastError);
      }
    }
    if (lastError) {
      cleanupDownloadedFilesById(id, ANALYSIS_DIR);
      if (input.allowPaidFallback !== false && input.platform === 'tiktok' && canUseApifyVideoFallback(tenantId, 'tiktok')) {
        try {
          console.warn('[videos] TikTok yt-dlp analysis download failed, trying Apify video fallback:', lastError instanceof Error ? lastError.message : lastError);
          return await downloadTikTokVideoViaApify(input.sourceUrl, tenantId, budget);
        } catch (apifyError) {
          budget.record('Apify', apifyError);
          console.warn('[videos] TikTok Apify analysis video fallback failed:', apifyError instanceof Error ? apifyError.message : apifyError);
        }
      }
      if (input.platform === 'tiktok') {
        try {
          return await downloadTikTokViaPublicApi(input.sourceUrl, budget);
        } catch (publicApiError) {
          budget.record('TikTok public API', publicApiError);
          console.warn('[videos] TikTok public API analysis fallback failed:', publicApiError instanceof Error ? publicApiError.message : publicApiError);
        }
      }
      if (input.allowPaidFallback !== false && input.platform === 'instagram' && canUseApifyVideoFallback(tenantId, 'instagram')) {
        try {
          console.warn('[videos] Instagram yt-dlp analysis download failed, trying Apify video fallback:', lastError instanceof Error ? lastError.message : lastError);
          return await downloadInstagramVideoViaApify(input.sourceUrl, tenantId, budget);
        } catch (apifyError) {
          budget.record('Apify', apifyError);
          console.warn('[videos] Instagram Apify analysis video fallback failed:', apifyError instanceof Error ? apifyError.message : apifyError);
        }
      }
      throw budget.error(lastError instanceof Error ? lastError.message.slice(0, 200) : 'yt-dlp failed for all analysis formats');
    }
    const downloaded = pickDownloadedVideoFile(id, ANALYSIS_DIR);
    if (!downloaded) {
      cleanupDownloadedFilesById(id, ANALYSIS_DIR);
      throw new Error('yt-dlp did not produce an analysis video file');
    }

    const filePath = path.join(ANALYSIS_DIR, downloaded);
    return {
      filePath,
      fileName: downloaded,
      mimeType: mimeFromPath(filePath),
      size: fs.statSync(filePath).size,
    };
  }

  async function downloadTikTokViaPublicApi(sourceUrl: string, budget: DownloadBudget): Promise<{ filePath: string; fileName: string; mimeType: string; size: number }> {
    const data = await readTikTokPublicApi(sourceUrl);
    const mediaUrl = String(data.hdplay || data.play || '').trim();
    if (!/^https:\/\//i.test(mediaUrl)) throw new Error('TikTok public API did not return HTTPS media');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget.remaining());
    const fileName = `${randomUUID()}.mp4`;
    const filePath = path.join(ANALYSIS_DIR, fileName);
    try {
      const response = await fetch(mediaUrl, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': browserUserAgent(), Referer: 'https://www.tiktok.com/' } });
      if (!response.ok) throw new Error(`TikTok media HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length') || 0);
      const maximum = 80 * 1024 * 1024;
      if (declared > maximum) throw new Error('TikTok media exceeds analysis limit');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1024 || bytes.length > maximum || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('TikTok public API returned invalid MP4');
      fs.writeFileSync(filePath, bytes, { flag: 'wx' });
      return { filePath, fileName, mimeType: 'video/mp4', size: bytes.length };
    } catch (error) {
      try { fs.unlinkSync(filePath); } catch { /* not written */ }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function pickDownloadedVideoFile(id: string, dir = MEDIA_DIR): string | undefined {
    const files = fs.readdirSync(dir)
      .filter(file => file.startsWith(`${id}.`) && !file.includes('.poster.'));
    return files.find(file => /\.(mp4|webm|mov|mkv)$/i.test(file));
  }

  function cleanupDownloadedFilesById(id: string, dir: string): void {
    try {
      for (const file of fs.readdirSync(dir)) {
        if (file.startsWith(`${id}.`)) fs.unlinkSync(path.join(dir, file));
      }
    } catch {
      // best effort cleanup
    }
  }

  function cleanupTempVideo(filePath: string): void {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath).split('.')[0];
    for (const file of fs.readdirSync(dir)) {
      if (file.startsWith(`${base}.`)) {
        try { fs.unlinkSync(path.join(dir, file)); } catch { /* best effort */ }
      }
    }
  }

  return { withDownloadSlot, downloadVideoToMaterial, downloadVideoForAnalysis, cleanupTempVideo };
}
