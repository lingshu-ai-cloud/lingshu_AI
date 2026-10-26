import type { SocialReplicationScriptShot } from '../../shared/contracts/socialContentDiscovery.js';
import type { CreationReply } from '../../shared/contracts/contentCreationDialogue.js';
import type { ResolvedSocialTaskReference } from './socialContentScriptSources.js';
import { SocialContentWorkflowError } from './socialContentValidation.js';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
import { MATERIAL_TYPE_LABELS } from '../../shared/benchmarkAnalysis.js';

/** Only adapts the newly authored visual arrangement; the source ASR and original analysis remain immutable. */
export function applyGuidedCreationStructure(source: ResolvedSocialTaskReference, plan: CreationReply): ResolvedSocialTaskReference {
  const guided = plan.guided, choice = plan.selection.guided;
  if (!guided || !choice || plan.stage !== 'guided_review' || guided.blockers.length || !guided.nodes.length || guided.narration.sourceReferenceId !== source.referenceVideoAnalysis.referenceRecordId) throw new SocialContentWorkflowError('guided_creation_plan_unavailable', 409);
  const output = structuredClone(source);
  const original = output.replicationScript;
  if (choice.scene) {
    if (!choice.scene.narrationConfirmed || !guided.narration.lines?.length) throw new SocialContentWorkflowError('creation_narration_confirmation_required', 409);
    const edits = guided.narration.lines;
    if (edits.length !== original.narrationLines?.length || original.narrationLines.some(line => !edits.some(edit => edit.lineId === line.lineId && edit.sourceText === line.referenceText))) throw new SocialContentWorkflowError('creation_narration_stale', 409);
    original.narrationLines = original.narrationLines.map(line => ({ ...line, draftText: edits.find(edit => edit.lineId === line.lineId)!.text }));
  }
  const duration = source.referenceVideoAnalysis.durationSeconds;
  if (!duration || duration <= 0 || !original.narrationLines?.length) throw new SocialContentWorkflowError('guided_creation_source_timeline_missing', 409);
  const total = guided.nodes.reduce((sum, node) => sum + node.duration, 0);
  let cursor = 0;
  const shots: SocialReplicationScriptShot[] = guided.nodes.map((node, index) => {
    const sourceShot = source.referenceVideoAnalysis.shots.find(shot => shot.shotId === node.sourceShotId || shot.shotId === `reference-${node.sourceShotId}`);
    const template = original.shots.find(shot => shot.referenceShotId === sourceShot?.shotId) || original.shots[0]!;
    const startSeconds = cursor;
    const endSeconds = index === guided.nodes.length - 1 ? duration : Math.round((cursor + node.duration / total * duration) * 1000) / 1000;
    cursor = endSeconds;
    const shotId = `guided-${node.id}`;
    const picked = guided.candidates.find(shot => shot.id === node.selectedCandidateId);
    const ownedHook = index === 0 && choice.scene?.hook?.usage === 'editable';
    const sourceType = node.type === 'talking_head' && choice.presenterMode === 'none' && !ownedHook ? picked?.type || 'product' : node.type;
    const digital = sourceType === 'talking_head' && choice.presenterMode === 'digital' && !ownedHook;
    const productId = plan.selection.productIds[index % plan.selection.productIds.length];
    const productRef = plan.products.find(product => product.id === productId)?.name || null;
    const visualContract = normalizeSceneVisualContract({ subjects: sourceType === 'factory' ? ['factory'] : sourceType === 'product' ? ['product'] : sourceType === 'general' ? ['environment'] : ['person', ...(sourceType === 'consumer_demo' ? ['product'] : [])],
      interaction: { kind: sourceType === 'factory' ? 'factory_process' : sourceType === 'product' ? 'product_only_display' : sourceType === 'talking_head' ? 'person_talking' : sourceType === 'consumer_demo' ? 'person_using_product' : 'none', description: node.description },
      action: { path: node.description }, product: { policy: sourceType === 'product' ? 'locked' : 'open', requestedProductId: productId, requestedProductRef: productRef, source: 'user_explicit' } });
    const refs = picked ? [picked.sourceId] : [];
    const generate = choice.assignments.find(value => value.nodeId === node.id)?.intent === 'generate';
    const boundary = { ...template.materialPlan.truthBoundary,
      subject: sourceType === 'factory' ? 'customer_factory' as const : 'none' as const,
      customerEvidenceRequired: sourceType === 'factory', syntheticVisualAllowed: sourceType !== 'factory',
      customerEvidenceRefs: refs, confirmedFactRefs: [], mustNotImplyCustomerReality: true };
    const lines = original.narrationLines!.filter(line => line.sourceStartSeconds < endSeconds && line.sourceEndSeconds > startSeconds);
    const purpose = index === 0 ? 'hook' as const : index === guided.nodes.length - 1 ? 'call_to_action' as const : sourceShot?.purpose || (sourceType === 'factory' ? 'proof' as const : 'value' as const);
    return { ...template, purpose, shotId, referenceShotId: sourceShot?.shotId || null, startSeconds, endSeconds,
      visualInstruction: `${MATERIAL_TYPE_LABELS[sourceType]}：${node.description}。${node.type === 'talking_head' && choice.presenterMode === 'none' && !ownedHook ? '用产品或工厂实拍承接画外音，不生成出镜人物。' : ''}`,
      materialPlan: { ...template.materialPlan, shotId, sourceRefs: refs, visualContract, productSceneReplication: undefined, digitalHumanPlan: undefined,
        sourceStrategy: digital ? 'authorized_digital_presenter' as const : generate && sourceType === 'product' ? 'aigc_product_scene_replication' as const : 'customer_real_asset' as const,
        fallbackSourceStrategy: null, truthBoundary: boundary,
        referenceProductionRouting: undefined, materialRouting: undefined, selectedMaterialSegment: picked ? { sourceRef: picked.sourceId, segmentId: picked.segmentId, startSeconds: picked.start, endSeconds: picked.end } : null,
        functionalEquivalentReplacement: { required: true, preservesFunction: purpose, replacesSubject: null,
          description: `用户在自由创作中选择${MATERIAL_TYPE_LABELS[sourceType]}画面`, reason: '画面重新编排，原口播句序和时间轴不变；不声称原片逐镜保真。' },
      },
      speechLines: lines, spokenText: null, referenceSpokenText: null, risks: [],
    };
  });
  // A sentence may span several visual slots, but only its first slot owns the audio.
  const lines = original.narrationLines.map(line => {
    const owners = shots.filter(shot => line.sourceStartSeconds < shot.endSeconds && line.sourceEndSeconds > shot.startSeconds);
    if (!owners.length) throw new SocialContentWorkflowError('guided_creation_narration_coverage_missing', 409);
    return { ...line, narrationOwnerShotId: owners[0]!.shotId, visualShotIds: owners.map(shot => shot.shotId) };
  });
  for (const shot of shots) {
    shot.speechLines = lines.filter(line => line.visualShotIds.includes(shot.shotId));
    shot.spokenText = lines.filter(line => line.narrationOwnerShotId === shot.shotId).map(line => line.draftText).join(' ') || null;
    shot.referenceSpokenText = lines.filter(line => line.narrationOwnerShotId === shot.shotId).map(line => line.referenceText).join(' ') || null;
  }
  output.replicationScript = { ...original, shots, narrationLines: lines,
    structureFidelitySummary: '用户选择的自由创作画面结构；原口播句序、来源及时间范围保持不变，不声称原片逐镜保真。' };
  output.shotMaterialMap = shots.map(shot => ({ shotId: shot.shotId, customerAssetIds: [...shot.materialPlan.sourceRefs], generatedAssetIds: [], licensedAssetIds: [], sourceStrategy: shot.materialPlan.sourceStrategy, truthBoundary: shot.materialPlan.truthBoundary, functionalEquivalentReplacement: shot.materialPlan.functionalEquivalentReplacement }));
  return output;
}
