/**
 * Provider-neutral contract for the Seedream + Seedance viral-replication path.
 *
 * Source timing is evidence from the reference video. Timeline timing is derived
 * from generated media and may move without changing the semantic identity.
 */
export interface Pipeline3SemanticAnchor {
  id: string;
  order: number;
  sourceStart: number;
  sourceEnd: number;
  start: number;
  end: number;
  originalText: string;
  targetText: string;
  shotIds: string[];
  personShot: boolean;
  generatedMaterialId?: string;
  measuredDuration?: number;
}

export type Pipeline3NodeKind =
  | 'seedream_first_frame'
  | 'seedance_a_roll'
  | 'caption'
  | 'b_roll'
  | 'effect'
  | 'audio';

export interface Pipeline3BuildNode {
  id: string;
  anchorId: string;
  kind: Pipeline3NodeKind;
  /** Stable digest of every user/model input that affects this node. */
  inputFingerprint: string;
  dependsOn?: string[];
}

export interface Pipeline3NodeCandidate {
  id: string;
  nodeId: string;
  materialId: string;
  inputFingerprint: string;
  /** Candidate IDs selected for dependencies when this artifact was built. */
  dependencyCandidates?: Record<string, string>;
  state: 'ready' | 'failed';
  measuredDuration?: number;
  createdAt: string;
}

export interface Pipeline3BuildDecision {
  nodeId: string;
  action: 'reuse' | 'generate';
  candidateId?: string;
  reason: 'matching_candidate' | 'input_changed' | 'dependency_changed' | 'missing_candidate';
}

const millis = (value: number) => Math.round(value * 1_000) / 1_000;

export function createPipeline3SemanticTimeline(input: Array<{
  id: string;
  start: number;
  end: number;
  originalText: string;
  targetText: string;
  shotIds: string[];
  personShot?: boolean;
}>): Pipeline3SemanticAnchor[] {
  return input
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
    .map((cue, order) => ({
      id: cue.id,
      order,
      sourceStart: millis(cue.start),
      sourceEnd: millis(cue.end),
      start: millis(cue.start),
      end: millis(cue.end),
      originalText: cue.originalText,
      targetText: cue.targetText,
      shotIds: [...cue.shotIds],
      personShot: cue.personShot !== false,
    }));
}

/** Reflows all later anchors after generated media reports its actual duration. */
export function applyPipeline3MeasuredDuration(
  timeline: Pipeline3SemanticAnchor[],
  anchorId: string,
  materialId: string,
  measuredDuration: number,
): Pipeline3SemanticAnchor[] {
  if (!Number.isFinite(measuredDuration) || measuredDuration <= 0) {
    throw new Error('管线3生成素材的实测时长必须大于 0');
  }
  const ordered = timeline.slice().sort((a, b) => a.order - b.order);
  if (!ordered.some(anchor => anchor.id === anchorId)) throw new Error(`管线3语义锚点不存在: ${anchorId}`);
  let cursor = ordered[0]?.start ?? 0;
  return ordered.map(anchor => {
    const selected = anchor.id === anchorId
      ? { ...anchor, generatedMaterialId: materialId, measuredDuration: millis(measuredDuration) }
      : anchor;
    const fallbackDuration = Math.max(0.001, selected.end - selected.start);
    const duration = selected.measuredDuration ?? fallbackDuration;
    const next = { ...selected, start: millis(cursor), end: millis(cursor + duration) };
    cursor = next.end;
    return next;
  });
}

/**
 * Chooses reusable candidates in dependency order. A candidate is reusable only
 * when both its own inputs and the exact selected dependency artifacts match.
 */
export function planPipeline3Build(
  nodes: Pipeline3BuildNode[],
  candidates: Pipeline3NodeCandidate[],
): Pipeline3BuildDecision[] {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const visiting = new Set<string>();
  const decisions = new Map<string, Pipeline3BuildDecision>();

  const decide = (node: Pipeline3BuildNode): Pipeline3BuildDecision => {
    const known = decisions.get(node.id);
    if (known) return known;
    if (visiting.has(node.id)) throw new Error(`管线3生成图存在循环依赖: ${node.id}`);
    visiting.add(node.id);
    const dependencies = (node.dependsOn ?? []).map(id => {
      const dependency = nodeById.get(id);
      if (!dependency) throw new Error(`管线3节点 ${node.id} 缺少依赖 ${id}`);
      return decide(dependency);
    });
    const ready = candidates
      .filter(candidate => candidate.nodeId === node.id && candidate.state === 'ready' && candidate.materialId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const exactInput = ready.filter(candidate => candidate.inputFingerprint === node.inputFingerprint);
    const reusable = exactInput.find(candidate => dependencies.every(dependency =>
      dependency.action === 'reuse'
      && candidate.dependencyCandidates?.[dependency.nodeId] === dependency.candidateId));
    let decision: Pipeline3BuildDecision;
    if (reusable) decision = { nodeId: node.id, action: 'reuse', candidateId: reusable.id, reason: 'matching_candidate' };
    else if (!ready.length) decision = { nodeId: node.id, action: 'generate', reason: 'missing_candidate' };
    else if (!exactInput.length) decision = { nodeId: node.id, action: 'generate', reason: 'input_changed' };
    else decision = { nodeId: node.id, action: 'generate', reason: 'dependency_changed' };
    visiting.delete(node.id);
    decisions.set(node.id, decision);
    return decision;
  };

  nodes.forEach(decide);
  return nodes.map(node => decisions.get(node.id)!);
}
