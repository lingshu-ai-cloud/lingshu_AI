import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync,spawn,execFileSync,fork} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import {request as undiciRequest} from 'undici';
import axios from 'axios';
import {customerIsolationStatus} from './customer-isolated-test-guard.mjs';
const endpoint='https://customer-channel.invalid/messages';
const blocked=/isolated_test_network_blocked/;
const canary=()=>Reflect.get(globalThis,Symbol.for('lingshu.customerIsolationCanary'))();

test('all channel transports fail before a network canary, including URL option overrides and raw sockets',async()=>{
 assert.equal(customerIsolationStatus().installed,true);assert.deepEqual(canary(),[]);
 await assert.rejects(fetch(endpoint,{method:'POST'}),blocked);
 await assert.rejects(fetch(new Request(endpoint,{method:'POST'})),blocked);
 for(const action of [()=>http.request(endpoint),()=>https.request(endpoint),()=>http.get(endpoint),()=>https.get(endpoint),()=>net.connect(443,'customer-channel.invalid'),()=>net.createConnection({port:443,host:'customer-channel.invalid'}),()=>new net.Socket().connect({port:443,host:'203.0.113.9'}),()=>tls.connect({host:'customer-channel.invalid',port:443}),()=>http2.connect(endpoint)])assert.throws(action,blocked);
 await assert.rejects(undiciRequest(endpoint,{method:'POST'}),blocked);
 await assert.rejects(axios.post(endpoint,{}, {proxy:false}),blocked);
 const server=http.createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{location:endpoint});res.end();}else res.end('local-ok');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal(await (await fetch(url)).text(),'local-ok');
  assert.throws(()=>http.request(url,{hostname:'customer-channel.invalid'}),blocked);
  assert.throws(()=>https.request(url,{host:'customer-channel.invalid'}),blocked);
  await assert.rejects(axios.get(url+'/redirect',{proxy:false}),blocked);
  await assert.rejects(fetch(url+'/redirect')); // Cannot follow even a local redirect into a channel.
  assert.throws(()=>net.connect(9,'127.0.0.1'),blocked,'unowned loopback services/proxies are denied');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 assert.deepEqual(canary(),[],'no denied attempt may reach the lower transport');
 assert.ok(customerIsolationStatus().blocked.length>=12);
});

const childProbe=`const assert=require('node:assert/strict');assert.equal(globalThis[Symbol.for('lingshu.customerIsolationGuard')],true);assert.throws(()=>require('node:https').request('${endpoint}'),/isolated_test_network_blocked/);fetch('${endpoint}',{method:'POST'}).then(()=>process.exit(9),e=>{assert.match(e.message,/isolated_test_network_blocked/);assert.deepEqual(globalThis[Symbol.for('lingshu.customerIsolationCanary')](),[]);console.log('child-default-deny');});`;
test('spawn, execFile and fork descendants keep isolation even with an empty env; arbitrary shell/curl are rejected',()=>{
 const r=spawnSync(process.execPath,['-e',childProbe],{env:{},encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/child-default-deny/);
 assert.match(execFileSync(process.execPath,['-e',childProbe],{env:{},encoding:'utf8',timeout:10000}),/child-default-deny/);
 assert.throws(()=>spawn('curl',[endpoint]),blocked);
 assert.throws(()=>execFileSync('/usr/bin/curl',[endpoint]),blocked);
 assert.throws(()=>spawn(process.execPath,['-e',''],{shell:true}),blocked);
 assert.deepEqual(canary(),[]);
});
test('worker with explicitly cleared execArgv still defaults to deny',async()=>{
 const code=`${childProbe.replace("console.log('child-default-deny')","require('node:worker_threads').parentPort.postMessage('worker-default-deny')")}`;
 const worker=new Worker(code,{eval:true,execArgv:[],env:{}});
 try{assert.equal(await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error('worker exit '+code));});}),'worker-default-deny');}finally{await worker.terminate();}
});
test('legacy tsx CLI test subprocess inherits the guard; preview bootstrap installs before adapters',()=>{
 const r=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','--test','scripts/fixtures/customer-isolation-child.mjs'],{env:{},encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/launcher descendant/);
 // Missing preload case is checked separately by a fresh unguarded launcher below;
 // in this descendant, import the real preview bootstrap with the same guard.
 const preview=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`Object.assign(process.env,{NODE_ENV:'development',LINGSHU_LOCAL_PREVIEW:'1',PROCESS_ROLE:'worker'});await import('./server/runtime/localCustomerPreviewIsolation.ts');console.log(JSON.stringify({installed:globalThis[Symbol.for('lingshu.customerIsolationStatus')]().installed,role:process.env.PROCESS_ROLE,host:process.env.LINGSHU_LISTEN_HOST}));`],{env:{},encoding:'utf8',timeout:15000});assert.equal(preview.status,0,preview.stderr);assert.match(preview.stdout,/"installed":true/);assert.match(preview.stdout,/"role":"web"/);
});

test('forked child and its grandchild cannot drop isolation by clearing env or execArgv',async()=>{
 const child=fork('scripts/fixtures/customer-isolation-child.mjs',[],{env:{},execArgv:[],silent:true});
 const message=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(Error('fork exit '+code));});});
 assert.deepEqual(message,{guard:true,canaryHits:0});await new Promise(r=>child.once('exit',r));
 const nested=`const c=require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(childProbe)}],{env:{},encoding:'utf8'});if(c.status!==0)throw Error(c.stderr);console.log(c.stdout);`;
 const r=spawnSync(process.execPath,['-e',nested],{env:{},encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/child-default-deny/);
});

test('preview startup skips external proxy probes and browser CSP permits only local connections',async()=>{
 const {configureNetworkProxy}=await import('../server/lib/networkEnvironment.ts');
 const before=customerIsolationStatus().blocked.length;configureNetworkProxy();assert.equal(customerIsolationStatus().blocked.length,before,'curl/nc startup probes must not even be attempted');
 const {default:configFactory}=await import('../vite.config.ts');
 const previous=process.env.VITE_LINGSHU_LOCAL_PREVIEW;process.env.VITE_LINGSHU_LOCAL_PREVIEW='1';
 try{
  const config=await configFactory({mode:'development',command:'serve',isSsrBuild:false,isPreview:false});
  const csp=config.server.headers['Content-Security-Policy'];assert.match(csp,/connect-src 'self'/);assert.match(csp,/form-action 'self'/);assert.doesNotMatch(csp,/https:|wss:|\*/,'no remote origin or wildcard is allowed');
 }finally{if(previous===undefined)delete process.env.VITE_LINGSHU_LOCAL_PREVIEW;else process.env.VITE_LINGSHU_LOCAL_PREVIEW=previous;}
 assert.deepEqual(canary(),[]);
});

test('file workers also install the guard when worker options remove inherited preloads',async()=>{
 const worker=new Worker(new URL('./fixtures/customer-isolation-child.mjs',import.meta.url),{execArgv:[],env:{}});
 try{const message=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error('worker exit '+code));});});assert.deepEqual(message,{guard:true,canaryHits:0});}finally{await worker.terminate();}
});

test('caught lower-barrier escapes still fail the descendant process on exit',()=>{
 const code=`import('./scripts/customer-isolation-canary.mjs').then(m=>{try{m.tripCustomerIsolationCanaryForTest();}catch{};});`;
 const r=spawnSync(process.execPath,['-e',code],{env:{},encoding:'utf8',timeout:10000});assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/customer_isolation_canary_failed/);assert.deepEqual(canary(),[]);
});
