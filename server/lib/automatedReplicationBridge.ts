import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import type { Router } from 'express';
import type { DataStore } from '../storage/datastore.js';
import { readLocalMaterials, type MaterialRecord } from './materialLibrary.js';
import { readTenantMaterialBytes } from './sentenceReplicationProduction.js';
import { shotFingerprint } from '../../src/lib/shotProduction.js';
import { digitalHumanQualityState } from '../../src/lib/digitalHumanQuality.js';
import { isTenantPrivateObjectKey } from '../storage/materialAssets.js';
import { tenantAssetDir } from './assetAccess.js';
import { matchReplicationMaterial } from './replicationMaterialMatching.js';
import { referenceCues } from '../../src/lib/digitalHumanPlan.js';

export interface AutomatedReplicationShot { shotId: string; slotId: string; kind: 'person' | 'nonperson'; start: number; end: number; firstFrameRequest?: Record<string, unknown> }
export interface ReplicationRouteReply { status: number; body: any }
export type ReplicationRouteCall = (surface: 'production' | 'studio', method: 'get' | 'post', route: string, body?: Record<string, unknown>) => Promise<ReplicationRouteReply>;
export interface AutomatedReplicationDependencies { call: ReplicationRouteCall; materials?: () => MaterialRecord[] | Promise<MaterialRecord[]>; validateVideo?: (material: MaterialRecord, tenantId: string) => Promise<string | void>; validateAdoption?: (spec: Record<string, any>, materials: MaterialRecord[]) => Promise<string[]> }
export interface AutomatedReplicationResult { state: 'pending' | 'blocked' | 'ready'; changed: boolean; blocker?: string; shotId?: string; materialIds?: string[] }

/** Invoke a native business handler inside the already authenticated worker scope.
 * This is deliberately not an HTTP client or a token/authentication bypass: the
 * tenant comes from the trusted job, and every handler still validates ownership.
 */
export async function invokeReplicationRoute(router: Router, tenantId: string, method: 'get' | 'post', route: string, body: Record<string, unknown> = {}): Promise<ReplicationRouteReply> {
  if (!tenantId) throw new Error('逐镜任务缺少已认证企业');
  for (const layer of (router as any).stack || []) {
    const registered = layer.route;
    if (!registered?.methods?.[method] || typeof registered.path !== 'string') continue;
    const names: string[] = [];
    const expression = registered.path.split('/').map((part: string) => part.startsWith(':') ? (names.push(part.slice(1)), '([^/]+)') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
    const match = route.match(new RegExp(`^${expression}$`));
    if (!match) continue;
    let status = 200; let response: any; let ended = false;
    const req = { body, params: Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1]!)])), query: {}, method: method.toUpperCase(), path: route, headers: {}, get: () => undefined };
    const res: any = { locals: { tenantId, userId: 'digital_employee_worker' }, status(code: number) { status = code; return res; }, json(value: any) { response = value; ended = true; return res; }, send(value: any) { response = value; ended = true; return res; } };
    for (const handler of registered.stack) { await handler.handle(req, res, (error?: Error) => { if (error) throw error; }); if (ended) break; }
    if (!ended) throw new Error(`原生逐镜接口未返回结果：${route}`);
    return { status, body: response };
  }
  throw new Error(`逐镜生产接口不存在：${method} ${route}`);
}

