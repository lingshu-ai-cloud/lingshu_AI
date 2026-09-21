import { KeyedWorkQueue } from './keyedWorkQueue.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readMaterialLibrary, updateLocalMaterial, updateSharedLocalMaterial, type MaterialRecord } from './materialLibrary.js';
import { getOwnedCloudMaterialRecord, updateCloudMaterial } from './cloudMaterials.js';
import { analyzeProductionMaterial } from '../digitalEmployees/productionMaterialAnalysis.js';
import type { AssetCandidate } from '../digitalEmployees/contentProduction.js';
const jobs = new KeyedWorkQueue(2);
function analysisJobKey(tenantId: string, record: MaterialRecord): string {
  return record.scope === 'shared' ? `shared:${record.id}` : `${tenantId}:${record.id}`;
}
export const isMaterialAnalysisActive = (tenantId: string, id: string) => jobs.has(`${tenantId}:${id}`) || jobs.has(`shared:${id}`);
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
    segments: Array.isArray(record.segments) ? record.segments : [], tags: [], synthetic: false,
    authorization: { status: record.scope === 'shared' ? 'licensed' : 'owned', scope: record.scope === 'shared' ? 'shared' : 'tenant', evidence: String(record.licenseEvidence || record.sourceUrl || '租户上传素材') },
    source: record.scope === 'shared' ? 'licensed_shared_material' : 'tenant_material',
  };
}
export function analysisFileRevision(record: MaterialRecord): string {
  const candidate = libraryCandidate(record);
  const stat = candidate.localPath ? fs.statSync(candidate.localPath) : undefined;
  return crypto.createHash('sha256').update(JSON.stringify([record.id, record.file, record.objectKey, record.sourceRevision || '', stat?.size, stat?.mtimeMs])).digest('hex');
}
async function analyzableMaterial(tenantId: string, id: string): Promise<MaterialRecord> {
  const inventory = await readMaterialLibrary(tenantId);
  const record = inventory.items.find(item => item.id === id && (
    item.scope === 'shared' || String(item.tenantId || item.tenant_id || '') === tenantId
  ));
  if (!record || record.usage === 'reference_only') throw Error('素材不存在或当前素材不能用于制作');
  if (!['video','image'].includes(record.type)) throw Error('请选择视频或图片素材');
  if (id.startsWith('pb-') && record.scope !== 'shared' && !await getOwnedCloudMaterialRecord(id.slice(3), tenantId)) throw Error('素材访问权限已变化');
  return record;
}
async function patch(tenantId: string, record: MaterialRecord, changes: Record<string, unknown>) {
  const ok = record.id.startsWith('pb-')
    ? await updateCloudMaterial(record.id.slice(3), changes)
    : record.scope === 'shared'
      ? updateSharedLocalMaterial(record.id, changes)
      : updateLocalMaterial(record.id, tenantId, changes);
  if (!ok) throw Error('素材分析结果保存失败，请重试');
}
export async function requestMaterialAnalysis(tenantId: string, id: string, retry = false): Promise<{ status: string; reused: boolean }> {
  const record = await analyzableMaterial(tenantId, id);
  const key = analysisJobKey(tenantId, record);
  if (jobs.has(key)) return { status: 'analyzing', reused: true };
  const revision = analysisFileRevision(record);
  if (!retry && record.segmentAnalysisStatus === 'completed' && record.analysisSourceRevision === revision) return { status: 'completed', reused: true };
  // Check again after the awaited ownership lookup, before reserving this job.
  if (jobs.has(key)) return { status: 'analyzing', reused: true };
  const created = await jobs.enqueue(key,
    () => patch(tenantId, record, { segmentAnalysisStatus: 'pending', segmentAnalysisError: '' }),
    async () => {
    try {
      await patch(tenantId, record, { segmentAnalysisStatus: 'analyzing', segmentAnalysisError: '' });
      const result = await analyzeProductionMaterial(libraryCandidate(record), tenantId, true);
      const current = await analyzableMaterial(tenantId, id);
      if (analysisFileRevision(current) !== revision) throw Error('素材文件已变化，请重新分析当前版本');
      await patch(tenantId, current, { duration: result.duration, segments: result.segments, visualObservations: result.observations,
        segmentAnalysisStatus: 'completed', segmentAnalysisError: '', analysisSourceRevision: revision });
    } catch (error) {
      await patch(tenantId, record, { segmentAnalysisStatus: 'failed', segmentAnalysisError: materialAnalysisError(error) });
    }
  }, error => console.warn('[material-analysis]', error instanceof Error ? error.message : 'failed'));
  return { status: 'pending', reused: !created };
}
export async function waitForMaterialAnalysis(tenantId: string, id: string) {
  const initial = await analyzableMaterial(tenantId, id);
  await requestMaterialAnalysis(tenantId, id);
  await jobs.get(analysisJobKey(tenantId, initial));
  const record = await analyzableMaterial(tenantId, id);
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
