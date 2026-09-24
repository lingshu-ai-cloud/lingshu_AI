import { KeyedWorkQueue } from './keyedWorkQueue.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readMaterialLibrary, updateLocalMaterial, type MaterialRecord } from './materialLibrary.js';
import { getOwnedCloudMaterialRecord, updateCloudMaterial } from './cloudMaterials.js';
import { analyzeProductionMaterial } from '../digitalEmployees/productionMaterialAnalysis.js';
import type { AssetCandidate } from '../digitalEmployees/contentProduction.js';
import { buildMaterialScriptAnalysis, reusableMaterialScriptAnalysis, type MaterialScriptAnalysis } from '../../shared/materialScriptAnalysis.js';
const jobs = new KeyedWorkQueue(2);
export const isMaterialAnalysisActive = (tenantId: string, id: string) => jobs.has(`${tenantId}:${id}`);
function scriptAnalysisForRecord(record: MaterialRecord, revision: string): MaterialScriptAnalysis | null {
  if (record.segmentAnalysisStatus !== 'completed' || record.analysisSourceRevision !== revision) return null;
  return reusableMaterialScriptAnalysis(record.scriptAnalysis, revision) || buildMaterialScriptAnalysis({
    materialId: record.id,
    name: String(record.name || ''),
    sourceRevision: revision,
    duration: Number(record.duration || 0),
    segments: Array.isArray(record.segments) ? record.segments : [],
    visualObservations: Array.isArray(record.visualObservations) ? record.visualObservations : [],
    analyzedAt: String(record.updatedAt || record.createdAt || '') || undefined,
  });
}
export function libraryCandidate(record: MaterialRecord): AssetCandidate {
  const cloud = record.id.startsWith('pb-');
  const mediaRoot = path.resolve(process.cwd(), 'data/media');
  const local = record.file && !cloud ? path.resolve(mediaRoot, record.file) : '';
  if (local && !local.startsWith(mediaRoot + path.sep)) throw Error('素材路径不属于素材目录');
  return { id: record.id, name: String(record.name || ''), type: record.type, duration: Number(record.duration || 0),
    ...(local && fs.existsSync(local) ? { localPath: local } : {}), ...(record.objectKey ? { objectKey: String(record.objectKey) } : {}),
    ...(cloud ? { cloudRecordId: record.id.slice(3) } : {}), url: String(record.url || ''),
    productId: String(record.productId || ''), productName: String(record.productName || ''),
    observations: Array.isArray(record.visualObservations) ? record.visualObservations : [],
    visualObservations: Array.isArray(record.visualObservations) ? record.visualObservations : [],
    segments: Array.isArray(record.segments) ? record.segments : [],
    scriptAnalysis: scriptAnalysisForRecord(record, analysisFileRevision(record)) || undefined,
    tags: String(record.tags || '').split(/[,，]/).map(value => value.trim()).filter(Boolean), synthetic: false,
    authorization: { status: record.scope === 'shared' ? 'licensed' : 'owned', scope: record.scope === 'shared' ? 'shared' : 'tenant', evidence: String(record.licenseEvidence || record.sourceUrl || '租户上传素材') },
    source: record.scope === 'shared' ? 'licensed_shared_material' : 'tenant_material',
  };
}
export function analysisFileRevision(record: MaterialRecord): string {
  const cloud = record.id.startsWith('pb-');
  const mediaRoot = path.resolve(process.cwd(), 'data/media');
  const localPath = record.file && !cloud ? path.resolve(mediaRoot, record.file) : '';
  const stat = localPath && fs.existsSync(localPath) ? fs.statSync(localPath) : undefined;
  return crypto.createHash('sha256').update(JSON.stringify([record.id, record.file, record.objectKey, record.sourceRevision || '', stat?.size, stat?.mtimeMs])).digest('hex');
}
async function ownedMaterial(tenantId: string, id: string): Promise<MaterialRecord> {
  const inventory = await readMaterialLibrary(tenantId);
  const record = inventory.items.find(item => item.id === id && String(item.tenantId || item.tenant_id || '') === tenantId);
  if (!record || record.scope === 'shared' || record.usage === 'reference_only') throw Error('素材不存在或不属于当前账号可编辑素材');
  if (!['video','image'].includes(record.type)) throw Error('请选择视频或图片素材');
  if (id.startsWith('pb-') && !await getOwnedCloudMaterialRecord(id.slice(3), tenantId)) throw Error('素材访问权限已变化');
  return record;
}
async function patch(tenantId: string, id: string, changes: Record<string, unknown>) {
  let ok: boolean;
  if (id.startsWith('pb-') && changes.scriptAnalysis) {
    const cloudId = id.slice(3);
    const raw = await getOwnedCloudMaterialRecord(cloudId, tenantId);
    const rawProvenance = raw?.provenance;
    let provenance: Record<string, unknown> = {};
    if (rawProvenance && typeof rawProvenance === 'object' && !Array.isArray(rawProvenance)) provenance = rawProvenance as Record<string, unknown>;
    else if (typeof rawProvenance === 'string') {
      try { provenance = JSON.parse(rawProvenance) as Record<string, unknown>; } catch { provenance = {}; }
    }
    const { scriptAnalysis, ...cloudChanges } = changes;
    ok = await updateCloudMaterial(cloudId, {
      ...cloudChanges,
      provenance: { ...provenance, materialScriptAnalysis: scriptAnalysis },
    });
  } else {
    ok = id.startsWith('pb-') ? await updateCloudMaterial(id.slice(3), changes) : updateLocalMaterial(id, tenantId, changes);
  }
  if (!ok) throw Error('素材分析结果保存失败，请重试');
}
export async function requestMaterialAnalysis(tenantId: string, id: string, retry = false): Promise<{ status: string; reused: boolean }> {
  const key = `${tenantId}:${id}`;
  if (jobs.has(key)) return { status: 'analyzing', reused: true };
  const record = await ownedMaterial(tenantId, id);
  const revision = analysisFileRevision(record);
  if (!retry && record.segmentAnalysisStatus === 'completed' && record.analysisSourceRevision === revision) {
    if (!reusableMaterialScriptAnalysis(record.scriptAnalysis, revision)) {
      await patch(tenantId, id, {
        scriptAnalysis: buildMaterialScriptAnalysis({
          materialId: id,
          name: String(record.name || ''),
          sourceRevision: revision,
          duration: Number(record.duration || 0),
          segments: Array.isArray(record.segments) ? record.segments : [],
          visualObservations: Array.isArray(record.visualObservations) ? record.visualObservations : [],
        }),
      });
    }
    return { status: 'completed', reused: true };
  }
  // Check again after the awaited ownership lookup, before reserving this job.
  if (jobs.has(key)) return { status: 'analyzing', reused: true };
  const created = await jobs.enqueue(key,
    () => patch(tenantId, id, { segmentAnalysisStatus: 'pending', segmentAnalysisError: '' }),
    async () => {
    try {
      await patch(tenantId, id, { segmentAnalysisStatus: 'analyzing', segmentAnalysisError: '' });
      const result = await analyzeProductionMaterial(libraryCandidate(record), tenantId, true);
      const current = await ownedMaterial(tenantId, id);
      if (analysisFileRevision(current) !== revision) throw Error('素材文件已变化，请重新分析当前版本');
      const scriptAnalysis = buildMaterialScriptAnalysis({
        materialId: id,
        name: String(record.name || ''),
        sourceRevision: revision,
        duration: result.duration,
        segments: result.segments,
        visualObservations: result.observations,
      });
      await patch(tenantId, id, { duration: result.duration, segments: result.segments, visualObservations: result.observations, scriptAnalysis,
        segmentAnalysisStatus: 'completed', segmentAnalysisError: '', analysisSourceRevision: revision });
    } catch (error) {
      await patch(tenantId, id, { segmentAnalysisStatus: 'failed', segmentAnalysisError: materialAnalysisError(error) });
    }
  }, error => console.warn('[material-analysis]', error instanceof Error ? error.message : 'failed'));
  return { status: 'pending', reused: !created };
}
export async function saveMaterialSegmentsWithScriptAnalysis(
  tenantId: string,
  record: MaterialRecord,
  segments: Array<Record<string, unknown>>,
): Promise<MaterialScriptAnalysis> {
  const revision = analysisFileRevision(record);
  const scriptAnalysis = buildMaterialScriptAnalysis({
    materialId: record.id,
    name: String(record.name || ''),
    sourceRevision: revision,
    duration: Number(record.duration || 0),
    segments,
    visualObservations: Array.isArray(record.visualObservations) ? record.visualObservations : [],
  });
  await patch(tenantId, record.id, { segments, scriptAnalysis, analysisSourceRevision: revision });
  return scriptAnalysis;
}
export async function waitForMaterialAnalysis(tenantId: string, id: string) {
  await requestMaterialAnalysis(tenantId, id);
  await jobs.get(`${tenantId}:${id}`);
  const record = await ownedMaterial(tenantId, id);
  if (record.segmentAnalysisStatus !== 'completed') throw Error(String(record.segmentAnalysisError || '素材分析未完成'));
  return record;
}

export function materialAnalysisError(error: unknown): string {
  const message = error instanceof Error ? error.message : '素材分析失败';
  if (/timeout|timed out|abort/i.test(message)) return '视觉分析服务响应超时，请稍后重试；已上传的原片仍保存在素材库';
  if (/connection error|fetch failed|ECONN/i.test(message)) return '视觉分析服务连接失败，请稍后重试；素材文件未丢失';
  if (/429|rate.limit/i.test(message)) return '视觉分析服务繁忙，请稍后重试';
  if (/401|403|api.key/i.test(message)) return '视觉分析服务配置异常，请联系管理员检查服务凭据';
  return message.replace(/^production_input_required:/, '').slice(0,500);
}
