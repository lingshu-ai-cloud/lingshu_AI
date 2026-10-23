import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AdHistorySource, AdSourceCatalog, AdSourceEntry, AdSourceLifecycle } from '../../shared/adSourceLifecycle.js';
import { PlatformAdCreativeError } from './creatives.js';
import { readExecutedCreativeRecords } from './executedCreative.js';
import { getMetaPerformanceReport } from './metaPerformance.js';
import type { AdConnection } from './connections.js';
import type { AdExecution } from './execution.js';
import type { PlatformAdTask } from './tasks.js';
import { socialArtifactMediaFamily } from '../starter198/socialArtifactMedia.js';

type Row = Record<string, unknown>;
type Grant = AdHistorySource & { viewerTenantId: string; directory: string };
const object = (v: unknown): Row => {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return {}; } }
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
};
const text = (v: unknown) => typeof v === 'string' ? v : '';
const validId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,200}$/.test(v);
const fault = () => new PlatformAdCreativeError('历史来源读取失败或结构不完整，请核对只读连接配置；不视为无素材。', 503);

/** Server-owned allowlist only. No caller-supplied filesystem paths or tenant substitutions. */
async function grants(): Promise<Grant[]> {
  const file = process.env.PLATFORM_ADS_HISTORY_SOURCES_FILE;
  if (!file) return [];
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 64 * 1024) throw fault();
    const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(value) || value.length > 20) throw fault();
    const keys = new Set<string>();
    return value.map(raw => {
      const r = object(raw);
      if (!validId(r.id) || !validId(r.viewerTenantId) || !validId(r.tenantId)
        || !text(r.tenantName) || !text(r.label) || !path.isAbsolute(text(r.directory))) throw fault();
      const key = `${r.viewerTenantId}:${r.id}`;
      if (keys.has(key)) throw fault(); keys.add(key);
      return r as unknown as Grant;
    });
  } catch { throw fault(); }
}
async function grantFor(viewerTenantId: string, sourceId: string): Promise<Grant> {
  const grant = (await grants()).find(g => g.viewerTenantId === viewerTenantId && g.id === sourceId);
  if (!grant) throw new PlatformAdCreativeError('未授权或不存在的历史来源', 404);
  return grant;
}
export async function listExternalHistorySources(tenantId: string): Promise<AdHistorySource[]> {
  return (await grants()).filter(g => g.viewerTenantId === tenantId).map(({ id, tenantId, tenantName, label }) => ({ id, tenantId, tenantName, label }));
}

/** Opening the explicit JSON file read-only avoids the source DataStore's fallback/migration/write paths. */
async function collection(grant: Grant, name: string, optional = false): Promise<{ rows: Row[]; revision: string; available: boolean }> {
  try {
    const directory = await fs.realpath(grant.directory);
    const file = await fs.realpath(path.join(directory, `${name}.json`));
    if (path.dirname(file) !== directory) throw fault();
    const handle = await fs.open(file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw fault();
      const bytes = await handle.readFile();
      const rows: unknown = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r) || !validId(r.id) || !validId(r.tenant_id))) throw fault();
      return { rows: (rows as Row[]).filter(r => r.tenant_id === grant.tenantId), revision: createHash('sha256').update(bytes).digest('hex'), available: true };
    } finally { await handle.close(); }
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return { rows: [], revision: '', available: false };
    throw fault();
  }
}

