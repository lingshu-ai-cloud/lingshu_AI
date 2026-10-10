import type {WeeklyScheduleTargetGraph} from './socialWeeklyScheduleRevision.js';
export interface WeeklyInitialSchedulePreview {
 graph:WeeklyScheduleTargetGraph;
 authority:'estimated_task_durations_only';
 requiredInputs:Array<{taskId:string;estimatedMinutes:number;suggestedStartAt:string|null;suggestedFinishAt:string|null;missing:readonly ['remainingMinutes','remainingCostCny','bufferMinutes','resourceKey','availableAt','resourceWorkingWindows']}>;
}
