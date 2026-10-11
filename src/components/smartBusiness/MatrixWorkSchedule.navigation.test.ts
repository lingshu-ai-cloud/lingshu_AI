import assert from 'node:assert/strict';
import test from 'node:test';
import {productionQueueItemForPlan} from '../../lib/matrixProductionNavigation';
import {readFileSync} from 'node:fs';
import type {ContentQueueItem} from '../../lib/digitalEmployees';
import type {VideoCreationPlan} from '../../lib/videoCreationPlan';

const plan={contentId:'content-1',matrix:{accountId:'account-1'}} as VideoCreationPlan;
const item={id:'queue-row-1',contentId:'content-1',accountId:'account-1',taskId:'production-task-1'} as ContentQueueItem;

test('publication calendar resolves the exact production task for a planned video',()=>{
  assert.equal(productionQueueItemForPlan(plan,[item]),item);
  assert.equal(productionQueueItemForPlan(plan,[item,{...item,id:'other-row'}]),null);
  assert.equal(productionQueueItemForPlan({...plan,contentId:'missing'},[item]),null);
  assert.equal(productionQueueItemForPlan(undefined,[item]),null);
  assert.equal(productionQueueItemForPlan(plan,[{...item,accountId:'foreign-account'}]),null);
  const source=readFileSync(new URL('./MatrixPublicationSchedule.tsx',import.meta.url),'utf8');
  assert.match(source,/import \{productionQueueItemForPlan\} from '\.\.\/\.\.\/lib\/matrixProductionNavigation'/);
  assert.match(source,/const productionItem = productionQueueItemForPlan\(plan, taskItems\)/,'the calendar uses the same tested unique scoped selection');
});
