import { hasReferenceMaterialOrigin, isReferenceOnlyMaterial } from '../lib/materialPolicy.js';
import { materialRoutingRequests } from '../starter198/socialContentMaterialRoutingRequests.js';
import type { SocialWorkflowMaterialClipCandidate } from '../starter198/socialContentMaterialCandidateSupport.js';
import { collectCreationShots } from './creationShotEvidence.js';
import { createHash } from 'node:crypto';
import { buildBenchmarkAnalysis, recordOf, type BenchmarkMaterialType } from '../../shared/benchmarkAnalysis.js';
import { type CreationReply, type CreationTurn, type CreationShot, creationReplySchema } from '../../shared/contracts/contentCreationDialogue.js';
import type { GuideNode, GuidedReply } from '../../shared/contracts/guidedCreation.js';
import { buildSocialReferenceReuseBinding } from '../starter198/socialContentReferenceReuse.js';
import { buildSocialTaskReferencePackage } from '../starter198/socialContentScriptSources.js';
import { guidedEnterpriseContext } from './guidedCreationKnowledge.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { buildSocialWorkflowMaterialCandidates } from '../starter198/socialContentRecordProjection.js';
import type { MaterialRecord } from '../lib/materialLibrary.js';
import { validateHeyGenPresenterRecord } from '../lib/presenterAssetTrust.js';
import { CreationDialogueError, type CreationEvidencePorts } from './contentCreationDialogue.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown) => typeof value === 'string' ? value : '';
const parse = (value: unknown) => recordOf(typeof value === 'string' ? JSON.parse(value) : value);
const fail = (code: string, message: string, status = 422): never => { throw new CreationDialogueError(code, status, message); };
const types = new Set<BenchmarkMaterialType>(['talking_head', 'factory', 'product', 'consumer_demo', 'general']);
function structure(row: Record<string, unknown>, source: 'reference' | 'recommended', reason: string): GuidedReply['structures'][number] {
  const benchmark = buildBenchmarkAnalysis({ analysis: parse(row.aiAnalysis), videoId: text(row.id), duration: Number(row.duration) });
  const available = benchmark.timelineComplete && benchmark.shots.length > 0 && benchmark.structure.length <= 64
    && benchmark.shots.every(shot => !shot.needsReview && shot.granularity === 'shot' && types.has(shot.materialType));
  return { id: `${source}:${row.id}`, referenceId: text(row.id), title: text(row.title), source,
    ...(text(row.crawledAt) ? { crawledAt: text(row.crawledAt) } : {}),
    ...(typeof row.views === 'number' && row.views >= 0 ? { views: row.views } : {}), reason,
    nodes: available ? benchmark.structure.map((group, index) => ({ id: `node:${index + 1}`, type: group.materialType as GuideNode['type'], sourceShotId: group.shotIds[0], sourceShotIds: group.shotIds })) : [], available };
}
const b2bEvidence = (row: Record<string, unknown>) => {
  const benchmark = buildBenchmarkAnalysis({ analysis: parse(row.aiAnalysis), videoId: text(row.id), duration: Number(row.duration) });
  return benchmark.shots.some(shot => ['capability_proof', 'cta'].includes(shot.narrativeRole)
    && /OEM|ODM|MOQ|询盘|批发|定制|供应|supplier|wholesale|manufacturer|inquir|contact|quote/i.test(`${shot.dialogue} ${shot.purpose} ${shot.visual}`));
};

