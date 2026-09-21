import '../server/loadEnvironment.js';
/**
 * Import explicitly licensed video materials into PocketBase.
 *
 * Dry-run (default; validates only and makes no network request):
 *   pnpm run import:materials -- --manifest /absolute/path/manifest.json
 *
 * Apply (downloads to the OS temp directory, normalizes, uploads, then cleans):
 *   pnpm run import:materials -- --manifest /absolute/path/manifest.json --apply
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { getPbAdminToken, getPbUrl, invalidatePbAdminToken } from '../server/storage/pb.js';
import {
  buildMaterialImportProvenance,
  buildMaterialImportVisualMetadata,
  assertApprovedMaterialDownloadUrl,
  isPrivateOrReservedIp,
  MaterialImportManifestError,
  POCKETBASE_MATERIAL_MAX_BYTES,
  POCKETBASE_POSTER_MAX_BYTES,
  validateMaterialImportManifest,
  type MaterialImportAsset,
  type MaterialImportManifest,
} from './lib/materialImportManifest.js';

const COLLECTION = 'materials';
const MAX_SOURCE_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MATERIAL_IMPORT_USER_AGENT = 'LingshuLicensedMaterialImporter/1.0 (https://lingshu.site; admin@lingshu.site)';
const PB_IMPORT_TIMEOUT_MS = Math.min(15 * 60 * 1000, Math.max(60_000, Number(process.env.PB_IMPORT_TIMEOUT_MS || 5 * 60 * 1000)));
const REQUIRED_COLLECTION_FIELDS = [
  'tenantId', 'title', 'folder', 'type', 'duration', 'width', 'height', 'sizeBytes', 'sha256',
  'tags', 'industry', 'shotFunction', 'applicability', 'scope', 'usage', 'sourceType', 'sourceName',
  'sourceProvider', 'sourceCreator', 'sourceUrl', 'licenseEvidence', 'licenseName', 'licenseUrl',
  'attributionText', 'licenseEvidenceCapturedAt', 'licenseEvidenceTextSha256', 'importBatchId', 'manifestSha256', 'importedAt',
  'commercialUseApproved', 'derivativesApproved', 'rawLibraryUseApproved', 'provenance', 'videoFile', 'posterFile',
  'visualObservations', 'segments', 'segmentAnalysisStatus', 'analysisSourceRevision',
] as const;
const MATERIAL_FIELD_CONTRACT: Record<string, { type: string; minMaxSize?: number }> = {
  sourceProvider: { type: 'text' }, sourceCreator: { type: 'text' }, sourceUrl: { type: 'text' },
  licenseEvidence: { type: 'text' }, licenseName: { type: 'text' }, licenseUrl: { type: 'text' },
  attributionText: { type: 'text' }, licenseEvidenceCapturedAt: { type: 'text' }, licenseEvidenceTextSha256: { type: 'text' },
  importBatchId: { type: 'text' }, manifestSha256: { type: 'text' }, importedAt: { type: 'text' },
  commercialUseApproved: { type: 'bool' }, derivativesApproved: { type: 'bool' }, rawLibraryUseApproved: { type: 'bool' },
  provenance: { type: 'json', minMaxSize: 500_000 }, visualObservations: { type: 'json', minMaxSize: 200_000 },
  segments: { type: 'json', minMaxSize: 2_000_000 }, segmentAnalysisStatus: { type: 'text' }, analysisSourceRevision: { type: 'text' },
  videoFile: { type: 'file', minMaxSize: POCKETBASE_MATERIAL_MAX_BYTES },
  posterFile: { type: 'file', minMaxSize: POCKETBASE_POSTER_MAX_BYTES },
};

type ImportArguments = { manifestPath: string; apply: boolean };
type DownloadResult = { sourceSha256: string; bytes: number; contentType: string; finalUrl: URL };
type MediaMetadata = { duration: number; width: number; height: number };
type Inventory = { records: number; totalBytes: number; unknownSizeRecords: number; hashes: Set<string> };
type ImportSummary = { planned: number; disabled: number; imported: number; skipped: number; failed: number };
type ApprovedAddress = { address: string; family: 4 | 6 };
type ApprovedDownloadResponse = {
  status: number;
  header(name: string): string;
  stream: NodeJS.ReadableStream | null;
  discard(): void | Promise<void>;
};
type CachedDownload = DownloadResult & { path: string };
type DownloadCache = Map<string, CachedDownload>;

let materialProxyAgent: ProxyAgent | undefined;

function configuredProxyUrl(): string {
  return String(process.env.HTTPS_PROXY || process.env.https_proxy || '').trim();
}

function proxyAgent(): ProxyAgent | null {
  const configured = configuredProxyUrl();
  if (!configured) return null;
  let parsed: URL;
  try { parsed = new URL(configured); } catch { throw new Error('HTTPS_PROXY 不是有效 URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('HTTPS_PROXY 只允许 http 或 https 代理');
  materialProxyAgent ||= new ProxyAgent(configured);
  return materialProxyAgent;
}

async function closeProxyAgent(): Promise<void> {
  const agent = materialProxyAgent;
  materialProxyAgent = undefined;
  if (agent) await agent.close();
}

function parseArguments(argv = process.argv.slice(2)): ImportArguments {
  const index = argv.indexOf('--manifest');
  const manifestPath = index >= 0 ? String(argv[index + 1] || '').trim() : '';
  if (!manifestPath) throw new Error('用法：pnpm run import:materials -- --manifest /absolute/path/manifest.json [--apply]');
  if (!path.isAbsolute(manifestPath)) throw new Error('--manifest 必须使用绝对路径，避免从错误工作目录读取清单');
  return { manifestPath, apply: argv.includes('--apply') };
}

function loadManifest(manifestPath: string): { manifest: MaterialImportManifest; manifestSha256: string } {
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('manifest 必须是普通文件，不能是软链接');
  const bytes = fs.readFileSync(manifestPath);
  if (bytes.length > 2 * 1024 * 1024) throw new Error('manifest 不能超过 2 MiB');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`manifest JSON 无法解析：${error instanceof Error ? error.message : String(error)}`);
  }
  return { manifest: validateMaterialImportManifest(parsed), manifestSha256: createHash('sha256').update(bytes).digest('hex') };
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const bytes = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!bytes) break;
      hash.update(chunk.subarray(0, bytes));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function safeFileName(value: string): string {
  const normalized = value.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 80) || 'material';
}

function assertTrustedReviewers(manifest: MaterialImportManifest): void {
  const trusted = new Set(String(process.env.MATERIAL_IMPORT_TRUSTED_REVIEWERS || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  if (!trusted.size) {
    throw new Error('执行导入前必须设置 MATERIAL_IMPORT_TRUSTED_REVIEWERS（逗号分隔的受信审批人）');
  }
  for (const asset of manifest.assets.filter(item => item.enabled)) {
    for (const [role, reviewer] of [
      ['许可证审批人', asset.approval.approvedBy],
      ['画面复核人', asset.visualReview.reviewedBy],
    ] as const) {
      if (!trusted.has(reviewer.toLowerCase())) throw new Error(`${asset.id} 的${role}不在受信名单：${reviewer}`);
    }
  }
}

async function publicDnsAddresses(hostname: string): Promise<ApprovedAddress[]> {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error(`下载域名无法解析：${hostname}`);
  const unsafe = addresses.find(item => isPrivateOrReservedIp(item.address));
  if (unsafe) throw new Error(`下载域名解析到私网或保留地址：${hostname}`);
  return addresses.map(item => ({ address: item.address, family: item.family === 6 ? 6 : 4 }));
}

function pinnedHttpsRequest(url: URL, target: ApprovedAddress): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const request = https.request({
      protocol: 'https:',
      hostname: target.address,
      family: target.family,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: isIP(hostname) ? undefined : hostname,
      rejectUnauthorized: true,
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: {
        Host: url.host,
        'User-Agent': MATERIAL_IMPORT_USER_AGENT,
        Accept: 'video/*,application/octet-stream;q=0.8',
      },
    }, resolve);
    request.once('error', reject);
    request.end();
  });
}

async function approvedResponse(url: URL, addresses: ApprovedAddress[]): Promise<ApprovedDownloadResponse> {
  const agent = proxyAgent();
  if (agent) {
    const response = await undiciFetch(url, {
      dispatcher: agent,
      redirect: 'manual',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: {
        'User-Agent': MATERIAL_IMPORT_USER_AGENT,
        Accept: 'video/*,application/octet-stream;q=0.8',
      },
    });
    const stream = response.body ? Readable.fromWeb(response.body as never) : null;
    return {
      status: response.status,
      header: name => String(response.headers.get(name) || ''),
      stream,
      discard: () => { stream?.destroy(); },
    };
  }
  const response = await pinnedHttpsRequest(url, addresses[0]);
  return {
    status: Number(response.statusCode || 0),
    header: name => {
      const value = response.headers[name.toLowerCase()];
      return Array.isArray(value) ? String(value[0] || '') : String(value || '');
    },
    stream: response,
    discard: () => response.destroy(),
  };
}

async function openApprovedDownload(startUrl: string, approvedHosts: string[]): Promise<{ response: ApprovedDownloadResponse; finalUrl: URL }> {
  let current = new URL(startUrl);
  let throttledRetries = 0;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    assertApprovedMaterialDownloadUrl(current, approvedHosts);
    const addresses = await publicDnsAddresses(current.hostname);
    // Direct mode pins the policy-checked address. Proxy mode must let the
    // proxy resolve it, but still requires a public DNS answer before every
    // manually handled hop and applies the same host allowlist.
    const response = await approvedResponse(current, addresses);
    const status = response.status;
    if (status === 429 && throttledRetries < 3) {
      const retryAfterSeconds = Number(response.header('retry-after') || 0);
      await response.discard();
      throttledRetries += 1;
      const waitMs = Math.min(30_000, Math.max(5_000 * throttledRetries, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1_000 : 0));
      await new Promise(resolve => setTimeout(resolve, waitMs));
      redirect -= 1;
      continue;
    }
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.header('location');
      await response.discard();
      if (!location) throw new Error(`下载重定向缺少 Location（HTTP ${status}）`);
      current = new URL(location, current);
      continue;
    }
    if (status < 200 || status >= 300) {
      await response.discard();
      throw new Error(`下载失败（HTTP ${status}）`);
    }
    return { response, finalUrl: current };
  }
  throw new Error('下载重定向超过 5 次');
}

async function downloadApprovedSource(asset: MaterialImportAsset, destination: string): Promise<DownloadResult> {
  const { response, finalUrl } = await openApprovedDownload(asset.source.downloadUrl, asset.source.approvedDownloadHosts);
  const declaredBytes = Number(response.header('content-length') || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SOURCE_DOWNLOAD_BYTES) {
    await response.discard();
    throw new Error(`源视频超过临时下载上限 ${MAX_SOURCE_DOWNLOAD_BYTES} bytes`);
  }
  const contentType = response.header('content-type').split(';', 1)[0].trim().toLowerCase();
  if (contentType && !contentType.startsWith('video/') && !['application/octet-stream', 'application/ogg'].includes(contentType)) {
    await response.discard();
    throw new Error(`下载内容不是视频：${contentType}`);
  }
  if (!response.stream) throw new Error('下载响应没有内容');
  let bytes = 0;
  const hash = createHash('sha256');
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_SOURCE_DOWNLOAD_BYTES) {
        callback(new Error(`源视频超过临时下载上限 ${MAX_SOURCE_DOWNLOAD_BYTES} bytes`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(response.stream, limiter, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  } catch (error) {
    fs.rmSync(destination, { force: true });
    throw error;
  }
  if (!bytes) throw new Error('下载的视频为空文件');
  const sourceSha256 = hash.digest('hex');
  if (asset.expectedSourceSha256 && sourceSha256 !== asset.expectedSourceSha256) {
    throw new Error(`源文件 SHA-256 不一致：期望 ${asset.expectedSourceSha256}，实际 ${sourceSha256}`);
  }
  return { sourceSha256, bytes, contentType, finalUrl };
}

async function cachedSource(asset: MaterialImportAsset, tempRoot: string, cache: DownloadCache): Promise<CachedDownload> {
  const key = createHash('sha256').update(asset.source.downloadUrl, 'utf8').digest('hex');
  const existing = cache.get(key);
  if (existing) {
    assertApprovedMaterialDownloadUrl(existing.finalUrl, asset.source.approvedDownloadHosts);
    if (asset.expectedSourceSha256 && asset.expectedSourceSha256 !== existing.sourceSha256) {
      throw new Error(`同一下载地址声明了不同的源文件 SHA-256：${asset.id}`);
    }
    return existing;
  }
  const downloads = path.join(tempRoot, 'downloads');
  fs.mkdirSync(downloads, { recursive: true, mode: 0o700 });
  const sourcePath = path.join(downloads, `${key}.source`);
  const result = await downloadApprovedSource(asset, sourcePath);
  const cached = { ...result, path: sourcePath };
  cache.set(key, cached);
  return cached;
}

function materializeCachedSource(cached: CachedDownload, destination: string): void {
  try {
    fs.linkSync(cached.path, destination);
  } catch {
    fs.copyFileSync(cached.path, destination, fs.constants.COPYFILE_EXCL);
  }
}

function ffmpegBinary(): string {
  if (!ffmpegStatic) throw new Error('当前运行环境缺少 ffmpeg，不能安全规范化视频');
  return String(ffmpegStatic);
}

function runFfmpeg(args: string[], timeout = 20 * 60 * 1000): void {
  const result = spawnSync(ffmpegBinary(), ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
    encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg 失败：${String(result.stderr || '').trim().slice(-2_000)}`);
}

function probeMedia(filePath: string): MediaMetadata {
  const result = spawnSync(ffmpegBinary(), ['-hide_banner', '-i', filePath], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const videoMatch = output.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  if (!durationMatch || !videoMatch) throw new Error('无法识别有效的视频轨或时长');
  const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('视频时长无效');
  return { duration, width: Number(videoMatch[1]), height: Number(videoMatch[2]) };
}

function transcodeVideo(sourcePath: string, outputPath: string, manifest: MaterialImportManifest, asset: MaterialImportAsset): MediaMetadata {
  const source = probeMedia(sourcePath);
  if (source.width > 7680 || source.height > 7680 || source.width * source.height > 35_000_000) {
    throw new Error('源视频分辨率过高，拒绝在导入进程中解码');
  }
  const requestedEnd = asset.clip ? asset.clip.startSeconds + (asset.clip.durationSeconds ?? source.duration) : source.duration;
  if (asset.clip && (asset.clip.startSeconds >= source.duration || requestedEnd > source.duration + 0.25)) {
    throw new Error('manifest 的 clip 区间超出源视频时长');
  }
  if (!asset.clip?.durationSeconds && source.duration > 30 * 60) {
    throw new Error('源视频超过 30 分钟，必须在 manifest 中显式设置短片 clip');
  }
  const trimArgs = [
    ...(asset.clip ? ['-ss', String(asset.clip.startSeconds)] : []),
    '-i', sourcePath,
    ...(asset.clip?.durationSeconds ? ['-t', String(asset.clip.durationSeconds)] : []),
  ];
  const scale = `scale=w='min(${manifest.normalization.maxWidth},iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  runFfmpeg([
    '-y', ...trimArgs,
    '-map', '0:v:0', '-map', '0:a:0?', '-vf', scale,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(manifest.normalization.crf),
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-map_metadata', '-1', '-sn', '-dn', outputPath,
  ]);
  let metadata = probeMedia(outputPath);
  if (fs.statSync(outputPath).size > POCKETBASE_MATERIAL_MAX_BYTES) {
    const constrainedPath = `${outputPath}.constrained.mp4`;
    const totalBitsPerSecond = Math.floor((POCKETBASE_MATERIAL_MAX_BYTES * 8 * 0.92) / metadata.duration);
    const videoBitsPerSecond = totalBitsPerSecond - 96_000;
    if (videoBitsPerSecond < 500_000) {
      throw new Error('视频过长，压到 100 MiB 以下会明显损害质量；请在 manifest 中设置 clip');
    }
    runFfmpeg([
      '-y', '-i', outputPath, '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'medium', '-b:v', String(videoBitsPerSecond),
      '-maxrate', String(Math.floor(videoBitsPerSecond * 1.15)), '-bufsize', String(videoBitsPerSecond * 2),
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart', '-map_metadata', '-1', '-sn', '-dn', constrainedPath,
    ]);
    fs.renameSync(constrainedPath, outputPath);
    metadata = probeMedia(outputPath);
  }
  const size = fs.statSync(outputPath).size;
  if (!size || size > POCKETBASE_MATERIAL_MAX_BYTES) throw new Error('规范化视频仍超过 PocketBase 100 MiB 上限');
  return metadata;
}

function createPoster(videoPath: string, posterPath: string, duration: number): void {
  const seek = Math.max(0, Math.min(1, duration / 3));
  runFfmpeg(['-y', '-ss', String(seek), '-i', videoPath, '-frames:v', '1', '-vf', "scale=w='min(720,iw)':h=-2", '-q:v', '3', posterPath], 60_000);
  const size = fs.statSync(posterPath).size;
  if (!size || size > POCKETBASE_POSTER_MAX_BYTES) throw new Error('封面为空或超过 PocketBase 5 MiB 上限');
}

async function pbFetch(apiPath: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getPbAdminToken();
  if (!token) throw new Error('PocketBase 管理员认证失败，请检查 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD');
  const response = await fetch(`${getPbUrl()}${apiPath}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: token },
    signal: AbortSignal.timeout(PB_IMPORT_TIMEOUT_MS),
  });
  if ((response.status === 401 || response.status === 403) && retry) {
    invalidatePbAdminToken();
    return pbFetch(apiPath, init, false);
  }
  return response;
}

async function assertMaterialSchema(): Promise<void> {
  const response = await pbFetch(`/api/collections/${COLLECTION}`);
  if (!response.ok) throw new Error(`读取 materials schema 失败（HTTP ${response.status}）`);
  const collection = await response.json() as { fields?: Array<{ name?: string; type?: string; maxSize?: number }> };
  const fields = new Map((collection.fields || []).map(field => [String(field.name || ''), field]));
  const missing = REQUIRED_COLLECTION_FIELDS.filter(name => !fields.has(name));
  if (missing.length) throw new Error(`materials schema 缺少字段：${missing.join(', ')}。请先运行正式 PocketBase migration`);
  for (const [name, contract] of Object.entries(MATERIAL_FIELD_CONTRACT)) {
    const field = fields.get(name);
    if (String(field?.type || '') !== contract.type) {
      throw new Error(`materials.${name} 必须是 ${contract.type} 字段`);
    }
    if (contract.minMaxSize && Number(field?.maxSize || 0) < contract.minMaxSize) {
      throw new Error(`materials.${name} maxSize 必须至少为 ${contract.minMaxSize}`);
    }
  }
  if (Number(fields.get('videoFile')?.maxSize) !== POCKETBASE_MATERIAL_MAX_BYTES) {
    throw new Error('materials.videoFile 必须严格配置为 100 MiB');
  }
  if (Number(fields.get('posterFile')?.maxSize) !== POCKETBASE_POSTER_MAX_BYTES) {
    throw new Error('materials.posterFile 必须严格配置为 5 MiB');
  }
}

function pbFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function readInventory(manifest: MaterialImportManifest): Promise<Inventory> {
  const filter = manifest.scope === 'shared'
    ? 'scope = "shared"'
    : `scope = "own" && tenantId = "${pbFilterValue(manifest.tenantId)}"`;
  const inventory: Inventory = { records: 0, totalBytes: 0, unknownSizeRecords: 0, hashes: new Set() };
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({ page: String(page), perPage: '500', filter, fields: 'id,sizeBytes,sha256' });
    const response = await pbFetch(`/api/collections/${COLLECTION}/records?${query}`);
    if (!response.ok) throw new Error(`读取素材库存失败（HTTP ${response.status}）`);
    const data = await response.json() as { items?: Array<Record<string, unknown>>; totalPages?: number };
    for (const item of data.items || []) {
      inventory.records += 1;
      const bytes = Number(item.sizeBytes || 0);
      if (Number.isFinite(bytes) && bytes > 0) inventory.totalBytes += bytes;
      else inventory.unknownSizeRecords += 1;
      const hash = String(item.sha256 || '').toLowerCase();
      if (/^[a-f0-9]{64}$/.test(hash)) inventory.hashes.add(hash);
    }
    if (page >= Number(data.totalPages || 1)) return inventory;
  }
  throw new Error('素材库存分页超过 50,000 条，拒绝在不完整库存上执行容量判断');
}

function licenseEvidence(manifest: MaterialImportManifest, manifestSha256: string, asset: MaterialImportAsset, evidenceTextSha256: string): string {
  return JSON.stringify({
    version: 1,
    batchId: manifest.batchId,
    manifestSha256,
    provider: asset.source.provider,
    creator: asset.source.creator,
    sourcePageUrl: asset.source.pageUrl,
    licenseName: asset.license.name,
    licenseUrl: asset.license.url,
    capturedAt: asset.license.capturedAt,
    evidence: asset.license.evidence,
    evidenceTextSha256,
    attributionText: asset.license.attributionText,
    approval: asset.approval,
  });
}

async function uploadMaterial(input: {
  manifest: MaterialImportManifest;
  asset: MaterialImportAsset;
  videoPath: string;
  posterPath: string;
  metadata: MediaMetadata;
  manifestSha256: string;
  sourceSha256: string;
  normalizedSha256: string;
  importedAt: string;
  finalDownloadHost: string;
}): Promise<string> {
  const provenance = buildMaterialImportProvenance(input);
  const visualMetadata = buildMaterialImportVisualMetadata({
    asset: input.asset,
    duration: input.metadata.duration,
    normalizedSha256: input.normalizedSha256,
  });
  const evidenceTextSha256 = provenance.license.evidenceTextSha256;
  const form = new FormData();
  const fields: Record<string, string> = {
    tenantId: input.manifest.tenantId,
    title: input.asset.title,
    folder: input.asset.folder,
    type: 'video',
    duration: String(input.metadata.duration),
    width: String(input.metadata.width),
    height: String(input.metadata.height),
    sizeBytes: String(fs.statSync(input.videoPath).size),
    sha256: input.normalizedSha256,
    tags: input.asset.tags.join(','),
    industry: input.asset.industry,
    shotFunction: input.asset.shotFunction,
    applicability: input.asset.applicability,
    scope: input.manifest.scope,
    usage: 'editable',
    sourceType: input.asset.license.name.toLowerCase().includes('public domain') ? 'public_domain' : 'licensed_upload',
    sourceName: input.asset.source.creator,
    sourceProvider: input.asset.source.provider,
    sourceCreator: input.asset.source.creator,
    sourceUrl: input.asset.source.pageUrl,
    licenseEvidence: licenseEvidence(input.manifest, input.manifestSha256, input.asset, evidenceTextSha256),
    licenseName: input.asset.license.name,
    licenseUrl: input.asset.license.url,
    attributionText: input.asset.license.attributionText,
    licenseEvidenceCapturedAt: input.asset.license.capturedAt,
    licenseEvidenceTextSha256: evidenceTextSha256,
    importBatchId: input.manifest.batchId,
    manifestSha256: input.manifestSha256,
    importedAt: input.importedAt,
    commercialUseApproved: 'true',
    derivativesApproved: 'true',
    rawLibraryUseApproved: 'true',
    provenance: JSON.stringify(provenance),
    visualObservations: JSON.stringify(visualMetadata.visualObservations),
    segments: JSON.stringify(visualMetadata.segments),
    segmentAnalysisStatus: visualMetadata.segmentAnalysisStatus,
    analysisSourceRevision: visualMetadata.analysisSourceRevision,
  };
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('videoFile', await fs.openAsBlob(input.videoPath, { type: 'video/mp4' }), `${safeFileName(input.asset.id)}.mp4`);
  form.append('posterFile', await fs.openAsBlob(input.posterPath, { type: 'image/jpeg' }), `${safeFileName(input.asset.id)}.jpg`);
  const response = await pbFetch(`/api/collections/${COLLECTION}/records`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`PocketBase 上传失败（HTTP ${response.status}）：${(await response.text()).slice(0, 1_000)}`);
  const record = await response.json() as { id?: string };
  if (!record.id) throw new Error('PocketBase 上传成功但没有返回记录 ID');
  return record.id;
}

async function importAsset(manifest: MaterialImportManifest, manifestSha256: string, asset: MaterialImportAsset, tempRoot: string, inventory: Inventory, cache: DownloadCache): Promise<{ status: 'imported' | 'skipped'; id?: string; bytes?: number }> {
  const workDir = fs.mkdtempSync(path.join(tempRoot, `${safeFileName(asset.id)}-`));
  const sourcePath = path.join(workDir, 'source');
  const videoPath = path.join(workDir, 'normalized.mp4');
  const posterPath = path.join(workDir, 'poster.jpg');
  try {
    const download = await cachedSource(asset, tempRoot, cache);
    materializeCachedSource(download, sourcePath);
    const metadata = transcodeVideo(sourcePath, videoPath, manifest, asset);
    createPoster(videoPath, posterPath, metadata.duration);
    const normalizedSha256 = sha256File(videoPath);
    if (inventory.hashes.has(normalizedSha256)) return { status: 'skipped' };
    const bytes = fs.statSync(videoPath).size;
    if (inventory.records + 1 > manifest.capacity.maxRecords) {
      throw new Error(`素材库条数将超过清单上限 ${manifest.capacity.maxRecords}`);
    }
    if (inventory.totalBytes + bytes > manifest.capacity.maxTotalBytes) {
      throw new Error(`素材库体积将超过清单上限 ${manifest.capacity.maxTotalBytes} bytes`);
    }
    const importedAt = new Date().toISOString();
    const id = await uploadMaterial({
      manifest, manifestSha256, asset, videoPath, posterPath, metadata,
      sourceSha256: download.sourceSha256, normalizedSha256, importedAt,
      finalDownloadHost: download.finalUrl.hostname,
    });
    inventory.records += 1;
    inventory.totalBytes += bytes;
    inventory.hashes.add(normalizedSha256);
    return { status: 'imported', id, bytes };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv);
  const { manifest, manifestSha256 } = loadManifest(args.manifestPath);
  const enabled = manifest.assets.filter(asset => asset.enabled);
  const summary: ImportSummary = {
    planned: enabled.length,
    disabled: manifest.assets.length - enabled.length,
    imported: 0,
    skipped: 0,
    failed: 0,
  };
  console.log(JSON.stringify({
    mode: args.apply ? 'apply' : 'dry-run',
    batchId: manifest.batchId,
    manifestSha256,
    scope: manifest.scope,
    tenantId: manifest.scope === 'own' ? manifest.tenantId : undefined,
    capacity: manifest.capacity,
    assets: enabled.map(asset => ({ id: asset.id, title: asset.title, sourcePageUrl: asset.source.pageUrl })),
    disabled: summary.disabled,
  }, null, 2));
  if (!args.apply) {
    console.log('[material-import] manifest valid; no network, filesystem media, PocketBase or app data was changed');
    return;
  }
  if (!enabled.length) throw new Error('没有 enabled 素材；拒绝执行空导入');
  assertTrustedReviewers(manifest);

  await assertMaterialSchema();
  const inventory = await readInventory(manifest);
  if (inventory.records + enabled.length > manifest.capacity.maxRecords) {
    console.warn(`[material-import] 计划条数可能超过容量；重复文件会跳过。当前 ${inventory.records}，计划 ${enabled.length}，上限 ${manifest.capacity.maxRecords}`);
  }
  if (inventory.unknownSizeRecords) {
    throw new Error(`${inventory.unknownSizeRecords} 条历史素材没有 sizeBytes，无法可信计算 500 MiB 容量；请先补齐数据后再导入`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-import-'));
  const cache: DownloadCache = new Map();
  const interruptCleanup = () => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    process.exit(130);
  };
  process.once('SIGINT', interruptCleanup);
  process.once('SIGTERM', interruptCleanup);
  try {
    for (const asset of enabled) {
      try {
        const result = await importAsset(manifest, manifestSha256, asset, tempRoot, inventory, cache);
        if (result.status === 'skipped') {
          summary.skipped += 1;
          console.log(JSON.stringify({ asset: asset.id, status: 'skipped_duplicate' }));
        } else {
          summary.imported += 1;
          console.log(JSON.stringify({ asset: asset.id, status: 'imported', recordId: result.id, bytes: result.bytes }));
        }
      } catch (error) {
        summary.failed += 1;
        console.error(JSON.stringify({ asset: asset.id, status: 'failed', error: error instanceof Error ? error.message : String(error) }));
      }
    }
  } finally {
    process.off('SIGINT', interruptCleanup);
    process.off('SIGTERM', interruptCleanup);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    await closeProxyAgent();
  }
  console.log(JSON.stringify({ complete: summary.failed === 0, ...summary }));
  if (summary.failed) process.exitCode = 1;
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch(error => {
    if (error instanceof MaterialImportManifestError) console.error(error.message);
    else console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
