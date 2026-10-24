import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startPreviewSafeRecovery} from './customerPreviewRecoveryPolicy.js';
test('customer simulation never starts channel or weekly recovery; stopping remains safe',()=>{
 const called:string[]=[];
 for(const name of ['messenger','weekly']) {
  const stop=startPreviewSafeRecovery(()=>{called.push(name);return()=>called.push(name+'-stop');},{LINGSHU_LOCAL_PREVIEW:'1',CUSTOMER_SIMULATION_ENABLED:'1'});
  stop();
 }
 assert.deepEqual(called,[]);
});
test('ordinary local preview and formal environments retain recovery and shutdown',()=>{
 for(const env of [{},{LINGSHU_LOCAL_PREVIEW:'1'},{CUSTOMER_SIMULATION_ENABLED:'1'},{LINGSHU_LOCAL_PREVIEW:'0',CUSTOMER_SIMULATION_ENABLED:'1'}]) {
  let started=0,stopped=0;
  const stop=startPreviewSafeRecovery(()=>{started++;return()=>{stopped++;};},env);
  assert.equal(started,1);stop();assert.equal(stopped,1);
 }
});
test('HTTP startup applies the recovery gate to both existing recovery launchers',()=>{
 const source=readFileSync(new URL('../index.ts',import.meta.url),'utf8');
 assert.match(source,/stopLocalWeeklyWebRecovery = processRole === 'web' \? startPreviewSafeRecovery\(\(\) => \{/);
 assert.match(source,/startPreviewSafeRecovery\(startMessengerContextTagRecovery\)/);
});
