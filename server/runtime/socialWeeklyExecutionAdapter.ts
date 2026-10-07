import type { VersionedSocialRef, WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
export type WeeklyExecutionAdapterResult =
  | { status: 'succeeded'; resultRefs: VersionedSocialRef[] }
  | { status: 'pending'; code: string; message: string; retryDelayMs?: number }
  | { status: 'blocked'; code: string; message: string };
export interface SocialWeeklyExecutionAdapter {
  execute(task: WeeklyExecutionTask): Promise<WeeklyExecutionAdapterResult>;
}
