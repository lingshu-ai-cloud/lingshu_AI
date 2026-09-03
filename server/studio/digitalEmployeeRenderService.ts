import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { enterpriseAssetObjectKey, enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { objectStorageEnabled, r2Download, r2Head } from '../storage/r2.js';
import { synthesizeDigitalEmployeeVoiceover } from './digitalEmployeeVoiceoverService.js';

const require = createRequire(import.meta.url);
const { composite } = require('../../desktop/render.cjs') as {
  composite: (
    manifest: unknown,
    onProgress?: (percentage: number) => void,
    outputDirectory?: string,
    runtimeOptions?: { signal?: AbortSignal; requireTimelineAssets?: boolean; maxDownloadBytes?: number; downloadTimeoutMs?: number },
  ) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
};

type Product = NonNullable<EnterpriseProfile['products']['items']>[number];
type ProductAsset = { name: string; type: string; size: number; updatedAt: string; url?: string };
type RenderAsset = { url: string; type: 'image' | 'video'; name: string; bytes: Buffer; contentType: string; sha256: string };

export interface DigitalEmployeeRenderResult {
  status: 'rendered' | 'not_available';
  videoPath?: string;
  videoSha256?: string;
  videoBytes?: number;
  durationSeconds?: number;
  sourceAssetCount: number;
  reason?: string;
  voiceoverStatus?: 'generated' | 'silent_fallback' | 'not_available';
  voiceoverProvider?: 'qwen_tts' | 'minimax';
  voiceoverVoice?: string;
  voiceoverUrl?: string;
  voiceoverSha256?: string;
  voiceoverBytes?: number;
  voiceoverDurationSeconds?: number;
  voiceoverSourceTextSha256?: string;
  voiceoverReason?: string;
}

function text(value: unknown, max = 2_000): string { return String(value ?? '').trim().slice(0, max); }
function safeTenantFolder(tenantId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(tenantId) || tenantId === '.' || tenantId === '..') {
    throw new Error('digital_employee_render_invalid_tenant_id');
  }
  return tenantId;
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function configuredBytes(name: string, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number(process.env[name]);
  const value = Number.isFinite(candidate) ? candidate : fallback;
  return Math.round(Math.max(minimum, Math.min(maximum, value)));
}

function sniffAsset(bytes: Buffer): { type: 'image' | 'video'; contentType: string } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'image', contentType: 'image/png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { type: 'image', contentType: 'image/jpeg' };
  }
  const prefix6 = bytes.subarray(0, 6).toString('ascii');
  if (prefix6 === 'GIF87a' || prefix6 === 'GIF89a') return { type: 'image', contentType: 'image/gif' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { type: 'image', contentType: 'image/webp' };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { type: 'video', contentType: 'video/webm' };
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii').toLowerCase();
    if (['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1'].includes(brand)) return null;
    return { type: 'video', contentType: brand.trim() === 'qt' ? 'video/quicktime' : 'video/mp4' };
  }
  return null;
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => digest.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(digest.digest('hex')));
  });
}

function relevantProducts(profile: EnterpriseProfile, focusProducts: string[]): Product[] {
  const products = profile.products.items || [];
  const focus = new Set(focusProducts.map(item => item.toLowerCase()));
  const matching = products.filter(item => focus.has(text(item.name, 300).toLowerCase()));
  return matching.length ? matching : products.slice(0, 3);
}

function productAssets(product: Product): ProductAsset[] {
  const imageUrl = text(product.imageUrl, 4_000);
  return [
    ...(imageUrl ? [{ name: `${product.name}-image`, type: 'image/url', size: 0, updatedAt: '', url: imageUrl }] : []),
    ...list(product.images),
    ...list(product.sceneImages),
    ...list(product.factoryImages),
    ...list(product.packagingImages),
    ...list(product.brandAssets),
    ...list(product.videos),
  ].filter(item => item && typeof item === 'object') as ProductAsset[];
}

function storedEnterpriseFilename(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url, 'http://internal.invalid'); } catch { return null; }
  const prefix = '/api/overseas/enterprise/assets/';
  if (!parsed.pathname.startsWith(prefix)) return null;
  const raw = parsed.pathname.slice(prefix.length);
  if (!raw || raw.includes('/')) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const filename = path.basename(decoded);
    return filename && filename === decoded ? filename : null;
  } catch {
    return null;
  }
}

