import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpegStatic from 'ffmpeg-static';

export const COL = 'trend_videos';

export const execFileAsync = promisify(execFile);

export const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MEDIA_DIR = path.join(__dirname, '../../data/media');

export const ANALYSIS_DIR = path.join(__dirname, '../../data/analysis-temp');

export const MATERIALS_FILE = path.join(__dirname, '../../data/materials.json');

export const CRAWLER_OPS_FILE = path.join(__dirname, '../../data/crawler-ops-queue.json');

export const APIFY_USAGE_FILE = path.join(__dirname, '../../data/apify-video-usage.json');

export const ffmpegBin = ffmpegStatic as unknown as string | null;

export const MANUAL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const REFERENCE_UPLOAD_MAX_BYTES = 32 * 1024 * 1024;

export const MAX_DOWNLOAD_JOBS = Number(process.env.VIDEO_DOWNLOAD_CONCURRENCY || 3);

export const DEFAULT_CRAWL_KEYWORDS = 'amazon gadgets product review';

export function analysisRunsInWorkerProcess(): boolean {
  return process.env.PROCESS_ROLE_SPLIT_ENABLED === 'true' && process.env.PROCESS_ROLE === 'web';
}

export const EXACT_ANALYSIS_STALL_MS = Math.max(
  5 * 60_000,
  Number(process.env.EXACT_ANALYSIS_STALL_MS || 5 * 60_000),
);
