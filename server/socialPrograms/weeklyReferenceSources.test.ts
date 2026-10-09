import test from 'node:test';
import assert from 'node:assert/strict';
import type { SocialWeeklyPublicationTask, WeeklyReferenceSourcePolicy } from '../../shared/contracts/socialProgram.js';
import { allocateWeeklyReferenceSources } from './weeklyReferenceSources.js';
const publications = Array.from({length:5},(_,i)=>({motherContentId:`mother-${i}`} as SocialWeeklyPublicationTask));
test('40/60 and 20/80 count mother videos once across platform variants',()=>{
 for(const ownedPercent of [40,20]) {const policy:WeeklyReferenceSourcePolicy={profile:'b2b_established',ownedPercent,externalPercent:100-ownedPercent,allocationUnit:'mother_content'};const allocation=allocateWeeklyReferenceSources([...publications,...publications],policy);assert.equal(allocation.size,5);assert.equal([...allocation.values()].filter(source=>source==='owned').length,ownedPercent===40?2:1);}
});
test('cold start is exclusively external and absent policy remains unknown',()=>{
 assert.deepEqual([...allocateWeeklyReferenceSources(publications,{profile:'b2b_cold_start',ownedPercent:0,externalPercent:100,allocationUnit:'mother_content'}).values()],Array(5).fill('external'));
 assert.deepEqual([...allocateWeeklyReferenceSources(publications,null).values()],Array(5).fill('unknown'));
});
