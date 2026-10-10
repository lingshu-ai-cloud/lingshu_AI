import { createHash } from 'node:crypto';
import { benchmarkTimeRange, buildBenchmarkAnalysis, recordOf } from '../../shared/benchmarkAnalysis.js';
import { newShotProduction } from '../../src/lib/shotProduction.js';

export interface AutomatedReplicationShot {
  shotId: string; slotId: string; kind: 'person' | 'nonperson'; start: number; end: number;
  firstFrameRequest?: Record<string, unknown>;
}
export interface ReplicationWorkbenchInput {
  tenantId: string; projectId: string; spec: Record<string, unknown>;
  reference: Record<string, unknown>; assets?: Array<Record<string, unknown>>;
  presenterId?: string; productIds?: string[];
}
const parse = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') { try { return recordOf(JSON.parse(value)); } catch { return {}; } }
  return recordOf(value);
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const narrationSegments = (script: string) => [...script.matchAll(/\[(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*s?\]([^]*?)(?=\[\d+(?:\.\d+)?\s*[-–—]|$)/g)].map(match => ({
  start: Number(match[1]), end: Number(match[2]), text: match[3]!.match(/(?:台词|口播|旁白|对白)\s*[：:]\s*([^\n]+)/)?.[1]?.trim() || '',
}));

/** Initialize the same stable-shot workbench used by the editor; never flatten clone into catalog slides. */
export function buildReplicationWorkbenchSpec(input: ReplicationWorkbenchInput): Record<string, unknown> {
  const referenceTenant = String(input.reference.tenantId || input.reference.tenant_id || '');
  if (!input.tenantId || !input.projectId || referenceTenant !== input.tenantId) throw Error('复刻参考视频不属于当前企业');
  const analysis = parse(input.reference.aiAnalysis);
  if (analysis.analysisMode !== 'exact' || !['video', 'video_review_required'].includes(String(analysis.analysisQuality))) throw Error('复刻需要全片精确视频分析');
  const referenceId = String(input.reference.id || '');
  if (!referenceId) throw Error('复刻参考视频标识缺失');
  // Legacy exact records used shots instead of scriptDetails15s.
  const gemini = parse(analysis.gemini);
  const rawDetails = (Array.isArray(gemini.scriptDetails15s) ? gemini.scriptDetails15s : Array.isArray(gemini.shots) ? gemini.shots : []).map(item => ({ ...recordOf(item) }));
  const ranges = rawDetails.map(row => benchmarkTimeRange(row.time || row.timestamp));
  const cuts = Array.isArray(gemini.detectedSceneCuts) ? gemini.detectedSceneCuts.map(Number) : [];
  const mediaDuration = Number(input.reference.duration);
  const last = ranges.at(-1);
  const terminalBoundaryCorrected = Boolean(last && last.end > mediaDuration && last.start < mediaDuration
    && cuts.length === rawDetails.length - 1
    && ranges.every((range, index) => range && (index === 0 ? range.start <= 0.35 : Math.abs(range.start - cuts[index - 1]!) < 0.05)
      && (index === ranges.length - 1 || Math.abs(range.end - cuts[index]!) < 0.05)));
  if (terminalBoundaryCorrected) rawDetails[rawDetails.length - 1]!.time = `${last!.start}-${mediaDuration}s`;
  const normalized = buildBenchmarkAnalysis({ videoId: referenceId, duration: Number(input.reference.duration), analysis: {
    ...analysis, gemini: { ...gemini, scriptDetails15s: rawDetails },
  } });
  if (!normalized.timelineComplete) throw Error('复刻逐镜时间线不完整，不能生成完整成片');
  if (normalized.shots.some(shot => shot.materialType === 'unknown' || shot.granularity !== 'shot' || !shot.visual.trim())) throw Error('复刻镜头类型或物理镜头边界不完整');
  const revision = hash(normalized.shots);
  const prior = recordOf(input.spec.automatedReplicationPlan);
  if (prior.version === 1) {
    if (prior.referenceId !== referenceId || prior.referenceRevision !== revision) throw Error('复刻参考分析已变化，请创建新制作版本，不能覆盖已有供应商任务');
    return input.spec;
  }
  const assemblyId = 'video-1';
  const ratio = String(input.spec.ratio || '9:16');
  const productIds = input.productIds || (Array.isArray(input.spec.selectedProductIds) ? input.spec.selectedProductIds.map(String) : []);
  const order = recordOf(input.spec.contentOrder);
  const scripts = recordOf(order.scripts);
  const frozen = recordOf(scripts[String(input.spec.lang || 'en')]);
  const frozenBody = frozen.status === 'confirmed' && frozen.generatedBy === 'director_agent' && frozen.hash === hash(frozen.body) ? String(frozen.body || '') : '';
  if (Object.keys(scripts).length && !frozenBody) throw Error('编导冻结脚本合同校验失败');
  if (frozenBody && input.spec.script && input.spec.script !== frozenBody) throw Error('工作台脚本与编导冻结合同不一致');
  const script = frozenBody || String(input.spec.script || '');
  if (!script) throw Error('逐镜复刻缺少编导冻结脚本');
  const narration = narrationSegments(script);
  const slots: Array<Record<string, unknown>> = [];
  const productions: Record<string, unknown> = {};
  const sourcePlans: Record<string, unknown> = {};
  const automatedShots: AutomatedReplicationShot[] = [];
  const details: Array<Record<string, unknown>> = [];
  for (const shot of normalized.shots) {
    const start = shot.start!, end = shot.end!;
    const slotId = `slot-${shot.index}`;
    const shotId = `replication-${hash([input.projectId, referenceId, shot.index]).slice(0, 24)}`;
    const raw = rawDetails[shot.index - 1]!;
    const role = String(raw.observedPresenterRole || '');
    const foregroundPerson = /女性|男性|女人|男人|女士|男士|主播|主持人|presenter/i.test(shot.visual)
      && !/背景.{0,8}(女性|男性|人物)|工人背影|人群|路人/.test(shot.visual);
    const person = ['sales_presenter', 'presenter_action'].includes(role) || shot.materialType === 'talking_head'
      || (role === 'unknown' && foregroundPerson);
    if (person && !input.presenterId) throw Error('人物复刻需要已授权企业数字人');
    const detail = `镜头功能：${shot.purpose}\n画面：${shot.visual}\n环境：${shot.environment}\n景别：${shot.framing}\n运镜：${shot.camera}`;
    const targetText = narration.filter(segment => segment.start < end && segment.end > start).map(segment => {
      // A frozen narration line spanning several reference beats is partitioned, never repeated per shot.
      const tokens = /\s/.test(segment.text) ? segment.text.split(/\s+/) : Array.from(segment.text);
      const length = segment.end - segment.start;
      const from = Math.round(Math.max(0, start - segment.start) / length * tokens.length);
      const to = Math.round(Math.min(length, end - segment.start) / length * tokens.length);
      return tokens.slice(from, to).join(/\s/.test(segment.text) ? ' ' : '');
    }).filter(Boolean).join('\n');
    const production = newShotProduction(targetText, person ? input.presenterId : '');
    if (person) {
      if (!targetText) throw Error(`第 ${shot.index} 镜缺少企业目标台词，禁止直接复用原片商业口播`);
      production.source = 'avatar'; production.sound = 'source';
      production.digitalHuman = { workflow: 'viral_replication', method: 'reenact', replicationMode: 'sentence_first_frame',
        preferredProvider: 'auto', contentConfirmed: false, action: shot.visual, scene: shot.environment, preserve: '企业人物身份、企业产品身份、参考动作和节奏',
        reference: { videoUrl: `/api/overseas/videos/${encodeURIComponent(referenceId)}/media-url`, start, end, originalText: shot.dialogue,
          derivativeAuthorized: false, cues: [{ id: `${shotId}:cue`, start, end, originalText: shot.dialogue, targetText,
            shotIds: [slotId], personShot: true, classificationSource: 'analysis', sourceFirstFrame: {time: start},
            generationDurationSeconds: Math.max(4, end - start), outputDurationSeconds: end - start,
            composition: { presenterKey: input.presenterId!, shotSize: shot.framing, cameraAngle: shot.camera, background: shot.environment, actionIntent: shot.visual } }] } };
    }
    slots.push({ id: shotId, slotId, detail, duration: end - start, requirements: JSON.stringify({ detail, start, end, ratio, productIds }),
      observedPresenterRole: person ? 'sales_presenter' : 'none', salesPresenterConfirmed: false });
    productions[`${assemblyId}:${shotId}`] = production;
    const sceneType = shot.materialType === 'product' ? 'product'
      : shot.materialType === 'factory' ? 'factory'
      : shot.materialType === 'consumer_demo' ? 'usage'
      : 'general';
    sourcePlans[slotId] = { mode: person ? 'digital_human' : 'ai', sceneType, productIds,
      confirmed: false, decided: true, videoResolution: '480p', videoResolutionPinned: true };
    const sourceFirstFrameUrl = `/api/overseas/videos/${encodeURIComponent(referenceId)}/shot/${shot.index}/first-frame`;
    details.push({ ...shot, shotId: slotId, firstFrameRef: sourceFirstFrameUrl, observedPresenterRole: person ? 'sales_presenter' : 'none' });
    automatedShots.push({ shotId, slotId, kind: person ? 'person' : 'nonperson', start, end,
      ...(!person ? { firstFrameRequest: { projectId: input.projectId, shotId, requestId: `auto-frame-${hash([input.projectId, revision, shot.index]).slice(0, 32)}`,
        mode: 'replication', sceneType, shotDescription: detail,
        startSeconds: start, endSeconds: end, ratio, productIds, sourceFirstFrameUrl } } : {}) });
  }
  return { ...input.spec, mode: 'clone', contentMode: 'video', creationPath: 'viral_replication', manualWorkflow: false,
    activeAssemblyId: assemblyId, assemblyName: '视频1', ratio, script, selectedProductIds: productIds,
    shootingSlots: slots, shotProductions: productions, shotProductionContext: `automated-replication:${revision}`, automatedReplicationShots: automatedShots,
    storyboardAssignments: {}, storyboardSourcePlans: sourcePlans, selected: [],
    storyboardAssemblies: [{ id: assemblyId, name: '视频1', assignments: {}, sourcePlans, selected: [] }],
    videoKickoff: { ...recordOf(input.spec.videoKickoff), source: 'inspiration', video: { ...input.reference, referenceRecordId: referenceId, videoUrl: `/api/overseas/videos/${encodeURIComponent(referenceId)}/media-url`, aiAnalysis: analysis }, referenceAnalysis: { details } },
    automatedReplicationPlan: { version: 1, referenceId, referenceRevision: revision, tenantId: input.tenantId, ...(terminalBoundaryCorrected ? { terminalBoundaryCorrection: { source: 'media_duration_and_detected_scene_cuts', originalEnd: last!.end, effectiveEnd: mediaDuration } } : {}) },
  };
}
