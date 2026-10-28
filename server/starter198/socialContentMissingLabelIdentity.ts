import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentTaskContract.js';
import {normalizedReferenceIdentity, recordReferenceIdentities, sourceReferenceIdentities} from './socialContentReferenceEvidence.js';
import {socialJson, socialObject, socialRequestHash, socialText} from './socialContentValidation.js';

/** Only bind a label request to media when the persisted source, analysis and
 * both independent slot mappings agree. Missing or changed evidence is never
 * converted into a guessed label or a claim of verified identity. */
export async function verifiedMissingLabelIdentity(input: {
  tenantId: string;
  detail: Pick<SocialContentTaskDetail, 'brief' | 'sources' | 'referenceVideoAnalysis' | 'replicationScript' | 'agentWorkflow'>;
  slotIds: string[];
  readRecord?: (id: string) => Promise<Record<string, unknown> | null>;
}) {
  const {detail} = input, pin = detail.brief.referenceReuse, analysis = detail.referenceVideoAnalysis;
  const script = detail.replicationScript, director = detail.agentWorkflow?.directorBrief;
  if (!pin || !analysis || !script || !director || !input.readRecord || !/^[a-f0-9]{64}$/.test(pin.contentSha256)
    || !pin.analysisId || !pin.recordId || analysis.referenceRecordId !== pin.recordId
    || script.referenceAnalysisId !== analysis.analysisId) return null;
  const sources = detail.sources.filter(source => source.sourceId === analysis.referenceSourceId);
  if (sources.length !== 1) return null;
  const source = sources[0]!;
  const record = await input.readRecord(pin.recordId);
  if (!record || record.id !== pin.recordId || socialText(record.tenantId ?? record.tenant_id) !== input.tenantId) return null;
  const exact = socialObject(socialJson(record.aiAnalysis));
  if (!exact || socialText(exact.analysisMode) !== 'exact' || socialText(exact.contentSha256) !== pin.contentSha256 || socialText(exact.analysisRunId) !== pin.analysisId
    || (record.contentSha256 && record.contentSha256 !== pin.contentSha256)
    || ![...sourceReferenceIdentities(source)].some(value => recordReferenceIdentities(record).has(value))) return null;
  const expectedAnalysisId = `reference-analysis-${socialRequestHash({sourceId: source.sourceId,
    sourceRef: normalizedReferenceIdentity(source.sourceRef), recordId: pin.recordId, analysis: record.aiAnalysis,
    shotReview: record.referenceShotReview, verifiedSpeech: record.referenceVerifiedSpeech}).slice(0, 20)}`;
  const expectedVersion = socialRequestHash({recordId: pin.recordId, analysis: record.aiAnalysis,
    shotReview: record.referenceShotReview, verifiedSpeech: record.referenceVerifiedSpeech}).slice(0, 12);
  if (analysis.analysisId !== expectedAnalysisId || analysis.version !== expectedVersion) return null;
  const slots: Array<{shotId: string; referenceShotId: string; observationHash:string}> = [];
  for (const shotId of input.slotIds) {
    const scenes = director.scenes.filter(scene => scene.sceneId === shotId);
    const scriptShots = script.shots.filter(shot => shot.shotId === shotId);
    if (scenes.length !== 1 || scriptShots.length !== 1) return null;
    const referenceShotId = scenes[0]!.referenceShotId;
    if (!referenceShotId || scriptShots[0]!.referenceShotId !== referenceShotId
      || analysis.shots.filter(shot => shot.shotId === referenceShotId).length !== 1) return null;
    const observed=analysis.shots.find(shot=>shot.shotId===referenceShotId)!;
    slots.push({shotId, referenceShotId, observationHash:socialRequestHash({
      startSeconds:observed.startSeconds,endSeconds:observed.endSeconds,visualDescription:observed.visualDescription})});
  }
  return {recordId: pin.recordId, sourceContentSha256: pin.contentSha256, analysisRunId: pin.analysisId,
    referenceAnalysisId: analysis.analysisId, referenceAnalysisVersion: analysis.version, slots};
}
