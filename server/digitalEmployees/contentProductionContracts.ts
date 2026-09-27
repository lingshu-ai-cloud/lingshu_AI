import type { MaterialScriptAnalysis } from '../../shared/materialScriptAnalysis.js';
import type { VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';
import type { DirectorScriptContract } from '../../src/lib/directorScript.js';

export type ContentProductionRoute = 'clone' | 'product' | 'material';
export type ProductionStage = 'script' | 'material_match' | 'voice_subtitles' | 'heygen' | 'render' | 'quality' | 'completed' | 'blocked';
export type StoredRecord = { id: string; [key: string]: unknown };

export type AssetCandidate = {
  id: string; name: string; type: 'video' | 'image'; url?: string; localPath?: string;
  objectKey?: string; cloudRecordId?: string; duration: number; observations: string[];
  productId?: string; productName?: string; visualObservations: string[];
  segments?: Array<Record<string, unknown>>; scriptAnalysis?: MaterialScriptAnalysis;
  authorization: { status: 'owned' | 'licensed' | 'unknown'; scope: 'tenant' | 'shared'; evidence: string };
  synthetic: boolean; aspectRatio?: string; width?: number; height?: number; focusX?: number; focusY?: number;
  tags: string[]; source: 'enterprise_product' | 'tenant_material' | 'licensed_shared_material';
};

export interface SceneSourcePlanItem {
  sceneIndex: number; start: number; end: number; intent: string; assetId: string; productId?: string;
  score: number; sourceStart?: number; sourceEnd?: number; evidenceSegmentId?: string;
  observations?: string[]; reasons: string[];
}

export interface RouteSourcePlan {
  route: ContentProductionRoute; productId?: string; productName?: string; assetIds: string[];
  seedAssetId?: string; referenceAnalysisId?: string; platform: string; platformBrief: string; gap?: string;
}

export interface ContentProductionOrderInput extends Partial<DirectorScriptContract> {
  videoPlan?: VideoCreationPlan; languages?: string[]; id: string; route: ContentProductionRoute;
  platform: string; productId: string; productName: string;
  evidenceRefs: Array<{ type: 'exact_analysis' | 'enterprise_material'; id: string }>;
  theme?: { key: string; label: string }; cta?: string; constraints?: string[];
  sourceContentOrderId?: string; masterContentOrderId?: string; masterLanguage?: string;
}

export interface ContentRouteEvidence { exactAnalysisIds: string[]; productNames: string[]; assetIds: string[] }
export interface ContentRoutePlan {
  allocations: ContentProductionRoute[]; eligibleRoutes: ContentProductionRoute[];
  blockers: string[]; evidence: ContentRouteEvidence;
}
export interface ContentProductionAdvanceResult {
  changed: boolean; ready: boolean;
  projectRefs: Array<{ type: 'studio_project'; id: string; route: ContentProductionRoute; language?: string; status: string; stage: string; outputPath?: string }>;
  knowledgeGaps: Array<{ type: 'knowledge_gap'; key: string; label: string; destination: string; purpose: string }>;
  blocker: string; summary: string;
}
