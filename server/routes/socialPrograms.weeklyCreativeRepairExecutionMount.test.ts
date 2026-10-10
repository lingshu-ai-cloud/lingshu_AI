import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('parent router mounts creative repair through the real production adapter and durable completion service',async()=>{
 const source=await readFile(new URL('./socialPrograms.ts',import.meta.url),'utf8');
 assert.match(source,/createWeeklyCreativeRepairProductionPort\(dataStore\)/);
 assert.match(source,/createWeeklyCreativeRepairExecutionService\(dataStore,createWeeklyCreativeRepairProductionPort\(dataStore\)\)/);
 assert.match(source,/createWeeklyCreativeRepairCompletionService\(dataStore\)/);
 assert.match(source,/repair-cases\/:caseId\/creative-execution[^;]+createSocialWeeklyCreativeRepairExecutionRouter\(\{execution:creativeRepairExecution,completion:creativeRepairCompletion/);
 assert.doesNotMatch(source,/creativeRepairExecution\s*=\s*\{[^}]*previewCapacity/);
 assert.doesNotMatch(source,/creativeRepairCompletion\s*=\s*\{[^}]*reconcile/);
});
