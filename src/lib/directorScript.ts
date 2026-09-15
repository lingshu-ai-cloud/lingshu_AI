export interface FrozenDirectorScript {
  version: number;
  body: string;
  hash: string;
  language: string;
  status: 'confirmed';
  generatedBy: 'director_agent';
  generatedAt: string;
  source: 'llm' | 'deterministic_closed_world_fallback';
  degradedReason: string;
}

export interface DirectorScriptContract {
  contractVersion: 1;
  scripts: Record<string, FrozenDirectorScript>;
  operatingContext?: {
    productionBudget: number;
    productionSpent: number;
    productionReserved: number;
    estimatedContentCost: number;
    originalTarget: number;
    platformVersionTarget: number;
    publishTarget: number;
    qualityStandard: string;
    packageRevision: number;
  };
}
