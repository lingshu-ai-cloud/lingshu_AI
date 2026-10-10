import type {WeeklyContentNavigationScope} from './weeklyContentNavigation.js';
export interface WeeklyReferenceReviewNavigation extends WeeklyContentNavigationScope {
 contentTaskId:string;recordId:string;sourceVersion:string;analysisVersion:string|null;
}
