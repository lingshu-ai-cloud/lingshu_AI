export type SocialContentQueueRecovery = {
  action: 'retry_failed_native_voice'; failedOperationId: string; canRequest: boolean; reason: string;
} | {
  action: 'resume_existing_execution'; canRequest: boolean; reason: string;
};

/** Safe durable-queue state shared by list and inspection; never a retry grant. */
export interface SocialContentExecutionSummary {
  id: string;
  status: string;
  attempt: number;
  nextAttemptAt: string | null;
  label: string;
  tone: 'default' | 'warning' | 'processing' | 'success';
  failureCode: string | null;
  reason: string | null;
  requiresReconciliation: boolean;
  recovery?: SocialContentQueueRecovery;
}

/** Read projection only. The existing start command remains the admission authority. */
export interface SocialContentQueueInspection {
  taskId: string;
  version: string;
  runId: string | null;
  canRequestStart: boolean;
  /** Read-only eligibility hint; the recovery command revalidates canonical evidence. */
  recovery?: SocialContentQueueRecovery;
  budgetPreflight?: { state: 'required'; advisoryEstimatedCostCny: number; maximumCny: number | null; advisoryExceeded: boolean };
  runtime: { mode: 'preview' | 'execution'; queueConfigured: boolean };
  job: SocialContentExecutionSummary | null;
  issues: Array<{ code: string; message: string; sceneIds: string[]; assetIds: string[] }>;
  /** Rejected alternatives are diagnostic notes, never a demand to clear the whole library. */
  candidateNotes: SocialContentQueueInspection['issues'];
  scenes: Array<{ sceneId: string; materialType: string; illustrative?: boolean; recommendedCandidates: number; reasons: string[] }>;
}
