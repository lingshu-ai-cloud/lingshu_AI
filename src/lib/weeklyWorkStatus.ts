import type { DigitalEmployeeOverview } from './digitalEmployees';
import { weeklyWorkStatus as project } from '../../shared/weekly-work-status.mjs';
export type { WeeklyWorkPhase, WeeklyWorkOutcome, WeeklyWorkStatus } from '../../shared/weekly-work-status.mjs';
export function weeklyWorkStatus(data: DigitalEmployeeOverview) { return project(data); }
