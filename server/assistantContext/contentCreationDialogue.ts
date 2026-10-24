import { readCreationFinishingEvidence, type CreationProjectReader } from './creationFinishingEvidence.js';
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
  project?: CreationProjectReader;
  references?: (tenantId: string) => Promise<Record<string, unknown>[]>;
  reference: (tenantId: string, id: string) => Promise<Record<string, unknown> | null>;
  profile: (tenantId: string) => Promise<unknown>;
  materials: (tenantId: string) => Promise<{ items: Record<string, unknown>[]; status: string }>;
  presenters: (tenantId: string) => Promise<Record<string, unknown>[]>;
};
const text = (value: unknown, max = 700) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const observedText = (segment: Record<string, unknown>) => text(Array.isArray(segment.observedFacts) ? segment.observedFacts.filter(value => typeof value === 'string').join('；') : segment.observedFacts) || text(segment.action);
const fail = (code: string, message: string, status = 422): never => { throw new CreationDialogueError(code, status, message); };

/** Read-only planning in the existing strategy domain. No provider, task or queue writes. */
export async function contentCreationTurn(tenantId: string, input: unknown, ports: CreationEvidencePorts): Promise<CreationReply> {
  const parsed = creationTurnSchema.safeParse(input);
  if (!parsed.success) return fail('creation_input_invalid', '创作选择格式无效，请重新选择。', 400);
  if (parsed.data.selection.guided) {
    const { guidedCreationTurn } = await import('./guidedCreation.js');
    return guidedCreationTurn(tenantId, parsed.data, ports, turn => contentCreationTurn(tenantId, turn, ports));
  }
  const { action } = parsed.data;
  if (action === 'guided_products' || action === 'guided_structure' || action === 'guided_production' || action === 'guided_review') return fail('creation_guided_selection_required', '自由创作选择格式无效。');
  const productionAction = action.startsWith('production_');
  const needsNarration = ['shots', 'narration', 'avatar'].includes(action) || productionAction;
  const selection = { ...parsed.data.selection, ...(parsed.data.selection.productionDraft ? { productionDraft: { ...parsed.data.selection.productionDraft } } : {}) };
  if (action === 'production_review' && selection.productionDraft) { delete selection.productionDraft.voiceChoice; delete selection.productionDraft.subtitleChoice; delete selection.productionDraft.subtitleDraft; }
  if (action === 'start') { delete selection.productionDraft; selection.shotIds = []; delete selection.narrationId; delete selection.avatar; }
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
        const classified = buildBenchmarkAnalysis({ analysis: { gemini: { scriptDetails15s: [{ visual: observedText(segment), environment: text(segment.environment), materialType: segment.materialType }] } } }).shots[0]?.materialType;
        const kind = classified === 'factory' ? 'factory' : productId && selection.productIds.includes(productId) && segment.productVisible === true ? 'product' : null;
        if (!kind) continue;
        const sourceId = text(material.id, 200); const segmentId = text(segment.id, 160);
        if (!sourceId || !segmentId) continue;
        const description = observedText(segment);
        if (!description) continue;
        const url = text(material.url, 2048);
        if (!/^(https?:\/\/|\/(?:api|media|studio-media)\/)/.test(url)) gaps.push(`素材 ${sourceId} 缺少可播放地址；仅保留分析记录，未确认可生产。`);
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
  if (action === 'products') { delete selection.productionDraft; selection.shotIds = boundedShots.filter(shot => shot.kind === 'hook').map(shot => shot.id); delete selection.narrationId; delete selection.avatar; }
  if (selection.shotIds.some(id => !boundedShots.some(shot => shot.id === id))) return fail('creation_shot_stale', '所选分镜不在当前授权推荐中，请重新选择。', 409);
  const chosen = boundedShots.filter(shot => selection.shotIds.includes(shot.id));
  const plannedShots: NonNullable<CreationReply['plannedShots']> = chosen.map(shot => ({ id: shot.id, sourceShotId: shot.id, kind: shot.kind }));
  if (needsNarration && !chosen.length) return fail('creation_shots_required', '请至少选择一个分镜。');
  const narrations: CreationReply['narrations'] = [];
  if (needsNarration) {
    // Conservative editorial variants. Only KB facts are commercial claims; visual facts stay attributed.
    if (chosen.reduce((sum, shot) => sum + shot.end - shot.start, 0) < 15) gaps.push('所选画面不足15秒，尚不能覆盖完整口播；请补齐可用画面，参考片段仅作结构借鉴。');
    if (chosen.some(shot => shot.kind === 'factory')) gaps.push('工厂镜头仅证明画面中可见内容；仍需核验使用权和企业归属，不代表所选产品的生产能力。');
    const names = selectedProducts.map(row => row.name).join('、');
    const wholeSentence = (value: string, max: number) => value.split(/[。！？.!?；;]/).map(row => row.trim()).find(row => row.length > 0 && row.length <= max) || '';
    const facts = selectedProducts.map(row => wholeSentence(row.facts, 30)).filter(Boolean).slice(0, 1).join('；');
    const visuals = chosen.filter(shot => shot.kind !== 'hook').map(shot => wholeSentence(shot.description, 24)).filter(Boolean).slice(0, 1).join('；');
    if (!facts) gaps.push('产品暂无适合短口播的完整知识库事实句；当前草稿只介绍产品与可见画面。');
    const sequence = [...new Set(chosen.map(shot => ({ hook: '开场画面', factory: '工厂画面', product: '产品细节' }[shot.kind])))].join('、');
    const body = `这次介绍${names}。${facts ? `企业资料记录：${facts}。` : ''}${visuals ? `镜头中可见：${visuals}。` : `接下来依次看${sequence}。`}更多规格，请以实际产品资料为准。`;
    for (const [id, title, hook] of [['visual', '画面引入', '先看画面，再了解产品。'], ['question', '需求提问', '你正在寻找怎样的产品？'], ['direct', '产品直述', '这次，带你了解我们的产品。']] as const) {
      const content = `${hook}${body}`;
      const seconds = Math.ceil(content.replace(/\s/g, '').length / 4);
      if (seconds >= 15 && seconds <= 30) narrations.push({ id, title, text: content, seconds });
    }
    if (narrations.length !== 3) { narrations.length = 0; gaps.push('事实或分镜描述过长，无法在不丢失语义的前提下组成 15–30 秒口播；请减少产品/分镜或精炼知识库说明。'); }
  }
  if ((['narration', 'avatar'].includes(action) || productionAction) && !narrations.some(row => row.id === selection.narrationId)) return fail('creation_narration_required', '请先选择当前证据下的口播版本。');
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
  let production: CreationReply['production'];
  if (productionAction) {
    if (selection.avatar !== false) return fail('creation_material_only_required', '本轮先不加入数字人，请返回问答选择“不加入”。');
    if (['production_edit', 'production_review', 'production_voice', 'production_subtitles', 'production_preview', 'production_finish'].includes(action) && !selection.productionDraft?.materialChoice) return fail('creation_material_choice_required', '请先回答是否保留工厂素材候选。');
    const narration = selection.productionDraft?.narrationDraft || narrations.find(row => row.id === selection.narrationId)!.text;
    const seconds = Math.ceil(narration.replace(/\s/g, '').length / 4);
    if (seconds < 15 || seconds > 30) gaps.push('编辑后的口播预计不在15–30秒内，请继续调整；尚未合成语音。');
    gaps.push('素材匹配尚未完成使用权及所选产品归属核验；保留候选不等于已授权或已完成匹配。');
    if (selection.productionDraft?.narrationDraft) gaps.push('口播为人工编辑草稿，商业陈述仍需对照产品资料复核。');
    production = { narration, seconds, materialChoice: selection.productionDraft?.materialChoice, shots: chosen.map(shot => ({ id: shot.id, title: shot.title, description: shot.description, sourceId: shot.sourceId, start: shot.start, end: shot.end,
      status: shot.kind === 'hook' ? 'reference_only' as const : selection.productionDraft?.materialChoice === 'skip' ? 'skipped' as const : 'candidate' as const })) };
    if (!chosen.some(shot => shot.kind === 'product')) production.shots.push({ id: 'missing:product', title: '所选产品实拍 · 待补', description: '没有找到关联当前产品的已核验实拍；不分配参考视频或第三方产品画面。', status: 'missing' });
    if (['production_voice', 'production_subtitles', 'production_preview', 'production_finish'].includes(action)) {
      if (!selection.productionDraft?.narrationDraft) return fail('creation_voice_text_unconfirmed', '请先在口播问答中确认本次文字。');
      if (['production_subtitles', 'production_preview', 'production_finish'].includes(action) && !selection.productionDraft.voiceChoice) return fail('creation_voice_choice_required', '请先回答配音需求；本轮不调用声音生成。');
      if (['production_preview', 'production_finish'].includes(action) && !selection.productionDraft.subtitleChoice) return fail('creation_subtitle_choice_required', '请先回答字幕文字处理方式。');
      production.finishing = await readCreationFinishingEvidence(tenantId, selection, narration, ports.project);
      gaps.push(production.finishing.note);
      gaps.push('当前问答没有接入已核验的配音试听或成片预览；字幕文字草稿没有真实音频对齐时间码。未生成音频、字幕文件或成片。');
    }
  }
  return creationReplySchema.parse({ production, stage: { start: 'products', products: 'shots', shots: 'narration', narration: 'avatar', avatar: 'review', production_storyboard: 'production_shots', production_match: 'production_materials', production_edit: 'production_narration', production_review: 'production_review', production_voice: 'production_voice', production_subtitles: 'production_subtitles', production_preview: 'production_preview', production_finish: 'production_finish' }[action],
    selection: { ...selection, referenceLabel: text(reference.title, 200), evidenceVersion }, referenceTitle: text(reference.title, 200), products: products.slice(0, 100).map(({ id, name }) => ({ id, name })),
    shots: boundedShots, narrations, gaps, avatarPlacement, presenterIds, plannedShots });
}
