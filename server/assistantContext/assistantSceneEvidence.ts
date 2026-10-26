import type { AssistantScenePlan } from '../../shared/contracts/assistantScenePlan.js';
import type { GuidedReply } from '../../shared/contracts/guidedCreation.js';
import type { SocialReplicationScriptVersion } from '../../shared/contracts/socialContentDiscovery.js';
import { CreationDialogueError } from './contentCreationDialogue.js';

export function sceneNarration(scene: AssistantScenePlan | undefined, lines: NonNullable<SocialReplicationScriptVersion['narrationLines']>) {
  if (lines.some(line => !line.lineId)) throw new CreationDialogueError('creation_narration_line_identity_missing', 422, '原片口播缺少逐句身份，请补齐参考分析。');
  if (!scene) return lines.map(line => ({ lineId: line.lineId!, sourceText: line.referenceText, text: line.draftText }));
  const edits = scene.narrationEdits;
  if (new Set(edits.map(line => line.lineId)).size !== edits.length || edits.some(edit => !lines.some(line => line.lineId === edit.lineId))
    || scene.narrationConfirmed && (edits.length !== lines.length || !lines.length)) {
    throw new CreationDialogueError('creation_narration_stale', 409, '原片口播句子已变化，请重新核对并确认全部口播。');
  }
  return lines.map(line => ({ lineId: line.lineId!, sourceText: line.referenceText, text: edits.find(edit => edit.lineId === line.lineId)?.text || line.draftText }));
}

/** Match only admitted tenant-owned clips; user uploads are preferences, not a bypass of visual evidence. */
export function verifySceneMaterials(scene: AssistantScenePlan | undefined, nodes: GuidedReply['nodes'], candidates: GuidedReply['candidates'], blockers: GuidedReply['blockers'], referenceHookMatches = false) {
  if (!scene) return;
  if (Date.parse(scene.deliverBy) <= Date.now() || Date.parse(scene.plannedPublishAt) <= Date.now()) blockers.push({ code:'creation_schedule_expired', message:'交付或发布时间已过，请重新确认时间。' });
  if (!scene.narrationConfirmed) blockers.push({ code: 'creation_narration_confirmation_required', message: '请先逐句核对活动或开场口播，并确认后再开始创作。' });
  if (scene.campaign) for (const id of scene.campaign.materialIds) {
    if (!nodes.slice(1, -1).some(node => candidates.find(candidate => candidate.id === node.selectedCandidateId)?.sourceId === id)) {
      blockers.push({ code: 'creation_campaign_material_unmatched', message: '有活动素材尚未匹配到合适的说明性分镜，请补齐素材分析、授权或调整参考结构。' });
    }
  }
  if (scene.hook) {
    const first = candidates.find(candidate => candidate.id === nodes[0]?.selectedCandidateId);
    if (scene.hook.usage === 'reference_only' && !referenceHookMatches) blockers.push({ code: 'creation_hook_reference_analysis_required', message: '仅供参考的开场需选同源已分析对标视频，且片段须覆盖首个结构节点；原画面不会剪入企业成片。' });
    else if (scene.hook.usage === 'editable' && (!first || first.sourceId !== scene.hook.materialId || first.start !== scene.hook.startSeconds || first.end !== scene.hook.endSeconds)) {
      blockers.push({ code: 'creation_hook_range_unmatched', message: '选定开场的精确片段尚未通过现有分镜素材校验。' });
    }
  }
}
