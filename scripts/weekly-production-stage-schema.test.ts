import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('actual PocketBase persists the weekly stage checkpoint only after the forward migration',async t=>{
 const binary=process.env.PB_REHEARSAL_BIN??path.join(homedir(),'.local/share/lingshu/pocketbase/pocketbase');
 const version=spawnSync(binary,['--version'],{encoding:'utf8'});assert.equal(version.status,0);assert.match(version.stdout,/0\.39\.5/);
 const root=await mkdtemp(path.join(tmpdir(),'pb-weekly-stage-'));t.after(()=>rm(root,{recursive:true,force:true}));const migrations=path.join(root,'migrations');await mkdir(migrations);
 for(const name of ['1791072008_create_content_execution_queue.js','1791072050_allow_initial_content_queue_zero_state.js','1791072051_add_weekly_production_stage_checkpoint.js'])await copyFile(path.join('pb_migrations',name),path.join(migrations,name));
 await writeFile(path.join(migrations,'1791072050_probe_before.js'),`migrate(app=>{const c=app.findCollectionByNameOrId('content_execution_jobs');if(c.fields.getByName('checkpoint'))throw Error('old schema unexpectedly includes stage checkpoint');console.log('PROOF old_stage_missing');},app=>{});`);
 await writeFile(path.join(migrations,'1791072052_probe_after.js'),`migrate(app=>{
 const c=app.findCollectionByNameOrId('content_execution_jobs'),field=c.fields.getByName('checkpoint');
 if(!field||field.maxSize!==2097152||field.required)throw Error('invalid checkpoint schema '+JSON.stringify(field));
 if(c.listRule!==null||c.viewRule!==null||c.createRule!==null||c.updateRule!==null||c.deleteRule!==null)throw Error('backend job access changed');
 const stage={schemaVersion:'weekly-production-stage.v1',stage:'waiting_asset_claim',taskId:'original-task',runId:'original-run',handoffHash:'proof-hash',assetTaskId:'actual-asset-card',materialTaskId:'actual-material-card'};
 const row=new Record(c),at='2026-10-10T00:00:00Z';
 const value={tenant_id:'isolated-tenant',job_key:'stage-roundtrip',task_id:'original-task',run_id:'original-run',user_id:'owner',account_id:'account',task_type:'social_content_weekly',status:'paused',attempt:0,reconciliation_attempt:0,provider_state:'none',provider_receipts:[],checkpoint:{weeklyStage:stage},created_at:at,updated_at:at};
 for(const key of Object.keys(value))row.set(key,value[key]);app.save(row);
 const saved=app.findRecordById(c.id,row.id),actual=JSON.parse(saved.getString('checkpoint'));
 if(!actual||Object.keys(actual).length!==1||!actual.weeklyStage||Object.keys(actual.weeklyStage).length!==Object.keys(stage).length||Object.keys(stage).some(key=>actual.weeklyStage[key]!==stage[key]))throw Error('stage checkpoint did not survive actual record roundtrip');
 console.log('PROOF actual_stage_roundtrip');
 },app=>{});`);
 const run=spawnSync(binary,['migrate','up',`--dir=${path.join(root,'fresh-data')}`,`--migrationsDir=${migrations}`],{encoding:'utf8'});
 assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout+run.stderr,/PROOF old_stage_missing/);assert.match(run.stdout+run.stderr,/PROOF actual_stage_roundtrip/);
});
