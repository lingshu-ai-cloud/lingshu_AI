export type MaterialScriptRole = 'hook' | 'demonstration' | 'proof' | 'explanation' | 'transition' | 'closing' | 'support';

export interface MaterialScriptShot {
  segmentId: string;
  startSeconds: number;
  endSeconds: number;
  role: MaterialScriptRole;
  instruction: string;
  observedEvidence: string[];
  matchTags: string[];
  confidence: number;
  needsReview: boolean;
}

/**
 * A reusable, truth-preserving script view of a material. It describes what a
 * verified shot can do in a script; it never invents product claims or changes
 * the uploaded pixels.
 */
export interface MaterialScriptAnalysis {
  schemaVersion: 'material-script-analysis.v1';
  status: 'ready';
  sourceRevision: string;
  summary: string;
  hookCapability: {
    score: number;
    reasons: string[];
  };
  functions: string[];
  searchableText: string;
  shots: MaterialScriptShot[];
  truthBoundary: string;
  analyzedAt: string;
}

type SegmentLike = Record<string, unknown>;

function text(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function strings(value: unknown, max = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => text(item, 120)).filter(Boolean).slice(0, max);
}

function unique(values: string[], max = 40): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, max);
}

function roleFor(segment: SegmentLike, index: number, count: number): MaterialScriptRole {
  const source = [
    ...strings(segment.recommendedFunctions),
    text(segment.action), text(segment.observedFacts), text(segment.ocrText),
  ].join(' ').toLowerCase();
  if (/钩子|hook|开场|吸引|悬念|冲突/.test(source) || index === 0) return 'hook';
  if (/演示|使用|操作|demo|过程|步骤/.test(source)) return 'demonstration';
  if (/证明|证据|细节|特写|质检|工厂|proof/.test(source)) return 'proof';
  if (/讲解|解释|说明|卖点|explain/.test(source)) return 'explanation';
  if (/转场|过渡|transition/.test(source)) return 'transition';
  if (/收尾|结尾|行动|call.to.action|cta/.test(source) || index === count - 1) return 'closing';
  return 'support';
}

function instructionFor(role: MaterialScriptRole, evidence: string[]): string {
  const visible = evidence[0] || '已确认可见画面';
  const instructions: Record<MaterialScriptRole, string> = {
    hook: `可作为前三秒开场，用“${visible}”直接建立注意力；文案必须另写，不能把未出现的信息说成画面事实。`,
    demonstration: `可用于使用或操作演示，剪辑时保留“${visible}”对应的真实动作。`,
    proof: `可作为可见证据镜头，只能证明画面里实际出现的“${visible}”。`,
    explanation: `可承接讲解段落，用“${visible}”配合已核实的旁白信息。`,
    transition: `可作为节奏和场景过渡，不承担未经核实的产品证明。`,
    closing: `可作为收尾画面；行动号召与承诺仍须来自已核实的企业信息。`,
    support: `可作为辅助画面使用，脚本匹配以“${visible}”为边界。`,
  };
  return instructions[role];
}

export function buildMaterialScriptAnalysis(input: {
  materialId: string;
  name: string;
  sourceRevision: string;
  duration: number;
  segments?: SegmentLike[];
  visualObservations?: string[];
  analyzedAt?: string;
}): MaterialScriptAnalysis {
  const sourceSegments = Array.isArray(input.segments) ? input.segments : [];
  const fallbackEvidence = unique((input.visualObservations || []).map(value => text(value)).filter(Boolean));
  const normalizedSegments = sourceSegments.length ? sourceSegments : [{
    id: `${input.materialId}-whole`, start: 0, end: Math.max(0, input.duration),
    observedFacts: fallbackEvidence,
  }];
  const shots = normalizedSegments.map((segment, index): MaterialScriptShot => {
    const role = roleFor(segment, index, normalizedSegments.length);
    const evidence = unique([
      ...strings(segment.observedFacts),
      text(segment.action), text(segment.environment),
      ...strings(segment.subject), text(segment.shot), text(segment.camera),
      text(segment.ocrText),
      ...(sourceSegments.length ? [] : fallbackEvidence),
    ]);
    const functions = strings(segment.recommendedFunctions);
    const start = Math.max(0, Number(segment.start || 0));
    const end = Math.max(start, Number(segment.end ?? input.duration ?? start));
    const confidence = Math.max(0, Math.min(1, Number(segment.confidence ?? 0.7)));
    return {
      segmentId: text(segment.id, 160) || `${input.materialId}-segment-${index + 1}`,
      startSeconds: Number(start.toFixed(2)),
      endSeconds: Number(end.toFixed(2)),
      role,
      instruction: instructionFor(role, evidence),
      observedEvidence: evidence,
      matchTags: unique([role, ...functions, ...evidence]),
      confidence,
      needsReview: Boolean(segment.needsReview) || confidence < 0.65,
    };
  });
  const functions = unique(shots.flatMap(shot => [shot.role, ...shot.matchTags.slice(0, 6)]));
  const first = shots[0];
  const hookScore = Math.max(0, Math.min(100, Math.round(
    (first?.observedEvidence.length ? 35 : 0)
    + (first?.confidence || 0) * 35
    + (first?.role === 'hook' ? 20 : 0)
    + (first && first.endSeconds - first.startSeconds <= 3.5 ? 10 : 0),
  )));
  const hookReasons = unique([
    first?.observedEvidence.length ? '前三秒存在可描述的真实画面' : '前三秒缺少明确视觉证据',
    first?.role === 'hook' ? '首段具备开场钩子功能' : '首段需要通过剪辑或文案补强钩子',
    first?.needsReview ? '首段仍需人工复核' : '首段识别置信度可用',
  ]);
  const searchableText = unique([
    input.name,
    ...shots.flatMap(shot => [shot.role, ...shot.matchTags, ...shot.observedEvidence]),
  ], 120).join(' ').slice(0, 8_000);
  return {
    schemaVersion: 'material-script-analysis.v1',
    status: 'ready',
    sourceRevision: input.sourceRevision,
    summary: `已将${shots.length}个真实画面区间整理为可匹配的脚本镜头；前三秒钩子能力 ${hookScore}/100。`,
    hookCapability: { score: hookScore, reasons: hookReasons },
    functions,
    searchableText,
    shots,
    truthBoundary: '分析只描述原素材中可见、可确认的内容；不会改写客户原片，也不会生成未核实的产品功效、工厂或人物事实。',
    analyzedAt: input.analyzedAt || new Date().toISOString(),
  };
}

export function reusableMaterialScriptAnalysis(value: unknown, sourceRevision: string): MaterialScriptAnalysis | null {
  if (!value || typeof value !== 'object') return null;
  const analysis = value as Partial<MaterialScriptAnalysis>;
  return analysis.schemaVersion === 'material-script-analysis.v1'
    && analysis.status === 'ready'
    && analysis.sourceRevision === sourceRevision
    && Array.isArray(analysis.shots)
    ? analysis as MaterialScriptAnalysis
    : null;
}
