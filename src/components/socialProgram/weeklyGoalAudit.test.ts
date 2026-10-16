import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {WeeklyOperatingPackage,WeeklyExecutionTask} from '../../../shared/contracts/socialProgram';
import {buildWeeklyGoalAudit} from './weeklyGoalAudit';
const pkg={programId:'p',packageId:'w',version:3,weekStart:'2026-10-12',weekEnd:'2026-10-18',objective:'真实经营目标',successCriteria:['获得有效询盘'],socialContentPackage:{publicationTasks:[{publicationTaskId:'pub',accountId:'a',status:'planned',publishWindow:'2026-10-12T18:00:00+08:00'}]}} as WeeklyOperatingPackage;
const task=(step:string,refs:WeeklyExecutionTask['resultRefs']=[]):WeeklyExecutionTask=>({tenantId:'t',programId:'p',packageId:'w',packageVersion:3,taskId:step,publicationTaskId:'pub',status:'succeeded',schedule:{stepKind:step},resultRefs:refs,ownBlockingReasons:[],inheritedBlockingTaskIds:[],lastError:null} as unknown as WeeklyExecutionTask);
test('goal checklist counts exact current-version delivery receipts, never claims free-text objectives achieved',()=>{
 const rows=[task('video_generation',[{type:'starter_social_content_artifact',id:'film',version:1}]),task('user_approval'),task('publishing',[{type:'weekly_publication_attempt',id:'receipt',version:1}]),task('performance_monitoring'),{...task('user_approval',[{type:'user_content_approval',id:'old',version:1}]),packageVersion:2}];
 const result=buildWeeklyGoalAudit(pkg,rows);
 assert.equal(result.planned,1);assert.equal(result.video,1);assert.equal(result.accepted,0);assert.equal(result.published,1);assert.equal(result.metrics,0);assert.equal(result.criteria[0]!.verdict,'待按真实证据人工核对');
 assert.throws(()=>buildWeeklyGoalAudit(pkg,[rows[0]!,{...rows[0]!,tenantId:'foreign',taskId:'foreign'}]));
});