async function projectEntry(grant: Grant, project: Row, revision: string): Promise<AdSourceEntry> {
  const spec = object(project.spec), lineage = object(spec.socialProductionOutput);
  const entry: AdSourceEntry = {
    origin: 'studio', sourceId: grant.id, projectId: text(project.id), key: `external:${grant.id}:${project.id}`,
    sourceTenantId: grant.tenantId, sourceTenantName: grant.tenantName, sourceRevision: revision,
    name: text(project.title), status: text(project.status), createdAt: text(project.created_at), sha256: '', verifiedSource: false,
    note: Object.keys(object(spec.socialImageTask)).length
      ? '原企业图片创作项目；尚未建立输出图片文件指纹与 Meta 图片创意回执的可核验关联，不借用视频广告指标。'
      : '只读原企业历史项目；尚无完整成片血缘，不按名称、URL 或相同 SHA 自动匹配广告。',
  };
  if (object(spec.automation).managedBy !== 'social_content_output' || lineage.type !== 'social_production_artifact'
    || lineage.version !== 1 || lineage.tenantId !== grant.tenantId || lineage.taskId !== spec.socialContentTaskId
    || lineage.fileSha256 !== spec.renderOutputSha256 || !/^[a-f0-9]{64}$/.test(text(lineage.fileSha256))
    || !validId(lineage.taskId) || !validId(lineage.artifactId)) return entry;
  const artifacts = await collection(grant, 'starter_social_content_artifacts');
  const files = await collection(grant, 'starter_social_content_files');
  const tasks = await collection(grant, 'starter_social_content_tasks');
  const matches = artifacts.rows.filter(r => r.task_id === lineage.taskId && r.artifact_id === lineage.artifactId);
  const fileMatches = files.rows.filter(r => r.task_id === lineage.taskId && `socialfile:${r.file_id}` === lineage.fileRef);
  if (matches.length !== 1 || fileMatches.length !== 1 || !tasks.rows.some(r => r.task_id === lineage.taskId)
    || socialArtifactMediaFamily(matches[0].artifact_kind, object(matches[0].content)) !== 'video'
    || matches[0].resource_ref !== lineage.fileRef || fileMatches[0].usage !== 'artifact_media' || fileMatches[0].content_sha256 !== lineage.fileSha256
    || !text(fileMatches[0].mime_type).startsWith('video/') || !Number.isFinite(Number(fileMatches[0].byte_size))
    || Number(fileMatches[0].byte_size) <= 0 || !['local', 'object', 'backend'].includes(text(fileMatches[0].storage_kind))) {
    return { ...entry, note: '原企业项目、任务、成片版本、文件记录未通过一致性核对；不可自动关联广告。' };
  }
  return { ...entry, sourceTaskId: lineage.taskId, artifactId: lineage.artifactId, sha256: text(lineage.fileSha256), verifiedSource: true, sourceMediaStatus: text(matches[0].status),
    note: '已核对原企业项目 → 任务 → 成片版本 → 文件 SHA 记录；未复制/上传文件，尚未核验文件字节或广告上传证据。不能据此判定已投放。' };
}
export async function listExternalHistory(tenantId: string, sourceId: string, page: number, perPage: number): Promise<AdSourceCatalog> {
  const grant = await grantFor(tenantId, sourceId), source = await collection(grant, 'studio_projects');
  const projects = source.rows.filter(r => r.status !== 'template').sort((a, b) => text(b.created_at).localeCompare(text(a.created_at)) || text(a.id).localeCompare(text(b.id)));
  const items: AdSourceEntry[] = [];
  for (const project of projects.slice((page - 1) * perPage, page * perPage)) items.push(await projectEntry(grant, project, source.revision));
  return { items, page, perPage, totalItems: projects.length, totalPages: Math.ceil(projects.length / perPage) };
}
export async function externalHistoryLifecycle(tenantId: string, sourceId: string, projectId: string): Promise<AdSourceLifecycle> {
  const grant = await grantFor(tenantId, sourceId), projects = await collection(grant, 'studio_projects');
  const matches = projects.rows.filter(p => p.id === projectId);
  if (matches.length !== 1) throw new PlatformAdCreativeError('未找到该来源企业的历史素材', 404);
  const source = await projectEntry(grant, matches[0], projects.revision);
  const bindings = await collection(grant, 'platform_ad_creatives', true);
  const candidates = source.verifiedSource ? bindings.rows.filter(r => r.sourceTaskId === source.sourceTaskId && r.artifactId === source.artifactId && r.sha256 === source.sha256) : [];
  // The destination's sandbox resources are a different tenant/store. Even an ID/SHA collision is NOT provenance.
  // Source bindings without accessible, verified provider receipts cannot be presented as live Meta data.
  const result: AdSourceLifecycle = { source, checkedAt: '', truncated: false, bindingCount: candidates.length, ads: [], roi: null, crmInquiries: null,
    scopeNote: `来源企业：${grant.tenantName}（${grant.tenantId}）。${!bindings.available ? '原历史来源没有投放绑定集合，投放覆盖范围尚未建立。' : '仅读取原企业同一成片版本的已核验创建回执；没有完整回执的绑定不代表已投放。'} 不跨企业检索或借用沙盒广告；这不代表全平台从未投放。没有真实回执时消耗、购买 ROAS、Meta lead/消息会话均未知；利润 ROI 和 CRM 有效询盘另需业务归因，不填零、不混算。` };
  if (candidates.length) {
    const receipts = await collection(grant, 'platform_ad_executions'), connections = await collection(grant, 'platform_ad_connections'), tasks = await collection(grant, 'platform_ad_tasks');
    const seen = new Set<string>();
    for (const b of candidates) for (const r of receipts.rows) {
      const ids = object(r.result), upload = object(b.uploadReceipt);
      if (r.taskId !== b.taskId || r.connectionId !== b.connectionId || r.action !== 'create' || r.status !== 'VERIFIED'
        || (ids.creativeBindingId !== b.id && upload.mappingExecutionId !== r.id)) continue;
      const connectionRows = connections.rows.filter(c => c.id === b.connectionId), taskRows = tasks.rows.filter(t => t.id === b.taskId);
      const connection = connectionRows[0], task = taskRows[0];
      if (connectionRows.length !== 1 || taskRows.length !== 1 || connection.provider !== 'meta' || !/^\d+$/.test(text(connection.accountId))
        || !['campaignId', 'adsetId', 'creativeId', 'adId'].every(k => /^\d+$/.test(text(ids[k])))) throw fault();
      const key = `${connection.accountId}:${ids.adId}`; if (seen.has(key)) continue; seen.add(key);
      if (result.ads.length >= 20) { result.truncated = true; continue; }
      const entry: AdSourceLifecycle['ads'][number] = { executionId: text(r.id), taskId: text(b.taskId), taskName: text(task.name), accountId: text(connection.accountId), adId: text(ids.adId), mapping: ids.creativeBindingId === b.id ? '原企业创建时绑定' : '原企业投放后核对映射', report: null, error: '' };
      try {
        if (b.status !== 'ready' || upload.status !== 'ready' || upload.sha256 !== source.sha256 || upload.accountId !== connection.accountId || upload.videoId !== b.platformVideoId) throw fault();
        const report = await getMetaPerformanceReport(grant.tenantId, entry.executionId, { level: 'ad', preset: 'maximum' }, {
          cacheKey: JSON.stringify([tenantId, grant.id, projects.revision, bindings.revision, receipts.revision, connections.revision, tasks.revision]),
          read: () => readExecutedCreativeRecords(grant.tenantId, r as unknown as AdExecution, task as unknown as PlatformAdTask, connection as unknown as AdConnection),
        });
        if (report.videoId !== b.platformVideoId || report.accountId !== connection.accountId) throw fault();
        entry.report = report;
      } catch { entry.error = '原企业 Meta 回执或授权未通过读回核验；报告未知，不借用其他企业数据，请核对原账户授权和素材映射。'; }
      result.ads.push(entry);
    }
  }
  result.checkedAt = new Date().toISOString(); return result;
}
