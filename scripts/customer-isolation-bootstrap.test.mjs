// Intentionally launched without the guard: verifies the missing-preload case.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
test('local preview installs isolation by default without NODE_OPTIONS or a guard CLI preload',()=>{
 const code=`Object.assign(process.env,{NODE_ENV:'development',LINGSHU_LOCAL_PREVIEW:'1',PROCESS_ROLE:'worker'});await import('./server/runtime/localCustomerPreviewIsolation.ts');const status=globalThis[Symbol.for('lingshu.customerIsolationStatus')]();if(!status.installed)throw Error('missing_guard');try{await fetch('https://customer-channel.invalid/messages',{method:'POST'});throw Error('unblocked');}catch(e){if(e.message!=='isolated_test_network_blocked')throw e;}console.log(JSON.stringify({installed:status.installed,version:status.version,role:process.env.PROCESS_ROLE,host:process.env.LINGSHU_LISTEN_HOST,canary:globalThis[Symbol.for('lingshu.customerIsolationCanary')]()}));`;
 const r=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{env:{CUSTOMER_ISOLATION_CANARY:'1'},encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stderr);
 const result=JSON.parse(r.stdout.trim().split('\n').at(-1));assert.deepEqual(result,{installed:true,version:2,role:'web',host:'127.0.0.1',canary:[]});
 const siblings=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"import './server/runtime/localCustomerPreviewIsolation.ts';import './scripts/fixtures/customer-isolation-startup-observer.mjs';"],{env:{NODE_ENV:'development',LINGSHU_LOCAL_PREVIEW:'1',CUSTOMER_ISOLATION_CANARY:'1'},encoding:'utf8',timeout:15000});assert.equal(siblings.status,0,siblings.stderr);assert.match(siblings.stdout,/adapter-observed-default-deny/);
 assert.match(fs.readFileSync('server/index.ts','utf8'),/^import '\.\/runtime\/localCustomerPreviewIsolation\.js';/,'isolation must run before adapter imports');
});
