import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectAccountBindingCalendar} from './accountBindingCalendar';
import type {ContentQueueItem} from '../../lib/digitalEmployees';
const item=(id:string,accountId='account-a',platform='instagram'):ContentQueueItem=>({id,accountId,accountLabel:accountId,platform,title:id,status:'completed',plannedPublishDate:'2026-10-11T15:00:00+08:00'} as ContentQueueItem);
test('same intended account gets one exception and all original consumers',()=>{
 const cards=projectAccountBindingCalendar([item('video-a'),{...item('video-b'),plannedPublishDate:'2026-10-10T15:00:00+08:00'}],[]);
 assert.equal(cards.length,1);assert.deepEqual(cards[0].affectedPublicationIds,['video-a','video-b']);assert.equal(cards[0].date,'2026-10-10');assert.equal(cards[0].agent,'human');
});
test('successful binding removes exception without changing content identities',()=>{
 const original=item('video-a');assert.deepEqual(projectAccountBindingCalendar([original],[{accountId:'account-a',platform:'instagram',connected:true}]),[]);assert.equal(original.status,'completed');
});
test('different platforms/accounts stay distinct; production and content-only work do not demand binding',()=>{
 assert.equal(projectAccountBindingCalendar([item('a'),item('b','account-b'),item('c','account-a','youtube')],[]).length,3);
 assert.deepEqual(projectAccountBindingCalendar([{...item('a'),status:'producing'},{...item('b'),plannedPublishDate:''}],[]),[]);
});
