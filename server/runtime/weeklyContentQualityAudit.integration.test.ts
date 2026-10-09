import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyInventoryG6Fixture} from './weeklyInventoryG6.fixture.js';
import {validateContentArtifact} from './socialWeeklyResultValidation.js';
import {SOCIAL_DIRECTOR_G5_REVIEWS} from '../starter198/socialDirectorG5ReviewService.js';
import {assertWeeklyPublicationG6Admission} from './weeklyPublicationG6Admission.js';

test('default production persistence and actual G4/G5 plus separate weekly human approvals support immutable false-summary inventory assignment',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-07T10:00:00Z')});
 const f=await prepareWeeklyInventoryG6Fixture();t.after(f.cleanup);
 const {task,ref,inventory,targetPublishing,assignment,actualPackage,g6,g6scope}=f;
 await assert.rejects(validateContentArtifact(f.store,{...task,tenantId:'foreign'},{...ref,version:2}));
 const outcome=f.tables[SOCIAL_DIRECTOR_G5_REVIEWS]!.find(row=>row.kind==='outcome')!;
 const savedHash=outcome.content_hash;outcome.content_hash='0'.repeat(64);
 await assert.rejects(validateContentArtifact(f.store,task,{...ref,version:2}));
 await assert.rejects(inventory.prepareAssignment(targetPublishing));
 await assert.rejects(assertWeeklyPublicationG6Admission(f.store,targetPublishing,assignment,actualPackage));outcome.content_hash=savedHash;
 await validateContentArtifact(f.store,task,{...ref,version:2});
 await assert.rejects(g6.context({...g6scope,artifactId:'foreign-artifact'},'owner'));
 f.profile.brand.tone='改变后的实际品牌调性';
 await assert.rejects(validateContentArtifact(f.store,task,{...ref,version:2}));
 await assert.rejects(inventory.prepareAssignment(targetPublishing));
 await assert.rejects(assertWeeklyPublicationG6Admission(f.store,targetPublishing,assignment,actualPackage));
});
