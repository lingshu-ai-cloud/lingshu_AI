import type { SocialContentTaskSummary, SocialContentVideoPreview } from '../../shared/contracts/socialContentWorkflow.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import { socialJson, socialObject, socialText } from './socialContentValidation.js';

/** Archive evidence enables preview, independently of release/quality approval.
 * Only original tenant-authorized media routes are exposed, never local paths. */
export function socialContentVideoPreview(record: StarterRecord, tenantId: string): SocialContentVideoPreview | null {
  if (record.tenant_id !== tenantId || record.artifact_kind !== 'short_video' || record.status === 'superseded') return null;
  const content = socialObject(socialJson(record.content)), video = socialObject(socialObject(content?.mediaStorage)?.video);
  const fileRef = socialText(record.resource_ref);
  if (!/^socialfile:socialfile_[a-f0-9]{24}$/.test(fileRef) || (video?.fileRef && video.fileRef !== fileRef)) return null;
  const taskId = socialText(record.task_id), artifactId = socialText(record.artifact_id);
  if (!taskId || !artifactId) return null;
  const delivery = socialObject(content?.delivery), review = socialObject(content?.review), render = socialObject(content?.render);
  const testOnly = content?.testOnly === true;
  const requiresRevision = record.status === 'changes_requested' || ['concept_preview', 'needs_revision', 'requires_revision'].includes(socialText(delivery?.status))
    || review?.technicalChecksPassed === false || review?.creativeChecksPassed === false || render?.qualityPassed === false;
  const approved = record.status === 'approved' && !testOnly && !requiresRevision && content?.publishable !== false;
  const technical = socialObject(content?.technicalQualityReport);
  const captionAudit = socialObject(socialObject(technical?.mediaHardProbe)?.captionMaskAudit);
  const captionMismatch = socialObject(captionAudit?.plainCueBinding)?.status === 'mismatch';
  const captionUnverified = captionAudit?.status === 'unknown'
    || (captionAudit?.status === 'observed_mask_delta' && socialObject(captionAudit?.simplePixelProof)?.status !== 'matched');
  const sourceTextRisk = Array.isArray(technical?.sourceTextReview) && technical.sourceTextReview.some(value => socialObject(value)?.status === 'review_required');
  const findings = [sourceTextRisk ? '部分素材含原画面文字，需检查与新增字幕是否冲突；文字位置尚未测量' : '', socialObject(technical?.visual)?.passed === false ? '画面质量检查未通过' : '',
    socialObject(technical?.scenes)?.passed === false ? '分镜检查未通过' : '',
    socialObject(technical?.audio)?.ok === false ? '音轨检查未通过' : '',
    captionMismatch ? '字幕与确认的文案不一致，需修正后重新检查'
      : captionUnverified ? '字幕技术检查尚未完成；口型人工验收不会自动解除此项' : '',
    review?.creativeChecksPassed === false ? '内容检查需修改' : '',
    socialObject(content?.presenterSpeechReview)?.status === 'pending_human_review' && record.status !== 'approved' ? '口型效果待人工验收' : ''].filter(Boolean);
  const notice = testOnly ? '仅测试占位，非正式交付，不可发布。' : requiresRevision ? '已有导出文件，质量或内容检查仍需处理；预览不代表通过验收。'
    : '导出文件可预览；发布仍需沿用原任务的验收和发布检查。';
  return { taskId, artifactId, version: socialText(record.version), updatedAt: socialText(record.updated_at),
    mediaUrl: `/api/overseas/starter-198/social-content/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/media`,
    testOnly, approved, requiresRevision, status: testOnly ? '测试占位 · 不可发布' : requiresRevision ? '需修改 · 可预览' : approved ? '已验收' : '待人工验收',
    reason: notice + (findings.length ? ` ${findings.join('；')}。` : '') };
}

export async function hydrateSocialContentPreviews(input: {
  repository: Starter198Repository; tenantId: string; items: SocialContentTaskSummary[];
}): Promise<SocialContentTaskSummary[]> {
  if (!input.items.length) return input.items;
  const taskIds = new Set(input.items.map(task => task.taskId)), previews = new Map<string, SocialContentVideoPreview[]>();
  let page = 1;
  for (;;) {
    const result = await input.repository.list(STARTER_COLLECTIONS.socialContentArtifacts, input.tenantId,
      { where: { artifact_kind: 'short_video' }, sort: '-updated_at', page, perPage: 200 });
    for (const record of result.items) {
      if (!taskIds.has(socialText(record.task_id))) continue;
      const preview = socialContentVideoPreview(record, input.tenantId);
      if (preview) previews.set(preview.taskId, [...(previews.get(preview.taskId) || []), preview]);
    }
    if (page >= result.totalPages) break;
    page++;
  }
  return input.items.map(task => ({ ...task, renderedPreviews: previews.get(task.taskId) || [] }));
}
