import type {WeeklyOwnedProductIdentityAssessment} from './weeklyOwnedProductIdentity.js';
export interface WeeklyOwnedProductIdentityCandidate {requirementId:string;recordId:string;sha256:string;name:string;previewUrl:string|null;sourceRef:string;sourceVersion:string;alreadyBound:boolean}
export interface WeeklyOwnedProductIdentityRead {assessment:WeeklyOwnedProductIdentityAssessment;expectedRunId:string|null;readOnly:boolean;candidates:WeeklyOwnedProductIdentityCandidate[];candidateGaps:string[]}
