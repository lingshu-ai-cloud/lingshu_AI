import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyNonPresenterPlanningFixture} from '../runtime/weeklyNonPresenterProduction.fixture.js';
import {createWeeklyPlanningAuthority} from './planningAuthority.js';
import {verifiedWeeklyPlanningTemplateAdoption,weeklyPlanningExecutionActor} from './weeklyPlanningTemplateAdoption.js';
import {buildWeeklyProductionPlanningAuthority} from './weeklyProductionPlanningAuthority.js';
import {createSocialOperatingRepository} from '../socialOperating/repository.js';

test('actual stored analyzed schedule adopts template without inventing user confirmation; dispatch preserves source and refuses changed analysis',async t=>{
 const {f,pkg}=await prepareWeeklyNonPresenterPlanningFixture(t,{ownedReferenceBytes:true,primaryStructure:true,metricTargets:['真实成片']});
 // The controlled fixture has actual source evidence and historical planning
 // revisions. Select its pre-confirmation state in this isolated memory store;
 // no live package or business records are modified by this test.
 f.tables.social_weekly_agent_planning=f.tables.social_weekly_agent_planning!.filter(row=>!['confirmed','dispatched'].includes((row.payload as any).status));
 const planner=createWeeklyPlanningAuthority(f.store),before=await planner.get('t','p',pkg.packageId,pkg.version);
 assert.equal(before.status,'awaiting_confirmation');
 const scope={tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,actorUserId:'owner'};
 const adopted=await planner.confirmAutomaticTemplate({...scope,expectedPlanningVersion:before.version,selectedSlotIds:before.detailedSchedule!.coverage!.selectedSlotIds});
 assert.equal(adopted.status,'confirmed');assert.equal(adopted.userConfirmation,null);assert.equal(adopted.automaticTemplateAdoption?.userApproval,null);
 assert.equal(weeklyPlanningExecutionActor(adopted),'owner');assert.equal(verifiedWeeklyPlanningTemplateAdoption(adopted)?.authorizesContentAcceptance,false);
 const dispatched=await planner.dispatch({...scope,expectedPlanningVersion:adopted.version,actor:'business_agent',selectedSlotIds:adopted.automaticTemplateAdoption!.selectedSlotIds});
 assert.equal(dispatched.status,'dispatched');assert.equal(dispatched.userConfirmation,null);assert.deepEqual(dispatched.dispatch?.scheduleItems,before.detailedSchedule?.items);
 assert.deepEqual(verifiedWeeklyPlanningTemplateAdoption(JSON.parse(JSON.stringify(dispatched))),dispatched.automaticTemplateAdoption);
 const originalGoal=await createSocialOperatingRepository(f.store).getGoal('t','p',pkg.businessContentGoalRef!.id,pkg.businessContentGoalRef!.version);assert(originalGoal);
 const commercial={...originalGoal,status:'blocked' as const,blockers:[{code:'conversion_route_required' as const,field:'conversionRoutes',message:'Missing real conversion route',recoverable:true as const}]};
 const goalBefore=structuredClone(commercial);
 const production=buildWeeklyProductionPlanningAuthority({tenantId:'t',pkg,planning:dispatched,goal:commercial,factSourceRef:{type:'enterprise_fact',id:'verified-source',version:1},factSourceHash:'verified-hash',now:'2026-10-16T00:00:00Z'});
 assert.deepEqual(commercial,goalBefore);assert.equal(commercial.status,'blocked');assert.deepEqual(production.deferredOutboundBlockers,['conversion_route_required']);assert.equal(production.authorizesContentAcceptance,false);assert.equal(production.authorizesPublishing,false);assert.equal(production.notEvidenceOfMediaRights,true);assert.equal(production.notEvidenceOfBusinessProfileCompleteness,true);
 assert.throws(()=>buildWeeklyProductionPlanningAuthority({tenantId:'t',pkg,planning:dispatched,goal:{...commercial,publicFactRefs:[]},factSourceRef:production.factSourceRef,factSourceHash:'verified-hash',now:production.adoptedAt}),{code:'weekly_production_planning_facts_or_goal_invalid'});
 const changed=structuredClone(dispatched);changed.directorAnalyses[0].contentDirection+=' unverified';
 assert.throws(()=>verifiedWeeklyPlanningTemplateAdoption(changed),{code:'weekly_planning_template_adoption_invalid'});
 assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.social_publication_attempts?.length??0,0);
});