const run = promisify(execFile);
export async function validateReplicationVideo(material: MaterialRecord, tenantId: string): Promise<string> {
  if (material.scope !== 'own' || String(material.tenantId || material.tenant_id || '') !== tenantId || material.type !== 'video'
    || /reference|tiktok|benchmark/i.test(String(material.sourceType || ''))) throw new Error('逐镜采用只允许本企业可编辑真实视频，禁止原片与目录图片');
  if (material.objectKey && !isTenantPrivateObjectKey(String(material.objectKey), tenantId)) throw new Error('逐镜视频对象存储路径不属于当前企业');
  if (material.file) {
    const root = tenantAssetDir(path.resolve('data/media'), tenantId);
    const file = path.resolve('data/media', String(material.file));
    if (fs.existsSync(file) ? (!fs.existsSync(root) || !fs.realpathSync(file).startsWith(`${fs.realpathSync(root)}${path.sep}`)) : !material.objectKey) throw new Error('逐镜视频本地路径不属于当前企业');
  }
  const loaded = await readTenantMaterialBytes(material, tenantId);
  if (material.contentSha256 && createHash('sha256').update(loaded.bytes).digest('hex') !== material.contentSha256) throw new Error('逐镜视频内容哈希已变化');
  const contentSha256 = createHash('sha256').update(loaded.bytes).digest('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replication-bridge-'));
  try {
    const file = path.join(dir, 'candidate.mp4'); fs.writeFileSync(file, loaded.bytes, { mode: 0o600 });
    if (!ffmpeg) throw new Error('逐镜视频解码工具不可用');
    const decoded = await run(ffmpeg, ['-hide_banner', '-nostdin', '-xerror', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', file, '-map', '0:v:0', '-an', '-f', 'null', '-'], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    if (!/Video:/.test(decoded.stderr) || !/Duration:/.test(decoded.stderr)) throw new Error('逐镜候选不是可完整解码的视频');
    return contentSha256;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const productionRouters = new WeakMap<DataStore, Router>();
async function defaultDependencies(input: { tenantId: string; store: DataStore }): Promise<AutomatedReplicationDependencies> {
  let production = productionRouters.get(input.store);
  if (!production) { const module = await import('./studioAvatarProduction.js'); production = module.createStudioAvatarProductionRouter(input.store); productionRouters.set(input.store, production); }
  const { studioRouter } = await import('../routes/studio.js');
  const { readMaterialLibrary } = await import('./materialLibrary.js');
  return { materials: async () => (await readMaterialLibrary(input.tenantId)).items, call: (surface, method, route, body) => invokeReplicationRoute(surface === 'production' ? production! : studioRouter, input.tenantId, method, route, body) };
}
const locks = new Set<string>();
/** Advance exactly one supplier-producing step per tick. Native ledgers own paid
 * idempotency; progress is saved before submission so uncertain work is never
 * silently submitted again following a process restart. */
export async function advanceAutomatedReplication(input: { tenantId: string; projectId: string; maxCostCny?: number; store: DataStore }, suppliedDeps?: AutomatedReplicationDependencies): Promise<AutomatedReplicationResult> {
  const key = `${input.tenantId}:${input.projectId}`;
  if (locks.has(key)) return { state: 'pending', changed: false };
  locks.add(key);
  try {
    const deps = suppliedDeps || await defaultDependencies(input);
    const project = await input.store.getById<any>('studio_projects', input.projectId);
    if (!project || project.tenant_id !== input.tenantId || project.status !== 'draft') return { state: 'blocked', changed: false, blocker: '当前企业逐镜草稿不存在或不可编辑' };
    const spec = project.spec || {}; const shots = spec.automatedReplicationShots as AutomatedReplicationShot[];
    if (!Array.isArray(shots) || !shots.length) return { state: 'blocked', changed: false, blocker: '缺少精确逐镜生产计划' };
    const assemblyId = String(spec.activeAssemblyId || '');
    const progress = { ...(spec.automatedReplicationProgress || {}) };
    const save = async (shotId: string, value: Record<string, unknown>, patch: Record<string, any> = {}) => {
      const latest = await input.store.getById<any>('studio_projects', project.id);
      if (!latest || latest.tenant_id !== input.tenantId || latest.status !== 'draft') throw new Error('逐镜草稿状态已变化');
      progress[shotId] = { ...progress[shotId], ...value, updatedAt: new Date().toISOString() };
      if (!await input.store.update('studio_projects', project.id, { spec: { ...latest.spec, ...patch, automatedReplicationProgress: progress } })) throw new Error('逐镜进度持久化失败，未继续调用供应商');
    };
    const materialFor = async (id: string) => (await (deps.materials || readLocalMaterials)()).find(item => item.id === id && String(item.tenantId || item.tenant_id || '') === input.tenantId);
    const validate = deps.validateVideo || validateReplicationVideo;
    const readyIds: string[] = [];
    for (const entry of shots) {
      const shotKey = `${assemblyId}:${entry.shotId}`; const shot = spec.shotProductions?.[shotKey];
      if (!shot || shot.locked) return { state: 'blocked', changed: false, blocker: '逐镜参数缺失或被锁定', shotId: entry.shotId };
      const fingerprint = shotFingerprint(shot, String(spec.shotProductionContext || ''), entry.shotId);
      const state = progress[entry.shotId] || {};
      if (state.fingerprint && state.fingerprint !== fingerprint) return { state: 'blocked', changed: false, blocker: '逐镜输入已变化，原付费作业需核对后更新生产计划', shotId: entry.shotId };
      const assigned = String(spec.storyboardAssignments?.[entry.slotId] || '');
      if (assigned) {
        const material = await materialFor(assigned); if (!material) throw new Error('装配视频不存在或不属于当前企业'); const currentHash = await validate(material, input.tenantId);
        if (state.videoContentSha256 && currentHash !== state.videoContentSha256) throw new Error('逐镜视频在质检或采用后已被替换');
        if (material.provenance?.storyboardAigc === true) {
          const issues = deps.validateAdoption ? await deps.validateAdoption(spec, await (deps.materials || readLocalMaterials)())
            : await (await import('../routes/studio.js')).automationStoryboardAssignmentIssues(input.tenantId, project.id, spec);
          if (issues.length) throw new Error(issues.join('；'));
        }
        if (entry.kind === 'nonperson' && !shot.candidates?.some((candidate: any) => candidate.id === shot.adoptedId && candidate.materialId === assigned && candidate.fingerprint === fingerprint)) {
          const candidateId = `matched:${createHash('sha256').update(`${key}:${entry.shotId}:${assigned}:${fingerprint}`).digest('hex').slice(0,24)}`;
          await save(entry.shotId, { fingerprint, adopted: true, materialId: assigned, source: 'matched_enterprise_video', ...(currentHash ? { videoContentSha256: currentHash } : {}) }, { shotProductions: { ...spec.shotProductions, [shotKey]: { ...shot, adoptedId: candidateId, candidates: [...(shot.candidates || []), { id: candidateId, materialId: assigned, fingerprint, source: 'material', createdAt: new Date().toISOString() }] } } });
          return { state: 'pending', changed: true, shotId: entry.shotId };
        }
        readyIds.push(assigned); continue;
      }
      const requestId = `bridge:${createHash('sha256').update(`${key}:${assemblyId}:${entry.shotId}:${fingerprint}`).digest('hex').slice(0,40)}`;
      const b = { projectId: project.id, assemblyId, shotId: entry.shotId, fingerprint, requestId, confirmed: true, maxCostCny: input.maxCostCny };
      if (entry.kind === 'person') {
        if (!referenceCues(shot.digitalHuman).every(cue => cue.personShot === false || cue.sourceFirstFrame?.materialId)) {
          const reply = await deps.call('production', 'post', '/sentence-first-frames', b); if (reply.status >= 400 || !reply.body?.cues) throw new Error(reply.body?.error || '人物源首帧提取失败');
          const nextShot = { ...shot, digitalHuman: { ...shot.digitalHuman, reference: { ...shot.digitalHuman.reference, cues: reply.body.cues } } };
          await save(entry.shotId, {}, { shotProductions: { ...spec.shotProductions, [shotKey]: nextShot } });
          return { state: 'pending', changed: true, shotId: entry.shotId };
        }
        if (state.submitted && !state.result) {
          const reply = await deps.call('production', 'get', `/sentence-replication-requests/${requestId}/status`);
          const job = reply.body;
          if (job?.state === 'completed' && job.id) {
            const completed = await deps.call('production', 'get', `/sentence-replication-jobs/${job.id}`);
            if (completed.body?.executionId) { await save(entry.shotId, { result: completed.body }); return { state: 'pending', changed: true }; }
          }
          if (reply.status === 404) {
            // No native record means the process stopped before supplier admission.
            const submitted = await deps.call('production', 'post', '/sentence-replication-jobs', b);
            if (submitted.status < 400 && submitted.body?.executionId) { await save(entry.shotId, { result: submitted.body }); return { state: 'pending', changed: true }; }
            throw new Error(submitted.body?.error || '人物原生作业未完成');
          }
          if (job?.state === 'uncertain' && job.id && referenceCues(shot.digitalHuman).filter(cue => cue.personShot !== false).every(cue => job.providerTasks?.[cue.id])) {
            const resumed = await deps.call('production', 'post', `/sentence-replication-jobs/${job.id}/resume`, { confirmed: true, maxCostCny: input.maxCostCny });
            if (resumed.status < 400 && resumed.body?.executionId) { await save(entry.shotId, { result: resumed.body }); return { state: 'pending', changed: true }; }
            throw new Error(resumed.body?.error || '原供应商任务尚未恢复完成');
          }
          return { state: 'blocked', changed: false, blocker: job?.error || '已提交人物作业等待核对，保留原请求且不重复付费', shotId: entry.shotId };
        }
        if (!state.result) {
          await save(entry.shotId, { fingerprint, submitted: true, requestId });
          const reply = await deps.call('production', 'post', '/sentence-replication-jobs', b);
          if (reply.status >= 400 || !reply.body?.executionId) throw new Error(reply.body?.error || '人物逐镜生成未完成');
          await save(entry.shotId, { result: reply.body }); return { state: 'pending', changed: true, shotId: entry.shotId };
        }
        const result = state.result;
        const executions = await input.store.getById<any>('studio_digital_human_executions', result.executionId);
        if (!executions || executions.tenant_id !== input.tenantId || digitalHumanQualityState(executions.payload.quality.checks) !== 'accepted') throw new Error('人物候选存在质量失败或媒体尚未完成');
        const candidateId = `${requestId}:candidate`; const nextShot = { ...shot, candidates: [...(shot.candidates || []).filter((item: any) => item.id !== candidateId), { id: candidateId, materialId: result.materialId, fingerprint, source: 'avatar', jobId: result.executionId, createdAt: new Date().toISOString() }] };
        await save(entry.shotId, {}, { shotProductions: { ...spec.shotProductions, [shotKey]: nextShot } });
        const reply = await deps.call('production', 'post', `/executions/${result.executionId}/adopt`, { candidateId, materialId: result.materialId });
        if (reply.status >= 400) throw new Error(reply.body?.error || '人物候选自动采用失败');
        await save(entry.shotId, { adopted: true, materialId: result.materialId }); return { state: 'pending', changed: true, shotId: entry.shotId };
      }
      if (!state.firstFrameMaterialId && !state.matchingChecked) {
        const match = matchReplicationMaterial({ tenantId: input.tenantId,
          shotDescription: String(entry.firstFrameRequest?.shotDescription || ''), duration: entry.end - entry.start,
          materials: await (deps.materials || readLocalMaterials)(),
          requiredProductId: entry.firstFrameRequest?.sceneType === 'product' ? String((entry.firstFrameRequest.productIds as string[] | undefined)?.[0] || shot.productId || '') || undefined : undefined });
        if (match) {
          const material = await materialFor(match.materialId); if (!material) throw new Error('匹配视频已不属于当前企业');
          const matchedHash = await validate(material, input.tenantId);
          if (match.contentSha256 && matchedHash !== match.contentSha256) throw new Error('匹配视频内容版本与证据不一致');
          const candidateId = `${requestId}:matched`;
          await save(entry.shotId, { fingerprint, matchingChecked: true, matching: match, ...(matchedHash ? { videoContentSha256: matchedHash } : {}), trimStart: match.trimStart, trimEnd: match.trimEnd, adopted: true, materialId: match.materialId }, {
            storyboardAssignments: { ...spec.storyboardAssignments, [entry.slotId]: match.materialId },
            clipEdits: { ...spec.clipEdits, [entry.slotId]: { ...spec.clipEdits?.[entry.slotId], trimStart: match.trimStart, trimEnd: match.trimEnd } },
            shotProductions: { ...spec.shotProductions, [shotKey]: { ...shot, adoptedId: candidateId, candidates: [...(shot.candidates || []), { id: candidateId, materialId: match.materialId, fingerprint, source: 'material', createdAt: new Date().toISOString() }] } },
          });
          return { state: 'pending', changed: true, shotId: entry.shotId };
        }
      }
      if (!state.firstFrameMaterialId) {
        if (!entry.firstFrameRequest) throw new Error('非人物镜头缺少参考首帧和产品生成参数');
        const reply = await deps.call('studio', 'post', '/storyboard-first-frame', { ...entry.firstFrameRequest, projectId: project.id, shotId: entry.slotId, requestId });
        if (reply.status >= 400 || !reply.body?.ok || !reply.body?.material?.id) throw new Error(reply.body?.error || '非人物首帧生成未完成');
        await save(entry.shotId, { fingerprint, firstFrameMaterialId: reply.body.material.id, firstFrameFingerprint: reply.body.fingerprint }); return { state: 'pending', changed: true, shotId: entry.shotId };
      }
      if (!state.videoMaterialId) {
        const reply = await deps.call('studio', 'post', '/seedance-video', { ...entry.firstFrameRequest, script: entry.firstFrameRequest?.shotDescription || shot.narration, firstFrameMaterialId: state.firstFrameMaterialId, firstFrameFingerprint: state.firstFrameFingerprint, shotId: entry.slotId, requestId: `${requestId}:video`, duration: Math.max(4, Math.min(15, Math.ceil(entry.end - entry.start))), resolution: '480p', ratio: spec.ratio || '9:16', language: spec.activeVoiceLang || spec.lang || 'en', generationContext: { projectId: project.id } });
        if (reply.status >= 400 || !reply.body?.ok || !reply.body?.material?.id) throw new Error(reply.body?.error || '非人物镜头生成未完成，原生预算账本保留原作业');
        await save(entry.shotId, { videoMaterialId: reply.body.material.id }); return { state: 'pending', changed: true, shotId: entry.shotId };
      }
      if (!state.qualityChecked) {
        const qualityMaterial = await materialFor(state.videoMaterialId); if (!qualityMaterial) throw new Error('待质检视频不存在');
        const qualityInputHash = await validate(qualityMaterial, input.tenantId);
        const reply = await deps.call('studio', 'post', '/storyboard-quality-check', { materialId: state.videoMaterialId, storyboard: entry.firstFrameRequest?.shotDescription || '' });
        if (reply.status >= 400 || !reply.body?.quality?.passed) throw new Error(reply.body?.error || '非人物视频质量检查未通过');
        const checkedMaterial = await materialFor(state.videoMaterialId); if (!checkedMaterial) throw new Error('质检视频不存在');
        const checkedHash = await validate(checkedMaterial, input.tenantId);
        if (qualityInputHash && checkedHash !== qualityInputHash) throw new Error('非人物视频在质检过程中已被替换');
        await save(entry.shotId, { qualityChecked: true, ...(checkedHash ? { videoContentSha256: checkedHash } : {}) }); return { state: 'pending', changed: true, shotId: entry.shotId };
      }
      const material = await materialFor(state.videoMaterialId); if (!material) throw new Error('非人物候选视频不可读取'); const adoptedHash = await validate(material, input.tenantId);
      if (state.videoContentSha256 && adoptedHash !== state.videoContentSha256) throw new Error('非人物视频在质检后已被替换');
      const candidateSpec = { ...spec, storyboardAssignments: { ...spec.storyboardAssignments, [entry.slotId]: material.id } };
      const adoptionIssues = deps.validateAdoption
        ? await deps.validateAdoption(candidateSpec, await (deps.materials || readLocalMaterials)())
        : await (await import('../routes/studio.js')).automationStoryboardAssignmentIssues(input.tenantId, project.id, candidateSpec);
      if (adoptionIssues.length) throw new Error(adoptionIssues.join('；'));
      const candidateId = `${requestId}:candidate`;
      const nextShot = { ...shot, adoptedId: candidateId, candidates: [...(shot.candidates || []).filter((candidate: any) => candidate.id !== candidateId), { id: candidateId, materialId: material.id, fingerprint, source: 'ai', createdAt: new Date().toISOString() }] };
      await save(entry.shotId, { adopted: true, materialId: material.id }, { storyboardAssignments: { ...spec.storyboardAssignments, [entry.slotId]: material.id }, shotProductions: { ...spec.shotProductions, [shotKey]: nextShot } });
      return { state: 'pending', changed: true, shotId: entry.shotId };
    }
    return { state: 'ready', changed: false, materialIds: readyIds };
  } catch (error) { return { state: 'blocked', changed: false, blocker: error instanceof Error ? error.message : '逐镜执行失败' }; }
  finally { locks.delete(key); }
}
