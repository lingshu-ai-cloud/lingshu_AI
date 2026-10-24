import { createHash } from 'node:crypto';
import { creationTurnSchema, creationReplySchema, type CreationReply, type CreationShot } from '../../shared/contracts/contentCreationDialogue.js';
import { buildBenchmarkAnalysis, recordOf } from '../../shared/benchmarkAnalysis.js';
import { loadReferenceShotReview } from '../lib/referenceShotReview.js';
import { isSyntheticMaterial } from '../lib/materialTruthfulness.js';
import { enterpriseProductIdentity } from '../lib/enterpriseProductIdentity.js';
import { validateHeyGenPresenterRecord } from '../lib/presenterAssetTrust.js';

export class CreationDialogueError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export type CreationEvidencePorts = {
  reference: (tenantId: string, id: string) => Promise<Record<string, unknown> | null>;
  profile: (tenantId: string) => Promise<unknown>;
  materials: (tenantId: string) => Promise<{ items: Record<string, unknown>[]; status: string }>;
  presenters: (tenantId: string) => Promise<Record<string, unknown>[]>;
};
const text = (value: unknown, max = 700) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const fail = (code: string, message: string, status = 422): never => { throw new CreationDialogueError(code, status, message); };

/** Read-only planning in the existing strategy domain. No provider, task or queue writes. */
export async function contentCreationTurn(tenantId: string, input: unknown, ports: CreationEvidencePorts): Promise<CreationReply> {
  const parsed = creationTurnSchema.safeParse(input);
  if (!parsed.success) return fail('creation_input_invalid', '创作选择格式无效，请重新选择。', 400);
  const { action } = parsed.data;
  const selection = { ...parsed.data.selection };
  if (action === 'start') { selection.shotIds = []; delete selection.narrationId; delete selection.avatar; }
  const reference = await ports.reference(tenantId, selection.referenceId);
  if (!reference || reference.tenantId !== tenantId) return fail('creation_reference_unavailable', '参考视频已移除或无权访问，请重新选择。', 404);
  const rawAnalysis = typeof reference.aiAnalysis === 'string' ? JSON.parse(reference.aiAnalysis) : reference.aiAnalysis;
  const analysis = recordOf(rawAnalysis);
  const benchmark = buildBenchmarkAnalysis({ analysis, videoId: selection.referenceId, duration: Number(reference.duration) });
  const profile = recordOf(await ports.profile(tenantId));
  if (recordOf(profile.dataGovernance).aiAccessEnabled === false) return fail('creation_knowledge_ai_access_disabled', '企业知识库已关闭 AI 访问，请在企业资料中核对设置。', 403);
  const productRows = recordOf(profile.products).items;
  const products = (Array.isArray(productRows) ? productRows : []).map((row, index) => {
    const product = recordOf(row);
    return { id: enterpriseProductIdentity(product, index), name: text(product.name, 200), facts: text(product.highlights, 600) };
  }).filter(row => row.name);
  if (selection.productIds.some(id => !products.some(row => row.id === id))) return fail('creation_product_stale', '产品已变化，请返回重新选择。', 409);
  const selectedProducts = products.filter(row => selection.productIds.includes(row.id));
  const inventory = action === 'start' ? { items: [], status: 'ready' } : await ports.materials(tenantId);
  if (inventory.status === 'unavailable') return fail('creation_inventory_unavailable', '素材库存暂不可用，请重试。', 503);
  const shots: CreationShot[] = [];
  const gaps: string[] = [];
  const first = benchmark.shots[0];
  if (action !== 'start') {
    if (!selectedProducts.length) return fail('creation_product_required', '请至少选择一个知识库产品。');
    if (inventory.status !== 'ready') gaps.push('部分素材源暂不可用，当前仅展示已读取证据。');
    if (first && !first.needsReview && first.granularity === 'shot' && first.start === 0 && first.end !== null && analysis.analysisMode === 'exact') {
      shots.push({ id: `ref:${selection.referenceId}:${first.shotId}`, sourceId: selection.referenceId, title: '参考视频首镜 · 钩子', description: text(first.visual),
        kind: 'hook', start: first.start, end: first.end, ...(first.clipRef ? { previewUrl: first.clipRef } : {}), evidence: `爆款库 ${selection.referenceId} / ${first.shotId}（仅结构参考）` });
    } else gaps.push('参考首镜缺少已核验的精确逐镜证据，请在灵感爆款补齐分析/复核；不会以整条视频代替首镜。');
    for (const material of inventory.items) {
      if (material.libraryRemovedAt || material.type !== 'video' || isSyntheticMaterial(material)) continue;
      const productId = text(material.productId || material.product_id, 200);
      const segments = Array.isArray(material.segments) ? material.segments : [];
      for (const raw of segments) {
        const segment = recordOf(raw);
        if (segment.needsReview !== false && segment.manualConfirmed !== true) continue;
        const start = Number(segment.start); const end = Number(segment.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
        // Classification uses analysed segment attributes, never the asset title.
        const classified = buildBenchmarkAnalysis({ analysis: { gemini: { scriptDetails15s: [{ visual: text(segment.observedFacts || segment.action), environment: text(segment.environment), materialType: segment.materialType }] } } }).shots[0]?.materialType;
        const kind = classified === 'factory' ? 'factory' : productId && selection.productIds.includes(productId) && segment.productVisible === true ? 'product' : null;
        if (!kind) continue;
        const sourceId = text(material.id, 200); const segmentId = text(segment.id, 160);
        if (!sourceId || !segmentId) continue;
        const description = text(segment.observedFacts || segment.action);
        if (!description) continue;
        const url = text(material.url, 2048);
        shots.push({ id: `mat:${createHash('sha256').update(`${sourceId}:${segmentId}`).digest('hex').slice(0, 32)}`, sourceId, title: text(material.name || material.title, 200) || '已分析素材', description,
          kind, start, end, ...(/^(https?:\/\/|\/(?:api|media|studio-media)\/)/.test(url) ? { previewUrl: url } : {}), evidence: `素材库 ${sourceId} / ${segmentId}` });
      }
    }
    shots.sort((a, b) => ['hook', 'factory', 'product'].indexOf(a.kind) - ['hook', 'factory', 'product'].indexOf(b.kind));
    if (!shots.some(shot => shot.kind === 'factory')) gaps.push('暂无经核验的工厂分镜；不会编造工厂能力或画面。');
    if (!shots.some(shot => shot.kind === 'product')) gaps.push('暂无关联所选产品的已核验视频分镜，请补充产品素材分析。');
  }
  const boundedShots = shots.slice(0, 12);
  const evidenceVersion = createHash('sha256').update(JSON.stringify({ referenceId: reference.id, analysis, review: reference.referenceShotReview, products, shots: boundedShots.map(({ previewUrl: _url, ...shot }) => shot) })).digest('hex');
  // Start contains no inventory. Products is the explicit refresh checkpoint.
  if (!['start', 'products'].includes(action) && selection.evidenceVersion !== evidenceVersion) return fail('creation_evidence_stale', '参考、产品或素材证据已变化，请返回产品选择并刷新推荐。', 409);
  if (action === 'products') { selection.shotIds = boundedShots.filter(shot => shot.kind === 'hook').map(shot => shot.id); delete selection.narrationId; delete selection.avatar; }
  if (selection.shotIds.some(id => !boundedShots.some(shot => shot.id === id))) return fail('creation_shot_stale', '所选分镜不在当前授权推荐中，请重新选择。', 409);
  const chosen = boundedShots.filter(shot => selection.shotIds.includes(shot.id));
  const plannedShots: NonNullable<CreationReply['plannedShots']> = chosen.map(shot => ({ id: shot.id, sourceShotId: shot.id, kind: shot.kind }));
  if (['shots', 'narration', 'avatar'].includes(action) && !chosen.length) return fail('creation_shots_required', '请至少选择一个分镜。');
  const narrations: CreationReply['narrations'] = [];
  if (['shots', 'narration', 'avatar'].includes(action)) {
    // Conservative editorial variants. Only KB facts are commercial claims; visual facts stay attributed.
    const names = selectedProducts.map(row => row.name).join('、');
    const wholeSentence = (value: string, max: number) => value.split(/[。！？.!?]/).map(row => row.trim()).find(row => row.length > 0 && row.length <= max) || '';
    const facts = selectedProducts.map(row => wholeSentence(row.facts, 30)).filter(Boolean).slice(0, 1).join('；');
    const visuals = chosen.filter(shot => shot.kind !== 'hook').map(shot => wholeSentence(shot.description, 24)).filter(Boolean).slice(0, 1).join('；');
    if (!facts) gaps.push('产品暂无适合短口播的完整知识库事实句；当前草稿只介绍产品与可见画面。');
    const sequence = [...new Set(chosen.map(shot => ({ hook: '开场画面', factory: '工厂画面', product: '产品细节' }[shot.kind])))].join('、');
    const body = `这次介绍的是${names}。${facts ? `企业资料记录：${facts}。` : ''}${visuals ? `镜头中可见：${visuals}。` : `接下来依次看${sequence}。`}如需了解具体规格，请告诉我们你的使用场景与采购需求，我们根据实际产品资料逐项确认。`;
    for (const [id, title, hook] of [['visual', '画面引入', '先看画面，再了解产品。'], ['question', '需求提问', '你正在寻找怎样的产品？'], ['direct', '产品直述', '这次，带你了解我们的产品。']] as const) {
      const content = `${hook}${body}`;
      const seconds = Math.ceil(content.replace(/\s/g, '').length / 4);
      if (seconds >= 15 && seconds <= 30) narrations.push({ id, title, text: content, seconds });
    }
    if (narrations.length !== 3) { narrations.length = 0; gaps.push('事实或分镜描述过长，无法在不丢失语义的前提下组成 15–30 秒口播；请减少产品/分镜或精炼知识库说明。'); }
  }
  if (['narration', 'avatar'].includes(action) && !narrations.some(row => row.id === selection.narrationId)) return fail('creation_narration_required', '请先选择当前证据下的口播版本。');
  let avatarPlacement: CreationReply['avatarPlacement'] = 'none';
  let presenterIds: string[] = [];
  if (action === 'avatar' && selection.avatar === undefined) return fail('creation_avatar_required', '请选择是否加入数字人。');
  if (action === 'avatar' && selection.avatar) {
    // talking_head is observed presenter form, NOT proof that a person is synthetic.
    const reviewed = loadReferenceShotReview(reference);
    const reviewedFirst = reviewed.shots.find(shot => shot.start === 0 && shot.reviewStatus === 'confirmed' && !shot.mixedScene);
    const labels = reviewedFirst?.labels || [];
    const observed = labels.includes('数字人口播') && !labels.includes('非数字人口播') ? 'digital'
      : labels.includes('非数字人口播') && !labels.includes('数字人口播') ? 'other' : 'unknown';
    avatarPlacement = !first || first.needsReview || observed === 'unknown' || !chosen.some(shot => shot.kind === 'hook') ? 'pending' : observed === 'digital' ? 'first' : 'second';
    if (avatarPlacement !== 'pending') {
      const digitalHuman = { workflow: 'material_processing' as const, method: 'talking' as const, preferredProvider: 'auto' as const, contentConfirmed: false as const, presenterSelected: false as const, action: '', scene: '', preserve: '' };
      if (avatarPlacement === 'first') plannedShots[0] = { ...plannedShots[0]!, kind: 'digital_presenter', digitalHuman };
      else plannedShots.splice(1, 0, { id: `digital:${selection.referenceId}`, sourceShotId: null, kind: 'digital_presenter', digitalHuman });
    }
    if (avatarPlacement === 'pending') gaps.push(!chosen.some(shot => shot.kind === 'hook') ? '未选择参考首镜，请先确认开场钩子后再决定数字人位置。' : '首镜人物形式待核验，暂不决定新增或复用数字人镜头。');
    presenterIds = (await ports.presenters(tenantId)).filter(row => validateHeyGenPresenterRecord(row).ok).map(row => text(row.id, 200)).slice(0, 20);
    if (!presenterIds.length) gaps.push('缺少通过现有人物授权、声音与素材校验的人物资料；数字人待补齐，未启动生成。');
    gaps.push('人物和口播素材仍须在原生产工作台完成选定、素材校验及生成门禁。');
  }
  return creationReplySchema.parse({ stage: { start: 'products', products: 'shots', shots: 'narration', narration: 'avatar', avatar: 'review' }[action],
    selection: { ...selection, referenceLabel: text(reference.title, 200), evidenceVersion }, referenceTitle: text(reference.title, 200), products: products.slice(0, 100).map(({ id, name }) => ({ id, name })),
    shots: boundedShots, narrations, gaps, avatarPlacement, presenterIds, plannedShots });
}
