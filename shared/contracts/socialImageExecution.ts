export type SocialImageExecutionReceipt = {
  jobId: string;
  status: 'queued' | 'running' | 'retry_wait' | 'reconciling' | 'blocked' | 'paused' | 'succeeded' | 'cancelled' | 'dead_letter';
  attempt: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
