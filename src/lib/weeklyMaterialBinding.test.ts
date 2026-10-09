import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyExecutionTask, WeeklyOperatingPackage } from '../../shared/contracts/socialProgram';
import type { WeeklyMaterialRequest } from '../../server/socialPrograms/weeklyMaterialRequests';
import { bindWeeklyMaterialRequest, selectedWeeklyMaterialConsumers, weeklyMaterialRequirementChoices } from './weeklyMaterialBinding';
const task = (id: string, version: number): WeeklyExecutionTask => ({ taskId: id, programId: 'program', packageId: 'package', packageVersion: version, publicationTaskId: 'pub', schedule: { stepKind: 'material_readiness' } } as WeeklyExecutionTask);
const request = (id: string): WeeklyMaterialRequest => ({ requestId: id, programId: 'program', status: 'missing', consumers: [{ taskId: 'old', packageId: 'package', packageVersion: 1, requirement: (id === 'prior' ? 'prior-proof' : 'human-proof') + '：real product close-up' }] } as WeeklyMaterialRequest);
const pkg = (): WeeklyOperatingPackage => ({ programId: 'program', packageId: 'package', version: 1,agentPlanning:{dispatch:{scheduleItems:[{slotId:'slot',publicationTaskId:'pub',materialEvidenceRequirements:{scope:{packageId:'package',packageVersion:1,slotId:'slot'},items:[{requirementId:'prior-proof',description:'real product close-up',classification:'human_irreplaceable',reason:'real evidence'},{requirementId:'human-proof',description:'real product close-up',classification:'human_irreplaceable',reason:'real evidence'}]}}]}}, socialContentPackage: { publicationTasks: [{ publicationTaskId: 'pub', status: 'planned', materialRequirement: { required: true, requestIds: ['prior'],bindings:[{requirementId:'prior-proof',requestId:'prior'}] }, receptionRequirement: { required: true, bindingId: 'old-reception' } }] } } as unknown as WeeklyOperatingPackage);
function revised(previous:WeeklyOperatingPackage,publications:WeeklyOperatingPackage['socialContentPackage']['publicationTasks']) {const next=structuredClone(previous);next.version=2;next.socialContentPackage.publicationTasks=publications;next.agentPlanning!.dispatch!.scheduleItems[0].materialEvidenceRequirements!.scope.packageVersion=2;return next;}
test('freezes next version preserving prior requirements and appends real consumers to all shared requests', async () => {
  const old = pkg(); const frozen = structuredClone(old); const requests = [request('prior'), request('new')]; const appended: string[] = []; let revisions = 0; let surfaced = 0;
  await bindWeeklyMaterialRequest({ pkg: old, tasks: [task('old', 1)], request: requests[1],bindings:[{requirementId:'human-proof',requestId:'new'}], onRevision(next) { surfaced = next.version; }, ports: {
    async listRequests() { return requests; }, async listTasks(_program, _package, version) { return [task(version === 1 ? 'old' : 'next', version)]; },
    async revisePackage(previous, publications) { revisions++; assert.equal(previous.version, 1); assert.deepEqual(publications[0].materialRequirement?.requestIds, ['prior', 'new']); return revised(old,publications); },
    async appendConsumers(_program, requestId, consumers) { assert.equal(surfaced, 2); assert.deepEqual(consumers, [{ taskId: 'next', packageId: 'package', packageVersion: 2, requirement: (requestId === 'prior' ? 'prior-proof' : 'human-proof') + '：real product close-up' }]); appended.push(requestId); const record = requests.find(item => item.requestId === requestId)!; record.consumers.push(...consumers); return record; },
  } });
  assert.equal(revisions, 1); assert.deepEqual(appended, ['prior', 'new']); assert.deepEqual(old, frozen);
});
test('failed consumer append keeps real revision visible; retry repairs current version without another revision', async () => {
  const original = pkg(); const record = request('new'); let next = original; let revisionCount = 0; let fail = true;
  const existing = request('prior'); const requests = [existing, record];
  const ports = { async listRequests() { return requests; }, async listTasks(_program: string, _package: string, version: number) { return [task(version === 1 ? 'old' : 'next', version)]; }, async revisePackage(previous: WeeklyOperatingPackage, publications: WeeklyOperatingPackage['socialContentPackage']['publicationTasks']) { revisionCount++; return { ...previous, version: 2, socialContentPackage: { ...previous.socialContentPackage, publicationTasks: publications } }; }, async appendConsumers(_program: string, id: string, consumers: WeeklyMaterialRequest['consumers']) { if (fail) throw Error('temporary outage'); const record = requests.find(item => item.requestId === id)!; record.consumers.push(...consumers); return record; } };
  await assert.rejects(bindWeeklyMaterialRequest({ pkg: original, tasks: [task('old', 1)], request: record,bindings:[{requirementId:'human-proof',requestId:'new'}], onRevision(value) { next = value; }, ports:{...ports,async revisePackage(previous,publications){revisionCount++;return revised(previous,publications);}} }), /temporary outage/);
  assert.equal(next.version, 2); fail = false;
  await bindWeeklyMaterialRequest({ pkg: next, tasks: [task('next', 2)], request: record,bindings:[{requirementId:'human-proof',requestId:'new'}], onRevision() { throw Error('must not create another version'); }, ports });
  assert.equal(revisionCount, 1); assert.ok(record.consumers.some(consumer => consumer.taskId === 'next')); assert.ok(existing.consumers.some(consumer => consumer.taskId === 'next'));
});
test('unresolved consumer identity blocks before creating a package revision', async () => {
  let revised = false; const record = request('new');
  await assert.rejects(bindWeeklyMaterialRequest({ pkg: pkg(), tasks: [], request: record,bindings:[{requirementId:'human-proof',requestId:'new'}], onRevision() {}, ports: { async listRequests() { return [record]; }, async listTasks() { return []; }, async revisePackage(previous) { revised = true; return previous; }, async appendConsumers() { return record; } } }), /身份/);
  assert.equal(revised, false);
});
test('unknown and generated requirements cannot be bound as human evidence, and stale classification cannot supply IDs',()=> {
 const value=pkg();const items=value.agentPlanning!.dispatch!.scheduleItems[0].materialEvidenceRequirements!.items;
 items[0].classification='unknown';items[1].classification='generatable_non_evidentiary';
 assert.throws(()=>selectedWeeklyMaterialConsumers(value,[task('old',1)],['prior-proof']),/未知需求/);
 assert.throws(()=>selectedWeeklyMaterialConsumers(value,[task('old',1)],['human-proof']),/未知需求/);
 value.agentPlanning!.dispatch!.scheduleItems[0].materialEvidenceRequirements!.scope.packageVersion=9;
 assert.equal(weeklyMaterialRequirementChoices(value,[task('old',1)])[0].requirementId,null);
});
test('one stable actual requirement can explicitly share multiple real video consumers',()=> {
 const value=pkg(),item=structuredClone(value.agentPlanning!.dispatch!.scheduleItems[0]);item.publicationTaskId='pub2';item.slotId='slot2';item.materialEvidenceRequirements!.scope.slotId='slot2';value.agentPlanning!.dispatch!.scheduleItems.push(item);
 const second={...task('other',1),publicationTaskId:'pub2'};
 const consumers=selectedWeeklyMaterialConsumers(value,[task('old',1),second],['human-proof']);
 assert.deepEqual(consumers.map(consumer=>consumer.taskId),['old','other']);assert(consumers.every(consumer=>consumer.requirement==='human-proof：real product close-up'));
});
test('saved revision with changed analysis keeps blocking rather than silently reusing old requirement identity',async()=> {
 const original=pkg(),records=[request('prior'),request('new')];let surfaced=0,appends=0;
 await assert.rejects(bindWeeklyMaterialRequest({pkg:original,tasks:[task('old',1)],request:records[1],bindings:[{requirementId:'human-proof',requestId:'new'}],onRevision(value){surfaced=value.version;},ports:{async listRequests(){return records;},async listTasks(_program,_package,version){return [task('next',version)];},async revisePackage(previous,publications){const next=revised(previous,publications);next.agentPlanning!.dispatch!.scheduleItems[0].materialEvidenceRequirements!.items[1].requirementId='changed-source';return next;},async appendConsumers(){appends++;return records[0];}}}),/来源已改变/);
 assert.equal(surfaced,2);assert.equal(appends,0);
});
