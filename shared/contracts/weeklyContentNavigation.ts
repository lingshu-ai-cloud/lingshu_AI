import type {VersionedSocialRef} from './socialProgram.js';
export interface WeeklyContentNavigationScope {tenantId:string;programId:string;packageId:string;packageVersion:number;executionTaskId:string}
export interface WeeklyContentNavigation {scope:WeeklyContentNavigationScope;publicationTaskId:string;contentTaskId:string;runId:string;artifactRef:VersionedSocialRef|null;bindingKey:string;source:'production_binding'|'completed_artifact';gaps:string[]}
