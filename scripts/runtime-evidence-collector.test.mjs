import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {collectDryRun,rejectSecrets,renderReport} from './runtime-evidence-collector.mjs';
const empty={schemaVersion:'runtime-evidence-input.v1',sections:{}};
test('six missing sections never become real verified evidence',async()=>{
 const previous=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('network forbidden');};
 try{const report=await collectDryRun(empty);assert.equal(Object.keys(report.sections).length,6);assert.equal(report.runtimeVerified,false);assert.equal(report.outboundEffects,0);assert.ok(Object.values(report.sections).every(s=>s.status==='missing'&&!s.runtimeVerified));assert.equal(calls,0);}finally{globalThis.fetch=previous;}
});
test('secrets are rejected recursively before validators and reports',()=>{
 for(const key of ['access_token','refreshToken','authorization','privateKey','password','token','apiKey','encrypted_secret'])assert.throws(()=>rejectSecrets({sections:{publication:{nested:{[key]:'sentinel-secret'}}}}),{code:'secret_input_rejected'});
 assert.throws(()=>rejectSecrets({note:'Bearer sentinel-secret'}),{code:'secret_input_rejected'});
 assert.doesNotThrow(()=>rejectSecrets({tokenRef:'credential-reference',tokenVersion:2}));
});
test('malformed supplied sections fail or remain unverified without echoing identities',async()=>{
 const report=await collectDryRun({...empty,sections:{whatsapp:{tenantId:'private-tenant-sentinel',recipient:'private-recipient-sentinel',dryRun:false,mode:'evidence',trusted:true}}});
 assert.equal(report.sections.whatsapp.runtimeVerified,false);assert.notEqual(report.sections.whatsapp.status,'verified');assert.ok(!JSON.stringify(report).includes('sentinel'));assert.ok(!renderReport(report).includes('sentinel'));
 await assert.rejects(collectDryRun({...empty,sections:{unexpected:{}}}),{code:'unknown_evidence_section'});
});
test('all supplied sections bind the independently selected collector target',async()=>{
 const input={...empty,expectedScope:{tenantId:'tenant-a',programId:'program',packageId:'package',packageVersion:2,accountVersions:{account:3}},sections:{publication:{scope:{tenantId:'tenant-b',accountId:'account',accountVersion:3}},whatsapp:{expected:{tenantId:'tenant-a',accountId:'account',version:2}},weeklyPackage:{scope:{tenantId:'tenant-a',programId:'program',packageId:'other',packageVersion:2,accountIds:['account']}}}};
 const report=await collectDryRun(input);for(const name of Object.keys(input.sections)){assert.equal(report.sections[name].status,'failed');assert.equal(report.sections[name].checks[0].code,'collector_target_scope_mismatch');}
});
test('CLI persists only restrictive sanitized reports and refuses overwrite',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'runtime-evidence-'));try{
 const input=join(directory,'input.json'),out=join(directory,'out');await writeFile(input,JSON.stringify(empty));
 const run=()=>spawnSync(process.execPath,['scripts/runtime-evidence-collector.mjs','--input',input,'--out',out],{encoding:'utf8'});
 const result=run();assert.equal(result.status,0,result.stderr);const report=JSON.parse(await readFile(join(out,'report.json'),'utf8'));assert.equal(report.runtimeVerified,false);assert.equal((await stat(join(out,'report.json'))).mode&0o777,0o600);assert.equal((await stat(join(out,'report.md'))).mode&0o777,0o600);assert.equal(run().status,1);
 await writeFile(input,JSON.stringify({...empty,accessToken:'secret-sentinel'}));const rejected=spawnSync(process.execPath,['scripts/runtime-evidence-collector.mjs','--input',input,'--out',join(directory,'bad')],{encoding:'utf8'});assert.equal(rejected.status,1);assert.ok(!`${rejected.stdout}${rejected.stderr}`.includes('secret-sentinel'));
 }finally{await rm(directory,{recursive:true,force:true});}
});