async function readStoredAsset(input: {
  tenantId: string;
  asset: ProductAsset;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<RenderAsset | null> {
  const url = text(input.asset.url, 4_000);
  const filename = storedEnterpriseFilename(url);
  if (!filename) return null;
  const declared = text(input.asset.type, 120).toLowerCase();
  const extension = path.extname(filename).toLowerCase();
  const type: 'image' | 'video' | null = declared.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)
    ? 'image'
    : declared.startsWith('video/') || ['.mp4', '.mov', '.webm'].includes(extension)
      ? 'video'
      : null;
  if (!type) return null;
  let bytes: Buffer;
  if (objectStorageEnabled()) {
    const key = enterpriseAssetObjectKey(input.tenantId, filename);
    const head = await r2Head(key);
    if (!head || head.size <= 0 || head.size > input.maxBytes) return null;
    if (input.signal?.aborted) throw input.signal.reason || new Error('render_aborted');
    const object = await r2Download(key);
    if (!object) return null;
    bytes = object.buf;
  } else {
    const root = path.resolve(process.cwd(), 'data', 'enterprise-assets', enterpriseAssetTenantKey(input.tenantId));
    const filePath = path.resolve(root, filename);
    if (path.dirname(filePath) !== root) return null;
    const stat = await fs.promises.lstat(filePath).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > input.maxBytes) return null;
    bytes = await fs.promises.readFile(filePath);
  }
  if (input.signal?.aborted) throw input.signal.reason || new Error('render_aborted');
  if (bytes.length <= 0 || bytes.length > input.maxBytes) return null;
  const detected = sniffAsset(bytes);
  if (!detected || detected.type !== type) return null;
  return {
    url,
    type,
    name: text(input.asset.name, 240) || filename,
    bytes,
    contentType: detected.contentType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function cueLines(draft: Record<string, unknown>): string[] {
  const storyboard = list(draft.storyboard).filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>;
  const storyboardLines = storyboard.map(item => text(item.voice, 1_000)).filter(Boolean);
  if (storyboardLines.length) return storyboardLines;
  const voiceover = list(draft.voiceover).map(item => text(item, 1_000)).filter(Boolean);
  if (voiceover.length) return voiceover;
  return [text(draft.hook, 500), text(draft.caption, 1_500), text(draft.cta, 500)].filter(Boolean);
}

function storyboardDurations(draft: Record<string, unknown>, count: number): number[] {
  const storyboard = list(draft.storyboard).filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>;
  if (storyboard.length) return storyboard.slice(0, count).map(item => Math.max(1.5, Math.min(8, Number(item.durationSeconds) || 3)));
  return Array.from({ length: count }, () => 3);
}

function subtitleCues(lines: string[], duration: number): Array<{ start: number; end: number; text: string }> {
  const usable = lines.length ? lines : [''];
  const weights = usable.map(line => Math.max(1, line.replace(/\s/g, '').length));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  return usable.map((line, index) => {
    const start = cursor;
    const end = index === usable.length - 1 ? duration : Math.min(duration, start + duration * weights[index] / total);
    cursor = end;
    return { start: Number(start.toFixed(2)), end: Number(Math.max(start + 0.25, end).toFixed(2)), text: line };
  }).filter(item => item.text);
}

export async function renderDigitalEmployeeDraft(input: {
  tenantId: string;
  runId: string;
  taskId: string;
  profile: EnterpriseProfile;
  focusProducts: string[];
  draft: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<DigitalEmployeeRenderResult> {
  if (input.signal?.aborted) throw input.signal.reason || new Error('render_aborted');
  const candidates = relevantProducts(input.profile, input.focusProducts).flatMap(productAssets);
  const seen = new Set<string>();
  const maxAssetBytes = configuredBytes('DIGITAL_EMPLOYEE_RENDER_MAX_ASSET_BYTES', 25 * 1024 * 1024, 1_000_000, 100 * 1024 * 1024);
  const maxTotalBytes = Math.max(maxAssetBytes, configuredBytes('DIGITAL_EMPLOYEE_RENDER_MAX_TOTAL_BYTES', 75 * 1024 * 1024, 1_000_000, 250 * 1024 * 1024));
  const assets: RenderAsset[] = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    if (input.signal?.aborted) throw input.signal.reason || new Error('render_aborted');
    const url = text(candidate.url, 4_000);
    if (!url || seen.has(url) || assets.length >= 6) continue;
    seen.add(url);
    const asset = await readStoredAsset({ tenantId: input.tenantId, asset: candidate, maxBytes: maxAssetBytes, signal: input.signal });
    if (!asset || totalBytes + asset.bytes.length > maxTotalBytes) continue;
    assets.push(asset);
    totalBytes += asset.bytes.length;
  }
  if (!assets.length) {
    return { status: 'not_available', sourceAssetCount: 0, reason: 'verified_product_media_missing' };
  }

  const lines = cueLines(input.draft).slice(0, 10);
  const voiceover = await synthesizeDigitalEmployeeVoiceover({
    tenantId: input.tenantId,
    text: lines.join('\n'),
    language: text(input.draft.language, 30) || 'en',
    signal: input.signal,
  });
  if (voiceover.status === 'not_available') {
    return {
      status: 'not_available', sourceAssetCount: assets.length,
      reason: voiceover.reason || 'voiceover_not_available',
      voiceoverStatus: voiceover.status,
      voiceoverSourceTextSha256: voiceover.sourceTextSha256,
      voiceoverReason: voiceover.reason,
    };
  }
  const shotCount = Math.max(1, Math.min(10, Math.max(lines.length, assets.length)));
  const requestedDurations = storyboardDurations(input.draft, shotCount);
  while (requestedDurations.length < shotCount) requestedDurations.push(3);
  const requestedDuration = requestedDurations.reduce((sum, value) => sum + value, 0);
  const duration = Math.max(3, Math.min(60, Math.max(requestedDuration, voiceover.durationSeconds || 0)));
  const durationScale = requestedDuration > 0 ? duration / requestedDuration : 1;
  const durations = requestedDurations.map(value => value * durationScale);
  const platform = text(input.draft.platform, 30).toLowerCase() || 'tiktok';
  const ratio = platform === 'youtube' ? '16:9' : platform === 'linkedin' ? '1:1' : '9:16';
  const timeline = Array.from({ length: shotCount }, (_, index) => {
    const asset = assets[index % assets.length];
    return {
      index,
      name: asset.name,
      type: asset.type,
      bytes: asset.bytes,
      trimStart: 0,
      trimEnd: durations[index],
      targetDuration: durations[index],
    };
  });
  const renderFingerprint = createHash('sha256').update(JSON.stringify({
    version: 3,
    tenantId: input.tenantId,
    runId: input.runId,
    taskId: input.taskId,
    draft: input.draft,
    ratio,
    duration,
    voiceover: {
      status: voiceover.status,
      provider: voiceover.provider || '',
      sha256: voiceover.audioSha256 || '',
      sourceTextSha256: voiceover.sourceTextSha256,
      durationSeconds: voiceover.durationSeconds || 0,
      reason: voiceover.reason || '',
    },
    timeline: timeline.map(item => ({
      name: item.name,
      type: item.type,
      sha256: assets[item.index % assets.length].sha256,
      trimStart: item.trimStart,
      trimEnd: item.trimEnd,
      targetDuration: item.targetDuration,
    })),
  })).digest('hex');
  const outputDirectory = path.resolve(process.cwd(), 'data', 'publishing-uploads', safeTenantFolder(input.tenantId));
  await fs.promises.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const finalPath = path.resolve(outputDirectory, `digital-employee-${renderFingerprint.slice(0, 48)}.mp4`);
  if (path.dirname(finalPath) !== outputDirectory) throw new Error('digital_employee_render_output_boundary_violation');
  const existing = await inspectRenderedVideo(input.tenantId, finalPath);
  if (existing) {
    return {
      status: 'rendered', videoPath: finalPath, videoSha256: existing.sha256, videoBytes: existing.bytes,
      durationSeconds: duration, sourceAssetCount: assets.length,
      voiceoverStatus: voiceover.status, voiceoverProvider: voiceover.provider,
      voiceoverVoice: voiceover.voice,
      voiceoverUrl: voiceover.audioUrl,
      voiceoverSha256: voiceover.audioSha256, voiceoverBytes: voiceover.audioSizeBytes,
      voiceoverDurationSeconds: voiceover.durationSeconds, voiceoverSourceTextSha256: voiceover.sourceTextSha256,
      voiceoverReason: voiceover.reason,
    };
  }
  let quarantinedArtifact = '';
  if (await fs.promises.stat(finalPath).then(() => true).catch(() => false)) {
    quarantinedArtifact = `${finalPath}.invalid-${randomUUID()}`;
    try {
      await fs.promises.rename(finalPath, quarantinedArtifact);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      quarantinedArtifact = '';
    }
  }

  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'digital-employee-render-'));
  let promotionCandidate = '';
  try {
    const rendered = await composite({
      jobId: renderFingerprint,
      requireTimelineAssets: true,
      spec: { ratio, duration, platform, language: text(input.draft.language, 30) || 'en', bgmVol: 0, voiceVol: 100 },
      script: lines.join('\n'),
      timeline,
      voiceover: {
        voice: voiceover.voice || null,
        url: voiceover.audioBytes && voiceover.mimeType
          ? `data:${voiceover.mimeType};base64,${voiceover.audioBytes.toString('base64')}`
          : null,
      },
      cover: { id: null, title: text(input.draft.title, 300), url: null },
      bgm: { id: null, url: null },
      subtitles: { mode: 'target', style: {}, cues: subtitleCues(lines, duration) },
    }, undefined, temporaryDirectory, {
      signal: input.signal,
      requireTimelineAssets: true,
      maxDownloadBytes: Math.max(maxAssetBytes, voiceover.audioSizeBytes || 0),
      downloadTimeoutMs: 45_000,
    });
    if (!rendered.ok || !rendered.outputPath) {
      throw new Error(`digital_employee_render_failed:${text(rendered.error, 500) || 'unknown'}`);
    }
    const renderedPath = path.resolve(rendered.outputPath);
    if (path.dirname(renderedPath) !== temporaryDirectory) throw new Error('digital_employee_render_temp_boundary_violation');
    const renderedVideo = await inspectRenderedVideoAtPath(renderedPath);
    if (!renderedVideo) throw new Error('digital_employee_render_invalid_output');
    if (input.signal?.aborted) throw input.signal.reason || new Error('render_aborted');

    promotionCandidate = path.join(outputDirectory, `.${path.basename(finalPath)}.${process.pid}-${randomUUID()}.tmp`);
    await fs.promises.copyFile(renderedPath, promotionCandidate, fs.constants.COPYFILE_EXCL);
    await fs.promises.chmod(promotionCandidate, 0o600);
    try {
      await fs.promises.link(promotionCandidate, finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const promoted = await inspectRenderedVideo(input.tenantId, finalPath);
    if (!promoted) throw new Error('digital_employee_render_promotion_failed');
    if (quarantinedArtifact) {
      await fs.promises.rm(quarantinedArtifact, { force: true }).catch(() => undefined);
      quarantinedArtifact = '';
    }
    return {
      status: 'rendered', videoPath: finalPath, videoSha256: promoted.sha256, videoBytes: promoted.bytes,
      durationSeconds: duration, sourceAssetCount: assets.length,
      voiceoverStatus: voiceover.status, voiceoverProvider: voiceover.provider,
      voiceoverVoice: voiceover.voice,
      voiceoverUrl: voiceover.audioUrl,
      voiceoverSha256: voiceover.audioSha256, voiceoverBytes: voiceover.audioSizeBytes,
      voiceoverDurationSeconds: voiceover.durationSeconds, voiceoverSourceTextSha256: voiceover.sourceTextSha256,
      voiceoverReason: voiceover.reason,
    };
  } finally {
    if (promotionCandidate) await fs.promises.rm(promotionCandidate, { force: true }).catch(() => undefined);
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function inspectRenderedVideoAtPath(videoPath: string): Promise<{ sha256: string; bytes: number } | null> {
  const maximum = configuredBytes('DIGITAL_EMPLOYEE_RENDER_MAX_OUTPUT_BYTES', 512 * 1024 * 1024, 1_000_000, 2 * 1024 * 1024 * 1024);
  const stat = await fs.promises.lstat(videoPath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > maximum) return null;
  const handle = await fs.promises.open(videoPath, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const header = Buffer.alloc(Math.min(32, stat.size));
    await handle.read(header, 0, header.length, 0);
    if (sniffAsset(header)?.type !== 'video') return null;
  } finally {
    await handle.close();
  }
  return { sha256: await hashFile(videoPath), bytes: stat.size };
}

async function inspectRenderedVideo(tenantId: string, videoPath: string): Promise<{ sha256: string; bytes: number } | null> {
  const root = path.resolve(process.cwd(), 'data', 'publishing-uploads', safeTenantFolder(tenantId));
  const resolved = path.resolve(videoPath);
  if (path.dirname(resolved) !== root || path.extname(resolved).toLowerCase() !== '.mp4') return null;
  return inspectRenderedVideoAtPath(resolved);
}

export async function verifyDigitalEmployeeRenderedVideo(input: {
  tenantId: string;
  videoPath: string;
  videoSha256: string;
}): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(input.videoSha256.toLowerCase())) return false;
  const inspected = await inspectRenderedVideo(input.tenantId, input.videoPath);
  return Boolean(inspected && inspected.sha256 === input.videoSha256.toLowerCase());
}
