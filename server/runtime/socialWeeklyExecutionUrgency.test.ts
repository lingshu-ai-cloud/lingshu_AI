import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { compareWeeklyExecutionUrgency } from './socialWeeklyExecutionWorker.js';
const task=(id:string, createdAt:string, deadline?:string)=>({taskId:id,createdAt,schedule:{latestStartAt:deadline}}) as WeeklyExecutionTask;
test('earliest prerequisite deadline precedes older less urgent work',()=>{
 const older=task('old','2026-10-01','2026-10-10T00:00:00Z');
 const urgent=task('new','2026-10-02','2026-10-05T00:00:00Z');
 assert(compareWeeklyExecutionUrgency(urgent,older)<0);
 assert(compareWeeklyExecutionUrgency(urgent,task('legacy','2026-09-01'))<0);
});
test('legacy and equal deadlines retain deterministic ordering',()=>{
 assert(compareWeeklyExecutionUrgency(task('a','2026-10-01'),task('b','2026-10-02'))<0);
 assert.equal(compareWeeklyExecutionUrgency(task('a','2026-10-01'),task('a','2026-10-01')),0);
});
