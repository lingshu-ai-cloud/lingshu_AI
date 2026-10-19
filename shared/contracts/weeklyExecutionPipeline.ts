import type {WeeklyOperatingPackage,WeeklyAgentPlanningState} from './socialProgram';
export interface WeeklyPipelineBlocker{code:string;message:string;action:'authority'|'capacity'|'analysis'|'confirmation'|'runtime'|'scope'}
export interface WeeklyPipelineStatus{
 scope:{programId:string;packageId:string;packageVersion:number};
 programVersion:number;planningVersion:number;packageStatus:WeeklyOperatingPackage['status'];planningStatus:WeeklyAgentPlanningState['status']|null;
 worker:{started:boolean;configuredEnabled:boolean;state:string;dataAuthority?:'local';lastScanStartedAt?:string|null;lastScanFinishedAt?:string|null;lastResult?:{claimed:number;succeeded:number;pending:number;blocked:number;failed:number;projectionFailed?:number}|null;lastErrorCode?:string|null};
 taskCounts:Record<string,number>;blockers:WeeklyPipelineBlocker[];canStart:boolean;started:boolean;
 executionPhase?:'not_started'|'independent_branches'|'full';
 independentAdmission?:{admittedAt:string;authorizePublishing:false;authorizeMessaging:false}|null;
}
export interface WeeklyPipelineStartInput{expectedPackageVersion:number;expectedPlanningVersion:number;expectedProgramVersion:number;selectedSlotIds:string[];authorizePublishing:false}