/** Adapts the existing planning evidence, matcher and replication script package. No provider or queue calls. */
export async function guidedCreationTurn(tenantId: string, turn: CreationTurn, ports: CreationEvidencePorts,
  readEvidence: (turn: CreationTurn) => Promise<CreationReply>): Promise<CreationReply> {
  const { selection, action } = turn;
  const guided = selection.guided!;
  const starting = action === 'start';
  if (!starting && !action.startsWith('guided_')) return fail('creation_guided_action_required', '请使用当前自由创作问题中的选项。');
  // Products remains the existing explicit refresh checkpoint.
  const legacy = await readEvidence({ ...turn, action: starting ? 'start' : 'products', selection: { ...selection, guided: undefined, shotIds: [], narrationId: undefined, avatar: undefined, productionDraft: undefined } });
  if (!starting && !guided.languages.length) return fail('creation_language_required', '请至少选择一种视频语言。');
  const profile = recordOf(await ports.profile(tenantId));
  const reference = await ports.reference(tenantId, selection.referenceId);
  if (!reference || reference.tenantId !== tenantId) return fail('creation_reference_unavailable', '参考视频不存在或无权访问。', 404);
  const original = structure(reference, 'reference', '沿用当前参考视频的真实逐镜结构');
  const singleType = new Set(original.nodes.map(node => node.type)).size <= 1;
  const requiresRecommendation = singleType || !original.nodes.some(node => node.type === 'factory') || !b2bEvidence(reference);
  const reason = singleType ? '当前参考的素材类型较单一' : !original.nodes.some(node => node.type === 'factory') ? '当前参考缺少工厂画面' : '当前逐镜证据未显示明确的B2B询盘表达';
  const records = requiresRecommendation && ports.references ? await ports.references(tenantId) : [];
  const eligible = records.filter(row => row.tenantId === tenantId && row.id !== reference.id).map(row => ({ row, value: structure(row, 'recommended', reason) }))
    .filter(({ row, value }) => value.available && value.nodes[0]?.type === original.nodes[0]?.type && new Set(value.nodes.map(node => node.type)).size > 1 && value.nodes.some(node => node.type === 'factory') && b2bEvidence(row))
    .sort((a, b) => Number(b.value.views || 0) - Number(a.value.views || 0) || text(a.row.id).localeCompare(text(b.row.id)));
  const recommended = eligible[0];
  const structures: GuidedReply['structures'] = [original, ...(recommended ? [recommended.value] : []), { id: 'custom', referenceId: selection.referenceId, title: '自己组合爆款结构', source: 'custom', reason: '添加、重复组合和调整素材类型顺序；口播仍沿用当前参考的来源', nodes: guided.customNodes, available: true }];
  const inventory = starting ? { items: [], status: 'ready' } : await ports.materials(tenantId);
  if (inventory.status === 'unavailable') return fail('creation_inventory_unavailable', '当前素材库存暂不可用，请稍后重试。', 503);
  const evidenceVersion = hash({ legacy: legacy.selection.evidenceVersion, reference, profile, recommendations: eligible.map(value => value.row), inventory: inventory.items.map(({ url: _signedUrl, thumbnailUrl: _thumbnail, ...row }) => row) });
  if (!starting && action !== 'guided_products' && selection.evidenceVersion !== evidenceVersion) return fail('creation_evidence_stale', '参考、产品或素材证据已变化，请重新确认产品和语言。', 409);
  const selected = structures.find(value => value.id === guided.structureId);
  const blockers: GuidedReply['blockers'] = [];
  const notices: string[] = [];
  if (!original.available) notices.push('参考视频尚缺完整、已复核的逐镜分类，不能伪造其精准结构；可以自定义结构或先补齐参考分析。');
  if (requiresRecommendation && !recommended) notices.push(`${reason}；当前历史库没有同时满足同类型开头、工厂画面和B2B证据的已核验参考，不编造推荐或浏览量。`);
  if (['guided_structure', 'guided_production', 'guided_review'].includes(action) && (!selected || !selected.available || !selected.nodes.length)) return fail('creation_structure_required', '请选择有证据的爆款结构，或添加自定义节点。');
  const sourceReference = selected?.source === 'recommended' ? recommended!.row : reference;
  const sourceBenchmark = buildBenchmarkAnalysis({ analysis: parse(sourceReference.aiAnalysis), videoId: text(sourceReference.id), duration: Number(sourceReference.duration) });
  const sources = sourceBenchmark.shots;
  const fullEvidence = collectCreationShots(text(sourceReference.id), selection.productIds, parse(sourceReference.aiAnalysis), sourceBenchmark, inventory);
  const nodes: GuidedReply['nodes'] = [];
  const mediaCandidates: GuidedReply['candidates'] = [];
  const shots: CreationShot[] = [];
  const selectedNodes = selected?.nodes || [];
  if (new Set(selectedNodes.map(node => node.id)).size !== selectedNodes.length) return fail('creation_duplicate_node', '结构节点身份重复，请重新组合。');
  const allProductIds = new Set(selection.productIds);
  const ownedInventory = inventory.items.filter(row => !hasReferenceMaterialOrigin(row) && !isReferenceOnlyMaterial(row));
  const admitted = selection.productIds.flatMap(productId => buildSocialWorkflowMaterialCandidates({ records: ownedInventory as MaterialRecord[], tenantId, selectedProductId: productId, voiceoverRows: [] }).candidates);
  const admittedForSlot = (candidate: SocialWorkflowMaterialClipCandidate, duration: number, type: GuideNode['type']) => Boolean(materialRoutingRequests({ policyVersion: 'type-aware.v2', tenantId, productRef: candidate.productRef,
    shots: [{ shotId: 'guided-candidate', function: 'value', materialType: type, productRef: candidate.productRef, visualContract: candidate.visualContract, requestedDescription: candidate.visualContract.action.path || candidate.label, plannedDurationSeconds: duration }], candidates: [candidate] })[0]?.selectedMaterialSegment);
  const productionCandidate = (candidate: CreationShot, duration: number, type: GuideNode['type']) => admitted.find(value => value.assetId === candidate.sourceId && value.segmentId === candidate.segmentId && value.timeRange && Math.abs(value.timeRange.startSeconds - candidate.start) < .05 && (type !== 'product' || Boolean(value.productId && allProductIds.has(value.productId))) && admittedForSlot(value, duration, type));
  const durationUnits = selectedNodes.map(node => {
    const first = sources.find(shot => shot.shotId === node.sourceShotId), last = sources.find(shot => shot.shotId === node.sourceShotIds?.at(-1)) || first;
    return first?.start !== null && last?.end !== null && first?.start !== undefined && last?.end !== undefined ? last.end - first.start : 4;
  });
  const totalUnits = durationUnits.reduce((sum, duration) => sum + duration, 0);
  const sourceDuration = Number(sourceReference.duration) > 0 ? Number(sourceReference.duration) : totalUnits;
  let assignedDuration = 0;
  for (const [nodeIndex, node] of selectedNodes.entries()) {
    const source = sources.find(shot => shot.shotId === node.sourceShotId);
    const duration = nodeIndex === selectedNodes.length - 1 ? +(sourceDuration - assignedDuration).toFixed(3) : +(durationUnits[nodeIndex]! / totalUnits * sourceDuration).toFixed(3);
    assignedDuration += duration;
    const description = source?.visual || ({ talking_head: '真人口播', factory: '工厂实拍', product: '产品实拍', consumer_demo: '使用演示', general: '通用画面' }[node.type]);
    const broll = node.type === 'talking_head' && guided.presenterMode === 'none';
    const effectiveType = broll ? 'product' : node.type;
    const pool: GuidedReply['candidates'] = fullEvidence.shots.filter(shot => broll ? ['product', 'factory'].includes(shot.kind) : effectiveType === 'product' ? shot.kind === 'product' : effectiveType === 'factory' ? shot.kind === 'factory' : false)
      .map(shot => ({ ...shot, segmentId: shot.segmentId || '', type: shot.kind === 'factory' ? 'factory' as const : effectiveType, productionEligible: Boolean(productionCandidate(shot, duration, shot.kind === 'factory' ? 'factory' : effectiveType)) }));
    const role = effectiveType === 'talking_head' ? 'presenter' : effectiveType === 'consumer_demo' ? 'person_usage' : effectiveType === 'general' ? 'general' : effectiveType;
    for (const candidate of admitted.filter(value => value.mediaType === 'video' && (value.materialRoles.includes(role) || broll && value.materialRoles.includes('factory')) && value.timeRange && value.timeRange.endSeconds - value.timeRange.startSeconds >= duration)) {
      if (effectiveType === 'product' && !candidate.materialRoles.includes('factory') && (!candidate.productId || !allProductIds.has(candidate.productId))) continue;
      const raw = inventory.items.find(row => row.id === candidate.assetId);
      const id = `mat:${createHash('sha256').update(`${candidate.assetId}:${candidate.segmentId}`).digest('hex').slice(0, 32)}`;
      if (!raw || pool.some(row => row.id === id)) continue;
      const url = text(raw.url);
      pool.push({ id, sourceId: candidate.assetId, segmentId: candidate.segmentId, title: candidate.label, description, type: broll && candidate.materialRoles.includes('factory') ? 'factory' : effectiveType,
        start: candidate.timeRange!.startSeconds, end: candidate.timeRange!.endSeconds, ...(/^(https?:\/\/|\/(?:api|media|studio-media)\/)/.test(url) ? { previewUrl: url } : {}), productionEligible: admittedForSlot(candidate, duration, broll && candidate.materialRoles.includes('factory') ? 'factory' : effectiveType) });
    }
    const candidates = pool.filter(row => Boolean(row.segmentId)).sort((a, b) => Number(b.productionEligible) - Number(a.productionEligible)).slice(0, 4);
    for (const candidate of candidates) if (!mediaCandidates.some(row => row.id === candidate.id)) mediaCandidates.push(candidate);

    const assignment = guided.assignments.find(value => value.nodeId === node.id);
    if (assignment?.intent === 'match' && !candidates.some(value => value.id === assignment.candidateId)) return fail('creation_candidate_stale', '所选片段不属于当前节点的候选，请重新选择。', 409);
    let chosen = assignment?.intent === 'match' ? candidates.find(value => value.id === assignment.candidateId) : undefined;
    if (guided.productionMode === 'auto' && !(node.type === 'talking_head' && guided.presenterMode !== 'none')) {
      chosen = candidates.find(value => value.productionEligible);
    }
    const digital = node.type === 'talking_head' && guided.presenterMode === 'digital';
    const shooting = node.type === 'talking_head' && guided.presenterMode === 'shoot';
    const generating = digital || assignment?.intent === 'generate';
    const usable = Boolean(chosen?.productionEligible);
    nodes.push({ ...node, description, duration, candidates: candidates.map(value => value.id), ...(chosen ? { selectedCandidateId: chosen.id } : {}), status: shooting ? 'shooting' : generating ? 'generate' : usable ? 'matched' : chosen ? 'candidate' : 'needs_material' });
    if (['guided_production', 'guided_review'].includes(action)) {
      if (generating && !digital && !['product', 'factory'].includes(effectiveType)) blockers.push({ code: 'creation_generation_type_unsupported', nodeId: node.id, message: `${node.id} 当前素材类型没有已接通的生成链路，请匹配本地素材或调整结构。` });
      if (generating && node.type === 'factory') blockers.push({ code: 'creation_factory_evidence_required', nodeId: node.id, message: `${node.id} 工厂画面需真实企业素材，不能用生成内容证明企业产能；请选择已有片段或调整结构。` });
      if (shooting) blockers.push({ code: 'creation_shooting_required', nodeId: node.id, message: `${node.id} 已安排实拍，等待真实素材回填。` });
      else if (!generating && !usable) blockers.push({ code: 'creation_material_required', nodeId: node.id, message: `${node.id} ${chosen ? '所选片段暂未通过现有生产素材匹配' : '尚无可用素材'}；不使用参考视频冒充企业实拍。` });
      if (guided.productionMode === 'manual' && !assignment && !digital && !shooting) blockers.push({ code: 'creation_node_answer_required', nodeId: node.id, message: `请为${node.id}选择片段或生成方式。` });
    }
  }
  if (guided.assignments.some(value => !nodes.some(node => node.id === value.nodeId))) return fail('creation_node_stale', '结构已变化，旧节点选择已失效。', 409);
  const context = guidedEnterpriseContext(profile as unknown as EnterpriseProfile, selection.productIds);
  const packageValue = !starting && selected ? buildSocialTaskReferencePackage({ record: sourceReference, source: { sourceId: text(sourceReference.id), sourceRef: `trendvideo:${sourceReference.id}`, sourceVersion: null, createdAt: text(sourceReference.crawledAt) || '1970-01-01T00:00:00.000Z' }, themeId: 'supplier_capability', verifiedContext: { ...context, productName: legacy.products.filter(row => allProductIds.has(row.id)).map(row => row.name).join('、') || context.productName } }) : null;
  const narrationText = packageValue?.replicationScript?.narrationLines?.map(line => line.draftText).join('\n') || '';
  const narration: GuidedReply['narration'] = { sourceReferenceId: text(sourceReference.id), sourceTitle: text(sourceReference.title), text: narrationText, status: narrationText ? 'ready' : 'needs_evidence', note: narrationText ? '复用爆款复刻的逐句口播与企业身份替换；后台继续核验事实并按所选语言处理，不另问口播和字幕。' : '该结构来源尚缺可复用的原始口播证据；不以模板口播冒充原视频台词。' };
  if (['guided_production', 'guided_review'].includes(action)) {
    if (sourceDuration < 6 || sourceDuration > 60) blockers.push({ code: 'creation_duration_unsupported', message: '当前原口播时长超出现有单条生产链路的 6–60 秒范围；不会静默截断或改变口播时间轴。' });
    if (!guided.productionMode || !guided.presenterMode) return fail('creation_production_mode_required', '请选择制作方式和出镜方式。');
    if (narrationText) {
      try { await buildSocialReferenceReuseBinding({ tenantId, recordId: text(sourceReference.id), themeId: 'supplier_capability', verifiedContext: context,
        source: { sourceId: text(sourceReference.id), sourceRef: text(sourceReference.sourceUrl), sourceVersion: null, createdAt: text(sourceReference.crawledAt) } }, { readRecord: async () => sourceReference }); }
      catch { blockers.push({ code: 'creation_reference_provenance_required', message: '当前参考缺少可复用的媒体哈希或分析版本，不能进入原生产链路；请先补齐参考分析证据。' }); }
    }
    if (!narrationText) blockers.push({ code: 'creation_source_speech_required', message: '缺少当前结构来源的原始口播证据，需补齐分析后自动处理。' });
    if (guided.presenterMode === 'digital' && nodes.some(node => node.type === 'talking_head') && !(await ports.presenters(tenantId)).some(row => validateHeyGenPresenterRecord(row).ok)) blockers.push({ code: 'creation_presenter_required', message: '当前没有通过人物、音色和使用授权校验的数字人资产。' });
  }
  const stage = starting ? 'guided_products' : action === 'guided_products' ? 'guided_structure' : ['guided_structure', 'guided_preview'].includes(action) ? 'guided_production' : 'guided_review';
  const nextGuided = action === 'guided_products' ? { ...guided, structureId: undefined, assignments: [], productionMode: undefined, presenterMode: undefined, taskId: undefined } : action === 'guided_structure' ? { ...guided, assignments: [], productionMode: undefined, presenterMode: undefined, taskId: undefined } : guided;
  return creationReplySchema.parse({ ...legacy, stage, selection: { ...selection, guided: nextGuided, evidenceVersion, referenceLabel: text(reference.title).slice(0, 200) }, shots, narrations: [], plannedShots: undefined, gaps: [], guided: { structures, nodes, candidates: mediaCandidates, narration, blockers, notices, fingerprint: hash({ evidenceVersion, selection: { ...selection, evidenceVersion, guided: { ...guided, taskId: undefined } }, nodes, narration }) } });
}
