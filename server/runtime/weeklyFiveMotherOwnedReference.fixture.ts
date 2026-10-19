import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {prepareFiveMotherDistinctReferenceSeeds} from './weeklyFiveMotherDistinctReferences.fixture.js';
import {createWeeklyPlanningAuthority} from '../socialPrograms/planningAuthority.js';
import {buildWeeklyWorkflow} from '../socialPrograms/weeklyPlanner.js';
import {createSocialOperatingRepository} from '../socialOperating/repository.js';

/** Local provider-contract evidence; historical metrics and ownership are explicit,
 * while reference media/frame verification is inherited from the real fixture. */
export async function prepareFiveMotherOwnedReferenceFixture(t:TestContext,ownedPercent:40|20){
 const setup=await prepareFiveMotherDistinctReferenceSeeds(t,{ownedPercent});
 const {f,pkg,referenceIds,ownedReferenceIds}=setup;
 pkg.planningBlockers=[];
 pkg.referenceSourcePolicy={profile:'b2b_established',allocationUnit:'mother_content',ownedPercent,externalPercent:100-ownedPercent};
 const template=structuredClone(pkg.socialContentPackage.publicationTasks[0]!);
 pkg.socialContentPackage.publicationTasks=Array.from({length:5},(_,i)=>({...structuredClone(template),publicationTaskId:`h-pub-${i+1}`,motherContentId:`h-mother-${i+1}`,publishWindow:`2026-10-${String(8+i).padStart(2,'0')}T10:00:00Z`}));
 Object.assign(pkg.socialContentPackage,{originalContentTarget:5,publicationTaskTarget:5,adaptationVersionTarget:0});
 const goal=await createSocialOperatingRepository(f.store).getGoal('t','p',pkg.businessContentGoalRef!.id,pkg.businessContentGoalRef!.version);assert.ok(goal);const workflow=buildWeeklyWorkflow({packageId:pkg.packageId,version:pkg.version,businessGoal:goal,capacity:null,automationPolicy:null,publicationTasks:pkg.socialContentPackage.publicationTasks,discoveryBudgetCny:pkg.discoveryBudgetCny});pkg.workflows=workflow.workflows;pkg.workflowTasks=workflow.tasks;
 f.tables.social_weekly_agent_planning=[];
 const packageRow=f.tables.social_weekly_operating_packages.find(row=>row.package_id===pkg.packageId&&row.version===pkg.version)!;assert.ok(packageRow);packageRow.payload=structuredClone(pkg);
 const service=createWeeklyPlanningAuthority(f.store),scope={tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version};
 const initialized=await service.initialize('t',pkg);
 const analysis=await service.runDirectorAnalysis({...scope,expectedPlanningVersion:initialized.version,actor:'director_agent',now:new Date('2026-10-02T00:00:00Z')});
 assert.equal(analysis.directorAnalyses.length,5,JSON.stringify(analysis.directorGaps));assert.equal(analysis.directorGaps?.length??0,0,JSON.stringify(analysis.directorAnalyses));
 const schedule=await service.mergeDetailedSchedule({tenantId:'t',programId:'p',package:pkg,expectedPlanningVersion:analysis.version,actor:'business_agent'});
 const confirmation=await service.confirm({...scope,expectedPlanningVersion:schedule.version,userId:'owner'});
 const dispatched=await service.dispatch({...scope,expectedPlanningVersion:confirmation.version,actor:'business_agent'});
 pkg.agentPlanning=structuredClone(dispatched);packageRow.payload=structuredClone(pkg);
 assert.equal(new Set(dispatched.directorAnalyses.map(row=>row.benchmarkVideoRefs[0]?.id)).size,5);
 return {...setup,pkg,dispatched,referenceIds,ownedReferenceIds,ownedReferenceId:ownedReferenceIds[0]!};
}
