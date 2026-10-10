import assert from 'node:assert/strict';
import test from 'node:test';
import {productionQueueItemForPlan} from './MatrixWorkSchedule';
import type {ContentQueueItem} from '../../lib/digitalEmployees';
import type {VideoCreationPlan} from '../../lib/videoCreationPlan';

const plan={contentId:'content-1',matrix:{accountId:'account-1'}} as VideoCreationPlan;
const item={id:'queue-row-1',contentId:'content-1',accountId:'account-1',taskId:'production-task-1'} as ContentQueueItem;

test('publication calendar resolves the exact production task for a planned video',()=>{
  assert.equal(productionQueueItemForPlan(plan,[item]),item);
  assert.equal(productionQueueItemForPlan(plan,[item,{...item,id:'other-row'}]),null);
  assert.equal(productionQueueItemForPlan({...plan,contentId:'missing'},[item]),null);
});
