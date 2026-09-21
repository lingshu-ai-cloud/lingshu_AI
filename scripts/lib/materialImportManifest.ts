import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const MATERIAL_IMPORT_MANIFEST_VERSION = 1;
export const POCKETBASE_MATERIAL_MAX_BYTES = 100 * 1024 * 1024;
export const POCKETBASE_POSTER_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MATERIAL_LIBRARY_MAX_RECORDS = 50;
export const DEFAULT_MATERIAL_LIBRARY_MAX_BYTES = 500 * 1024 * 1024;
export const MAX_MATERIAL_IMPORT_ASSETS = 200;

const BLOCKED_REHOST_DOMAINS = [
  'pexels.com',
  'pixabay.com',
  'mixkit.co',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'douyin.com',
  'instagram.com',
  'facebook.com',
  'fb.watch',
  'x.com',
  'twitter.com',
  'xiaohongshu.com',
] as const;

export type MaterialImportScope = 'own' | 'shared';

export interface MaterialImportRights {
  commercialUse: true;
  derivatives: true;
  rawFileStorage: true;
  saasMaterialLibrary: true;
}

export interface MaterialImportReviewedSegment {
  start: 0;
  end: number;
  subject: string[];
  action: string;
  shot: string;
  camera: string;
  environment: string;
  observedFacts: string[];
  confidence: number;
  needsReview: false;
}

export interface MaterialImportVisualReview {
  reviewedBy: string;
  reviewedAt: string;
  reference: string;
  rationale: string;
  visualObservations: string[];
  segment: MaterialImportReviewedSegment;
}

export interface MaterialImportAsset {
  id: string;
  enabled: boolean;
  title: string;
  folder: string;
  source: {
    provider: string;
    creator: string;
    pageUrl: string;
    downloadUrl: string;
    approvedDownloadHosts: string[];
  };
  license: {
    name: string;
    url: string;
    evidence: string;
    capturedAt: string;
    attributionText: string;
  };
  approval: {
    approvedBy: string;
    approvedAt: string;
    reference: string;
    rationale: string;
    rights: MaterialImportRights;
  };
  expectedSourceSha256?: string;
  clip?: { startSeconds: number; durationSeconds?: number };
  industry: string;
  shotFunction: string;
  applicability: string;
  tags: string[];
  visualReview: MaterialImportVisualReview;
}

export interface MaterialImportManifest {
  manifestVersion: 1;
  batchId: string;
  tenantId: string;
  scope: MaterialImportScope;
  usage: 'editable';
  capacity: { maxRecords: number; maxTotalBytes: number };
  normalization: { maxWidth: number; crf: number };
  assets: MaterialImportAsset[];
}

export interface MaterialImportProvenance {
  schemaVersion: 1;
  batchId: string;
  manifestSha256: string;
  manifestAssetId: string;
  importedAt: string;
  importer: 'lingshu-material-import-v1';
  source: {
    provider: string;
    creator: string;
    pageUrl: string;
    downloadHost: string;
    sourceSha256: string;
    normalizedSha256: string;
  };
  license: {
    name: string;
    url: string;
    evidence: string;
    evidenceTextSha256: string;
    capturedAt: string;
    attributionText: string;
  };
  approval: MaterialImportAsset['approval'];
  visualReview: {
    reviewedBy: string;
    reviewedAt: string;
    reference: string;
    rationale: string;
    visualObservations: string[];
    segment: MaterialImportReviewedSegment;
  };
}

export interface MaterialImportVisualMetadata {
  visualObservations: string[];
  segmentAnalysisStatus: 'completed';
  analysisSourceRevision: string;
  segments: Array<MaterialImportReviewedSegment & {
    id: string;
    duration: number;
    manualConfirmed: true;
    shotFunction: string;
    recommendedFunctions: string[];
    visual: string;
    quality: number;
    authenticity: '人工逐片复核';
  }>;
}

