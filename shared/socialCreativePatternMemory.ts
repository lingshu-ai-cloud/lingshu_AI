import type {
  SocialCreativePatternMemory,
  SocialProductionResult,
  SocialReferenceVideoAnalysis,
  SocialShotFunction,
} from './contracts/socialContentWorkflow';

export interface SocialPatternEvidenceSample {
  analysis: SocialReferenceVideoAnalysis;
  industry: string;
  emotionTags?: string[];
  failureConditions?: string[];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function mostFrequentOrder(samples: SocialPatternEvidenceSample[]): SocialShotFunction[] {
  const orders = samples.map(sample => sample.analysis.shots.map(shot => shot.purpose));
  const counts = new Map<string, number>();
  orders.forEach(order => counts.set(order.join('>'), (counts.get(order.join('>')) ?? 0) + 1));
  const winner = [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0]))[0]?.[0] ?? '';
  return winner.split('>').filter(Boolean) as SocialShotFunction[];
}

/**
 * Builds memory only when multiple independent references and real production
 * results support it. A single reference can never become a reusable rule.
 */
export function buildSocialCreativePatternMemory(input: {
  samples: SocialPatternEvidenceSample[];
  productionResults: SocialProductionResult[];
  now?: Date;
}): SocialCreativePatternMemory | null {
  const samples = input.samples.filter(sample => sample.analysis.status === 'ready');
  const analysisIds = unique(samples.map(sample => sample.analysis.analysisId));
  const productionResultIds = unique(input.productionResults
    .filter(result => result.creativeReview.approved)
    .map(result => result.productionResultId));
  if (analysisIds.length < 2 || productionResultIds.length < 1) return null;

  const revealOrder = mostFrequentOrder(samples);
  const evidencePositions = unique(samples.flatMap(sample => sample.analysis.shots
    .map((shot, index) => shot.purpose === 'proof' || shot.purpose === 'trust' ? index + 1 : 0)
    .filter(Boolean))).sort((left, right) => left - right);
  const ctaPositions = unique(samples.flatMap(sample => sample.analysis.shots
    .map((shot, index) => shot.purpose === 'call_to_action' ? index + 1 : 0)
    .filter(Boolean))).sort((left, right) => left - right);
  const updatedAt = (input.now ?? new Date()).toISOString();
  const identity = { analysisIds, productionResultIds, revealOrder };
  return {
    patternMemoryId: `creative_pattern_${stableHash(JSON.stringify(identity))}`,
    version: `${updatedAt}:${stableHash(JSON.stringify(identity))}`,
    status: productionResultIds.length >= 2 ? 'validated' : 'candidate',
    evidenceAnalysisIds: analysisIds,
    productionResultIds,
    hookTypes: unique(samples.map(sample => sample.analysis.hookAnalysis?.mechanism ?? '').filter(Boolean)),
    revealOrder,
    evidencePositions,
    rhythm: unique(samples.flatMap(sample => sample.analysis.shots.map(shot => shot.rhythmDescription)).filter(Boolean)),
    emotionChanges: unique(samples.flatMap(sample => sample.emotionTags ?? [])),
    ctaPositions,
    applicableIndustries: unique(samples.map(sample => sample.industry).filter(Boolean)),
    failureConditions: unique(samples.flatMap(sample => sample.failureConditions ?? [])),
    confidence: Math.min(0.95, +(0.45 + analysisIds.length * 0.08 + productionResultIds.length * 0.12).toFixed(2)),
    createdBy: 'system_learning',
    updatedAt,
  };
}
