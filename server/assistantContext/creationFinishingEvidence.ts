import { recordOf } from '../../shared/benchmarkAnalysis.js';
import type { CreationReply, CreationSelection } from '../../shared/contracts/contentCreationDialogue.js';

type Finishing = NonNullable<NonNullable<CreationReply['production']>['finishing']>;
export type CreationProjectReader = (tenantId: string, projectId: string) => Promise<Record<string, unknown> | null>;
/** Uses the existing tenant-scoped Studio project record. Metadata never becomes a playback receipt. */
export async function readCreationFinishingEvidence(tenantId: string, selection: CreationSelection, narration: string, readProject?: CreationProjectReader): Promise<Finishing> {
  const projectId = selection.productionDraft?.projectId;
  const subtitleText = selection.productionDraft?.subtitleDraft || narration;
  const empty = { audioRecords: 0, subtitleRecords: 0, renderRecords: 0, subtitleText };
  if (!projectId) return { ...empty, binding: 'unbound', code: 'creation_project_unbound', note: '当前问答草稿未绑定既有生产项目或运行，无法核验本方案的配音、对齐字幕和成片回执；未查询或套用其他历史项目。' };
  if (!readProject) throw new Error('creation_project_reader_unavailable');
  const project = await readProject(tenantId, projectId);
  if (!project) return { ...empty, projectId, binding: 'mismatch', code: 'creation_project_unavailable', note: '绑定项目不存在或无权访问，不能读取配音、字幕或成片。' };
  const spec = recordOf(project.spec);
  const original = recordOf(spec.creationDialoguePlan || recordOf(spec.studioCreateRequest).creationDialoguePlan);
  const linked = recordOf(original.selection);
  const sameIds = (value: unknown, expected: string[]) => Array.isArray(value) && JSON.stringify(value) === JSON.stringify(expected);
  if (linked.referenceId !== selection.referenceId || linked.evidenceVersion !== selection.evidenceVersion || !sameIds(linked.productIds, selection.productIds) || !sameIds(linked.shotIds, selection.shotIds) || String(spec.voiceoverLines || spec.script || '').trim() !== narration.trim()) {
    return { ...empty, projectId, binding: 'mismatch', code: 'creation_project_plan_mismatch', note: '项目与当前参考、产品、分镜、证据版本或口播不一致；旧配音、字幕及成片不能套用于当前方案。' };
  }
  const audios = Object.values(recordOf(spec.voiceoverAudios)).filter(value => typeof recordOf(value).url === 'string' && Number(recordOf(value).duration) > 0).length;
  const subtitles = Object.values(recordOf(spec.alignedCuesByLang)).filter(value => Array.isArray(value) && value.some(cue => { const c = recordOf(cue); return typeof c.text === 'string' && Number.isFinite(c.start) && Number(c.end) > Number(c.start); })).length;
  const renders = Object.values(recordOf(spec.languageRenderOutputs)).filter(value => { const row = recordOf(value); return typeof row.url === 'string' || typeof row.previewUrl === 'string' || typeof row.path === 'string'; }).length;
  return { binding: 'bound', code: 'creation_project_metadata_only', projectId, audioRecords: audios, subtitleRecords: subtitles, renderRecords: renders, subtitleText,
    note: '已读取同方案既有Studio项目元数据；计数不是可播放、对齐或质量通过回执，还须由原媒体/配音/渲染校验链路核验。此检查不调用生成，也不返回未经核验的播放地址。' };
}