export class MaterialImportManifestError extends Error {
  constructor(readonly issues: string[]) {
    super(`素材导入清单校验失败：\n- ${issues.join('\n- ')}`);
    this.name = 'MaterialImportManifestError';
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requiredText(value: unknown, path: string, issues: string[], minLength = 1): string {
  const result = text(value);
  if (result.length < minLength) issues.push(`${path} 必填，且至少 ${minLength} 个字符`);
  return result;
}

function validIsoDate(value: unknown, path: string, issues: string[]): string {
  const result = requiredText(value, path, issues);
  const parsed = Date.parse(result);
  if (result && !Number.isFinite(parsed)) issues.push(`${path} 必须是 ISO 日期时间`);
  else if (Number.isFinite(parsed) && parsed > Date.now() + 5 * 60 * 1000) issues.push(`${path} 不能是未来时间`);
  return result;
}

function isPlaceholderReview(value: string): boolean {
  return /placeholder|replace|todo|example|change[-_ ]?me|your[-_ ]|pending|not[-_ ]?approved|codex|automated|machine[-_ ]?review|ai[-_ ]?review|示例|占位|待替换|请替换|未审批|未复核/i.test(value);
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isBlockedMaterialRehostHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return BLOCKED_REHOST_DOMAINS.some(domain => hostMatches(normalized, domain));
}

function ipv4Parts(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function ipv6BigInt(address: string): bigint | null {
  let normalized = address.toLowerCase().replace(/^\[|\]$/g, '').split('%', 1)[0];
  if (isIP(normalized) !== 6) return null;
  const dotted = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    const octets = ipv4Parts(dotted);
    if (!octets) return null;
    normalized = `${normalized.slice(0, -dotted.length)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[a-f0-9]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6Prefix(address: bigint, base: string, bits: number): boolean {
  const baseValue = ipv6BigInt(base);
  return baseValue !== null && (address >> BigInt(128 - bits)) === (baseValue >> BigInt(128 - bits));
}

/** Reject loopback, private, link-local, documentation and other non-routable destinations. */
export function isPrivateOrReservedIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '').split('%', 1)[0];
  const v4 = ipv4Parts(normalized);
  if (v4) {
    const [a, b, c] = v4;
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }
  const v6 = ipv6BigInt(normalized);
  if (v6 === null) return false;
  return ipv6Prefix(v6, '::', 96)
    || ipv6Prefix(v6, '::ffff:0:0', 96)
    || ipv6Prefix(v6, '64:ff9b:1::', 48)
    || ipv6Prefix(v6, '100::', 64)
    || ipv6Prefix(v6, '2001::', 23)
    || ipv6Prefix(v6, '2001:db8::', 32)
    || ipv6Prefix(v6, '2002::', 16)
    || ipv6Prefix(v6, 'fc00::', 7)
    || ipv6Prefix(v6, 'fe00::', 9)
    || ipv6Prefix(v6, 'ff00::', 8);
}

export function assertApprovedMaterialDownloadUrl(value: string | URL, approvedHosts: string[]): URL {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== 'https:') throw new Error('下载及每次重定向都必须使用 https');
  if (url.username || url.password) throw new Error('下载 URL 不允许内嵌账号或令牌');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!approvedHosts.includes(hostname)) throw new Error(`下载重定向到了未经批准的域名：${hostname}`);
  if (isBlockedMaterialRehostHost(hostname)) throw new Error(`禁止通过导入器转载该平台原片：${hostname}`);
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal') || isPrivateOrReservedIp(hostname)) {
    throw new Error(`下载域名不安全：${hostname}`);
  }
  return url;
}

export function parsePublicHttpsUrl(value: unknown, path: string, issues: string[]): URL | null {
  const raw = requiredText(value, path, issues);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    issues.push(`${path} 不是有效 URL`);
    return null;
  }
  if (parsed.protocol !== 'https:') issues.push(`${path} 只允许 https`);
  if (parsed.username || parsed.password) issues.push(`${path} 不允许内嵌账号或令牌`);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    issues.push(`${path} 不允许本机或内部域名`);
  }
  if (isPrivateOrReservedIp(host)) issues.push(`${path} 不允许私网或保留地址`);
  return parsed;
}

function normalizedHosts(value: unknown, path: string, issues: string[]): string[] {
  if (!Array.isArray(value) || !value.length) {
    issues.push(`${path} 至少声明一个人工批准的下载域名`);
    return [];
  }
  const hosts = [...new Set(value.map(item => text(item).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')).filter(Boolean))];
  for (const host of hosts) {
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || isPrivateOrReservedIp(host)) {
      issues.push(`${path} 含不安全域名：${host}`);
    }
    if (isBlockedMaterialRehostHost(host)) issues.push(`${path} 含禁止批量转载的平台域名：${host}`);
  }
  return hosts;
}

function numberWithin(value: unknown, path: string, issues: string[], fallback: number, min: number, max: number): number {
  const parsed = value === undefined ? fallback : finiteNumber(value);
  if (parsed === undefined || parsed < min || parsed > max) {
    issues.push(`${path} 必须在 ${min} 到 ${max} 之间`);
    return fallback;
  }
  return parsed;
}

function reviewedTextList(value: unknown, path: string, issues: string[], maximum = 12): string[] {
  if (!Array.isArray(value) || !value.length) {
    issues.push(`${path} 必须是非空字符串数组`);
    return [];
  }
  const result = value.map((item, index) => {
    const normalized = text(item).replace(/\s+/g, ' ').slice(0, 240);
    if (!normalized) issues.push(`${path}[${index}] 必须是非空字符串`);
    return normalized;
  }).filter(Boolean);
  if (result.length > maximum) issues.push(`${path} 最多 ${maximum} 条`);
  return [...new Set(result)].slice(0, maximum);
}

function normalizeAsset(value: unknown, index: number, issues: string[]): MaterialImportAsset {
  const raw = record(value);
  const prefix = `assets[${index}]`;
  if (typeof raw.enabled !== 'boolean') issues.push(`${prefix}.enabled 必须明确填写 true 或 false`);
  const enabled = raw.enabled === true;
  const source = record(raw.source);
  const license = record(raw.license);
  const approval = record(raw.approval);
  const rights = record(approval.rights);
  const visualReview = record(raw.visualReview);
  const reviewedSegment = record(visualReview.segment);
  const downloadUrl = parsePublicHttpsUrl(source.downloadUrl, `${prefix}.source.downloadUrl`, issues);
  const pageUrl = parsePublicHttpsUrl(source.pageUrl, `${prefix}.source.pageUrl`, issues);
  const licenseUrl = parsePublicHttpsUrl(license.url, `${prefix}.license.url`, issues);
  const approvedDownloadHosts = normalizedHosts(source.approvedDownloadHosts, `${prefix}.source.approvedDownloadHosts`, issues);
  if (downloadUrl && !approvedDownloadHosts.includes(downloadUrl.hostname.toLowerCase())) {
    issues.push(`${prefix}.source.downloadUrl 的域名必须列入 approvedDownloadHosts`);
  }
  for (const [path, url] of [
    [`${prefix}.source.pageUrl`, pageUrl],
    [`${prefix}.source.downloadUrl`, downloadUrl],
  ] as const) {
    if (url && isBlockedMaterialRehostHost(url.hostname)) issues.push(`${path} 属于禁止批量转载的平台`);
  }
  if (licenseUrl && isBlockedMaterialRehostHost(licenseUrl.hostname)) {
    issues.push(`${prefix}.license.url 不能以禁止转载平台的普通条款代替素材库授权`);
  }

  const requiredRights = ['commercialUse', 'derivatives', 'rawFileStorage', 'saasMaterialLibrary'] as const;
  for (const right of requiredRights) {
    if (rights[right] !== true) issues.push(`${prefix}.approval.rights.${right} 必须由审批人明确设为 true`);
  }

  const expectedSourceSha256 = text(raw.expectedSourceSha256).toLowerCase();
  if (expectedSourceSha256 && !/^[a-f0-9]{64}$/.test(expectedSourceSha256)) {
    issues.push(`${prefix}.expectedSourceSha256 必须是 64 位十六进制 SHA-256`);
  }
  if (enabled && !expectedSourceSha256) {
    issues.push(`${prefix}.expectedSourceSha256 对 enabled 素材必填，人工观察必须绑定到审核过的原文件`);
  }
  const rawClip = raw.clip === undefined ? null : record(raw.clip);
  const clipStart = rawClip ? numberWithin(rawClip.startSeconds, `${prefix}.clip.startSeconds`, issues, 0, 0, 24 * 60 * 60) : 0;
  const clipDurationValue = rawClip?.durationSeconds === undefined ? undefined : finiteNumber(rawClip.durationSeconds);
  if (clipDurationValue !== undefined && (clipDurationValue < 0.5 || clipDurationValue > 30 * 60)) {
    issues.push(`${prefix}.clip.durationSeconds 必须在 0.5 到 1800 秒之间`);
  }
  if (rawClip && rawClip.durationSeconds !== undefined && clipDurationValue === undefined) {
    issues.push(`${prefix}.clip.durationSeconds 必须是数字`);
  }

  const rawTags = Array.isArray(raw.tags) ? raw.tags.map(text).filter(Boolean) : [];
  if (rawTags.length > 30) issues.push(`${prefix}.tags 最多 30 个`);
  const shotFunction = requiredText(raw.shotFunction, `${prefix}.shotFunction`, issues, 2);
  const visualObservations = reviewedTextList(visualReview.visualObservations, `${prefix}.visualReview.visualObservations`, issues);
  const observedFacts = reviewedTextList(reviewedSegment.observedFacts, `${prefix}.visualReview.segment.observedFacts`, issues);
  const segmentStart = finiteNumber(reviewedSegment.start);
  const segmentEnd = finiteNumber(reviewedSegment.end);
  const segmentConfidence = finiteNumber(reviewedSegment.confidence);
  const approvedBy = requiredText(approval.approvedBy, `${prefix}.approval.approvedBy`, issues, 2);
  const approvedAt = validIsoDate(approval.approvedAt, `${prefix}.approval.approvedAt`, issues);
  const approvalReference = requiredText(approval.reference, `${prefix}.approval.reference`, issues, 6);
  const approvalRationale = requiredText(approval.rationale, `${prefix}.approval.rationale`, issues, 20);
  const reviewedBy = requiredText(visualReview.reviewedBy, `${prefix}.visualReview.reviewedBy`, issues, 2);
  const reviewedAt = validIsoDate(visualReview.reviewedAt, `${prefix}.visualReview.reviewedAt`, issues);
  const reviewReference = requiredText(visualReview.reference, `${prefix}.visualReview.reference`, issues, 6);
  const reviewRationale = requiredText(visualReview.rationale, `${prefix}.visualReview.rationale`, issues, 20);
  const capturedAt = validIsoDate(license.capturedAt, `${prefix}.license.capturedAt`, issues);
  if (enabled && [approvedBy, approvalReference, approvalRationale, reviewedBy, reviewReference, reviewRationale].some(isPlaceholderReview)) {
    issues.push(`${prefix} 的启用项不能使用 placeholder/TODO/示例审批信息`);
  }
  const capturedTime = Date.parse(capturedAt);
  if (Number.isFinite(capturedTime) && Date.parse(approvedAt) < capturedTime) issues.push(`${prefix}.approval.approvedAt 不能早于许可证据采集时间`);
  if (Number.isFinite(capturedTime) && Date.parse(reviewedAt) < capturedTime) issues.push(`${prefix}.visualReview.reviewedAt 不能早于许可证据采集时间`);
  if (segmentStart !== 0) issues.push(`${prefix}.visualReview.segment.start 必须为 0`);
  if (segmentEnd === undefined || segmentEnd <= 0 || segmentEnd > 30 * 60) {
    issues.push(`${prefix}.visualReview.segment.end 必须在 0 到 1800 秒之间`);
  }
  if (clipDurationValue !== undefined && segmentEnd !== undefined && Math.abs(segmentEnd - clipDurationValue) > 0.25) {
    issues.push(`${prefix}.visualReview.segment.end 必须与 clip.durationSeconds 一致`);
  }
  if (segmentConfidence === undefined || segmentConfidence < 0.8 || segmentConfidence > 1) {
    issues.push(`${prefix}.visualReview.segment.confidence 必须在 0.8 到 1 之间`);
  }
  if (reviewedSegment.needsReview !== false) {
    issues.push(`${prefix}.visualReview.segment.needsReview 必须由复核人明确设为 false`);
  }
  return {
    id: requiredText(raw.id, `${prefix}.id`, issues),
    enabled,
    title: requiredText(raw.title, `${prefix}.title`, issues),
    folder: text(raw.folder) || 'licensed',
    source: {
      provider: requiredText(source.provider, `${prefix}.source.provider`, issues),
      creator: requiredText(source.creator, `${prefix}.source.creator`, issues),
      pageUrl: pageUrl?.toString() || '',
      downloadUrl: downloadUrl?.toString() || '',
      approvedDownloadHosts,
    },
    license: {
      name: requiredText(license.name, `${prefix}.license.name`, issues),
      url: licenseUrl?.toString() || '',
      evidence: requiredText(license.evidence, `${prefix}.license.evidence`, issues, 20),
      capturedAt,
      attributionText: text(license.attributionText),
    },
    approval: {
      approvedBy,
      approvedAt,
      reference: approvalReference,
      rationale: approvalRationale,
      rights: {
        commercialUse: true,
        derivatives: true,
        rawFileStorage: true,
        saasMaterialLibrary: true,
      },
    },
    ...(expectedSourceSha256 ? { expectedSourceSha256 } : {}),
    ...(rawClip ? { clip: { startSeconds: clipStart, ...(clipDurationValue !== undefined ? { durationSeconds: clipDurationValue } : {}) } } : {}),
    industry: text(raw.industry) || '美妆制造',
    shotFunction,
    applicability: text(raw.applicability),
    tags: [...new Set(rawTags)],
    visualReview: {
      reviewedBy,
      reviewedAt,
      reference: reviewReference,
      rationale: reviewRationale,
      visualObservations,
      segment: {
        start: 0,
        end: segmentEnd || 0,
        subject: reviewedTextList(reviewedSegment.subject, `${prefix}.visualReview.segment.subject`, issues, 8),
        action: requiredText(reviewedSegment.action, `${prefix}.visualReview.segment.action`, issues, 2),
        shot: requiredText(reviewedSegment.shot, `${prefix}.visualReview.segment.shot`, issues, 2),
        camera: requiredText(reviewedSegment.camera, `${prefix}.visualReview.segment.camera`, issues, 2),
        environment: requiredText(reviewedSegment.environment, `${prefix}.visualReview.segment.environment`, issues, 2),
        observedFacts,
        confidence: segmentConfidence || 0,
        needsReview: false,
      },
    },
  };
}

export function validateMaterialImportManifest(value: unknown): MaterialImportManifest {
  const issues: string[] = [];
  const raw = record(value);
  if (raw.manifestVersion !== MATERIAL_IMPORT_MANIFEST_VERSION) {
    issues.push(`manifestVersion 仅支持 ${MATERIAL_IMPORT_MANIFEST_VERSION}`);
  }
  const batchId = requiredText(raw.batchId, 'batchId', issues);
  if (batchId && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(batchId)) {
    issues.push('batchId 只允许 3-80 位字母、数字、点、下划线和连字符');
  }
  const scope = raw.scope === 'shared' ? 'shared' : raw.scope === 'own' ? 'own' : null;
  if (!scope) issues.push('scope 必须是 own 或 shared');
  const tenantId = text(raw.tenantId);
  if (scope === 'own' && !tenantId) issues.push('scope=own 时 tenantId 必填');
  if (raw.usage !== 'editable') issues.push('usage 必须是 editable；仅参考素材应进入灵感链接库，不应下载为原片');

  const capacity = record(raw.capacity);
  // These are importer safety ceilings, not manifest-granted permissions.
  // A manifest may choose a smaller batch/library budget but cannot expand it.
  const maxRecords = numberWithin(capacity.maxRecords, 'capacity.maxRecords', issues, DEFAULT_MATERIAL_LIBRARY_MAX_RECORDS, 1, DEFAULT_MATERIAL_LIBRARY_MAX_RECORDS);
  const maxTotalBytes = numberWithin(capacity.maxTotalBytes, 'capacity.maxTotalBytes', issues, DEFAULT_MATERIAL_LIBRARY_MAX_BYTES, POCKETBASE_MATERIAL_MAX_BYTES, DEFAULT_MATERIAL_LIBRARY_MAX_BYTES);
  const normalization = record(raw.normalization);
  const maxWidth = numberWithin(normalization.maxWidth, 'normalization.maxWidth', issues, 1080, 320, 1920);
  const crf = numberWithin(normalization.crf, 'normalization.crf', issues, 23, 18, 30);

  if (!Array.isArray(raw.assets)) issues.push('assets 必须是数组');
  const rawAssets = Array.isArray(raw.assets) ? raw.assets : [];
  if (rawAssets.length > MAX_MATERIAL_IMPORT_ASSETS) issues.push(`assets 单次最多 ${MAX_MATERIAL_IMPORT_ASSETS} 条`);
  const assets = rawAssets.slice(0, MAX_MATERIAL_IMPORT_ASSETS).map((asset, index) => normalizeAsset(asset, index, issues));
  const ids = new Set<string>();
  for (const asset of assets) {
    if (ids.has(asset.id)) issues.push(`assets.id 重复：${asset.id}`);
    ids.add(asset.id);
    const provenanceBytes = Buffer.byteLength(JSON.stringify({
      source: asset.source, license: asset.license, approval: asset.approval, visualReview: asset.visualReview,
    }), 'utf8');
    if (provenanceBytes > 450_000) issues.push(`assets[${assets.indexOf(asset)}] 的来源、许可和复核信息超过 450 KB`);
    const visualBytes = Buffer.byteLength(JSON.stringify({
      visualObservations: asset.visualReview.visualObservations, segments: [asset.visualReview.segment],
    }), 'utf8');
    if (visualBytes > 180_000) issues.push(`assets[${assets.indexOf(asset)}] 的视觉观察超过 180 KB`);
  }
  if (issues.length) throw new MaterialImportManifestError(issues);
  return {
    manifestVersion: 1,
    batchId,
    tenantId,
    scope: scope!,
    usage: 'editable',
    capacity: { maxRecords: Math.floor(maxRecords), maxTotalBytes: Math.floor(maxTotalBytes) },
    normalization: { maxWidth: Math.floor(maxWidth), crf: Math.floor(crf) },
    assets,
  };
}

export function buildMaterialImportProvenance(input: {
  manifest: MaterialImportManifest;
  asset: MaterialImportAsset;
  manifestSha256: string;
  sourceSha256: string;
  normalizedSha256: string;
  importedAt: string;
  finalDownloadHost: string;
}): MaterialImportProvenance {
  const evidenceTextSha256 = createHash('sha256').update(input.asset.license.evidence, 'utf8').digest('hex');
  return {
    schemaVersion: 1,
    batchId: input.manifest.batchId,
    manifestSha256: input.manifestSha256,
    manifestAssetId: input.asset.id,
    importedAt: input.importedAt,
    importer: 'lingshu-material-import-v1',
    source: {
      provider: input.asset.source.provider,
      creator: input.asset.source.creator,
      pageUrl: input.asset.source.pageUrl,
      downloadHost: input.finalDownloadHost.toLowerCase(),
      sourceSha256: input.sourceSha256,
      normalizedSha256: input.normalizedSha256,
    },
    license: {
      name: input.asset.license.name,
      url: input.asset.license.url,
      evidence: input.asset.license.evidence,
      evidenceTextSha256,
      capturedAt: input.asset.license.capturedAt,
      attributionText: input.asset.license.attributionText,
    },
    approval: input.asset.approval,
    visualReview: input.asset.visualReview,
  };
}

/** Build the exact trusted visual index persisted with an imported seed clip. */
export function buildMaterialImportVisualMetadata(input: {
  asset: MaterialImportAsset;
  duration: number;
  normalizedSha256: string;
}): MaterialImportVisualMetadata {
  if (!Number.isFinite(input.duration) || input.duration <= 0) throw new Error('规范化视频时长无效');
  const reviewed = input.asset.visualReview.segment;
  if (Math.abs(reviewed.end - input.duration) > 0.25) {
    throw new Error(`人工复核区间 ${reviewed.end}s 与规范化视频时长 ${input.duration}s 不一致`);
  }
  const observedFacts = [...reviewed.observedFacts];
  return {
    visualObservations: [...input.asset.visualReview.visualObservations],
    segmentAnalysisStatus: 'completed',
    analysisSourceRevision: input.normalizedSha256,
    segments: [{
      ...reviewed,
      id: `${input.asset.id}-segment-1`,
      end: input.duration,
      duration: input.duration,
      manualConfirmed: true,
      shotFunction: input.asset.shotFunction,
      recommendedFunctions: [input.asset.shotFunction],
      visual: observedFacts.join('；'),
      quality: Math.round(reviewed.confidence * 100),
      authenticity: '人工逐片复核',
    }],
  };
}
