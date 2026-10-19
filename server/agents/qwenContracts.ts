import type { VideoAiAnalysis } from '../types/index.js';

export interface QwenAsrSegment { start: number; end: number; text: string; confidence?: number }

export interface QwenTimelineBoundary {
  id: string;
  start: number;
  end: number;
  reason: string;
  evidence: string;
}

export interface QwenTimelinePlan {
  theme: string;
  identityEntities: NonNullable<VideoAiAnalysis['identityEntities']>;
  hooks: string[];
  sellingPoints: string[];
  mood: string;
  structure: string;
  baseRequirements: string;
  firstTenSeconds: NonNullable<VideoAiAnalysis['firstTenSeconds']>;
  coarseStructure: NonNullable<VideoAiAnalysis['coarseStructure']>;
  scriptSummary15s: NonNullable<VideoAiAnalysis['scriptSummary15s']>;
  recommendedScriptType: 'voiceover' | 'storyboard';
  boundaries: QwenTimelineBoundary[];
}

export interface ImagePostEvidenceAnalysis {
  version: 2;
  status: 'analyzed';
  observedFacts: Array<{ imageIndex: number; subjects: string[]; scene: string; composition: string; colors: string[]; visibleText: string[]; confidence: number }>;
  carouselFlow: Array<{ imageIndex: number; role: 'attention' | 'product' | 'detail' | 'proof' | 'process' | 'cta' | 'unknown'; evidence: string; confidence: number }>;
  copyEvidence: { hooks: Array<{ text: string; source: 'caption' | 'ocr'; evidence: string }>; sellingPoints: Array<{ text: string; source: 'caption' | 'ocr'; evidence: string }>; cta: string[] };
  reusableModules: Array<{ module: string; evidence: string; preserve: string; replace: string; confidence: number }>;
  uncertainties: string[];
}

export function normalizeQwenQualityScore(value: unknown): number {
  const score = Number(value);
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.max(0, Math.min(100, score <= 10 ? score * 10 : score));
}

export function storyboardQaProviderFallbackEligible(error: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.GEMINI_API_KEY?.trim()) return false;
  const record = error && typeof error === 'object' ? error as Record<string, any> : {};
  const code = String(record.code || record.type || record.error?.code || record.error?.type || '').trim();
  const message = error instanceof Error ? error.message : String(error || '');
  return ['Arrearage', 'InvalidApiKey', 'AccessDenied', 'Forbidden'].includes(code)
    || /overdue-payment|account is in good standing|arrearage|free quota exhausted|use free tier only|invalid api key|access denied/i.test(message);
}
