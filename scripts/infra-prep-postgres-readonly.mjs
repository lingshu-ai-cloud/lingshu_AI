#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const READONLY_SQL = `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10000ms';
SET LOCAL lock_timeout = '3000ms';
SELECT json_build_object(
 'readOnly', current_setting('transaction_read_only'),
 'isolation', current_setting('transaction_isolation'),
 'serverVersion', current_setting('server_version_num'),
 'tls', (SELECT json_build_object('ssl',ssl,'version',version) FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
 'migrationRuns',COALESCE((SELECT json_agg(json_build_object('runId',id,'status',status)) FROM public.lingshu_migration_runs),'[]'::json),
 'migrationCollections',COALESCE((SELECT json_agg(json_build_object('runId',run_id,'collection',collection,'sourceCount',source_count::text,'targetCount',target_count::text)) FROM public.lingshu_migration_collections),'[]'::json),
 'tables', COALESCE((SELECT json_agg(json_build_object('table',c.relname,'kind',c.relkind,'columns',
   COALESCE((SELECT json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull)) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::json),
   'constraints',COALESCE((SELECT json_agg(json_build_object('type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid))) FROM pg_constraint k WHERE k.conrelid=c.oid),'[]'::json)))
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('lingshu_records','lingshu_migration_runs','lingshu_migration_collections')),'[]'::json),
 'indexes',COALESCE((SELECT json_agg(json_build_object('name',idx.relname,'unique',i.indisunique,'valid',i.indisvalid,'ready',i.indisready,'immediate',i.indimmediate,'keys',i.indnkeyatts,
   'expressions',pg_get_expr(i.indexprs,i.indrelid),'predicate',pg_get_expr(i.indpred,i.indrelid)))
   FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid WHERE i.indrelid=to_regclass('public.lingshu_records')),'[]'::json),
 'collections',COALESCE((SELECT json_agg(x) FROM (SELECT collection,count(*)::text AS actual_count,count(*) FILTER (WHERE source_hash IS NULL)::text AS pg_only_or_untracked FROM public.lingshu_records GROUP BY collection ORDER BY collection)x),'[]'::json)
)::text;
COMMIT;`;
const columns = {
 lingshu_records: {collection:['text',true],id:['text',true],tenant_id:['text',false],data:['jsonb',true],source_hash:['text',false],created_at:['timestamp with time zone',true],updated_at:['timestamp with time zone',true],migrated_at:['timestamp with time zone',false]},
 lingshu_migration_runs: {id:['text',true],source:['text',true],status:['text',true],started_at:['timestamp with time zone',true],finished_at:['timestamp with time zone',false],report:['jsonb',true]},
 lingshu_migration_collections: {run_id:['text',true],collection:['text',true],source_count:['bigint',true],target_count:['bigint',true],source_digest:['text',true],target_digest:['text',true],copied_files:['bigint',true],copied_bytes:['bigint',true],verified_files:['bigint',true],applied_indexes:['bigint',true],error:['text',false]},
};
const indexes = {
 idx_lingshu_durable_operation_lease_subject: {fields:['tenant_id','lease_scope','subject_id'],predicate:"collection='durable_operation_leases'"},
 idx_lingshu_content_execution_job_key: {fields:['tenant_id','job_key'],predicate:"collection='content_execution_jobs'"},
 idx_lingshu_content_execution_task_run: {fields:['tenant_id','task_id','run_id'],predicate:"collection='content_execution_jobs'"},
 idx_lingshu_content_execution_limit_scope: {fields:['tenant_id','limit_scope','scope_key'],predicate:"collection='content_execution_limits'"},
 idx_lingshu_social_presenter_job_request: {fields:['tenant_id','request_id'],predicate:"collection='studio_social_presenter_jobs'"},
 idx_lingshu_materials_owned_hash: {fields:['tenantId','scope','sha256'],predicate:"collection='materials'ANDdata->>'scope'='own'ANDCOALESCEdata->>'sha256',''<>''"},
};
export function canonicalSQL(value){
 const input=String(value??'');let output='';
 for(let i=0;i<input.length;){const ch=input[i];if(ch==="'"||ch==='"'){const quote=ch;output+=ch;i++;let closed=false;while(i<input.length){const c=input[i++];output+=c;if(c===quote){if(input[i]===quote){output+=input[i++];}else{closed=true;break;}}}if(!closed)throw Error('invalid_catalog_expression');continue;}
 const cast=input.slice(i).match(/^::text(?:\[\])?(?![A-Za-z0-9_])/);if(cast){i+=cast[0].length;continue;}if(/[()\s]/.test(ch)){i++;continue;}output+=ch;i++;}return output;
}
const canonical=canonicalSQL;
const exactConstraint=(table,type,definition)=>table.constraints?.some(c=>c.type===type&&c.validated===true&&canonical(c.definition)===canonical(definition));
export function evaluateReadOnlyCatalog(catalog,manifest=null){
 const issues=[];
 if(catalog?.tls?.ssl!==true)issues.push('postgres_tls_not_proven');
 if(catalog?.readOnly!=='on'||catalog.isolation!=='repeatable read')issues.push('readonly_transaction_not_proven');
 if(!/^\d+$/.test(String(catalog?.serverVersion??''))||Number(catalog.serverVersion)<110000)issues.push('postgres_version_unsupported');
 for(const [name,required] of Object.entries(columns)){
  const rows=Array.isArray(catalog?.tables)?catalog.tables.filter(t=>t.table===name):[];
  if(rows.length!==1||rows[0].kind!=='r'){issues.push(`table_missing_or_wrong_kind:${name}`);continue;}
  const t=rows[0];
  for(const [key,[type,notNull]] of Object.entries(required)){const found=t.columns?.filter(c=>c.name===key)??[];if(found.length!==1||found[0].type!==type||found[0].notNull!==notNull)issues.push(`column_mismatch:${name}.${key}`);}
  const pk=name==='lingshu_records'?'PRIMARY KEY(collection,id)':name==='lingshu_migration_runs'?'PRIMARY KEY(id)':'PRIMARY KEY(run_id,collection)';
  if(!exactConstraint(t,'p',pk))issues.push(`primary_key_mismatch:${name}`);
  if(name==='lingshu_records'){
   if(!exactConstraint(t,'c',"CHECK(jsonb_typeof(data)='object')"))issues.push('json_object_check_missing');
   if(!exactConstraint(t,'c',"CHECK(collection ~ '^[A-Za-z_][A-Za-z0-9_]{0,62}$')"))issues.push('collection_name_check_missing');
  }
  if(name==='lingshu_migration_runs'&&!exactConstraint(t,'c',"CHECK(status=ANY(ARRAY['planning','running','verifying','completed','failed']))"))issues.push('migration_status_check_mismatch');
  if(name==='lingshu_migration_collections'&&!exactConstraint(t,'f','FOREIGN KEY(run_id) REFERENCES lingshu_migration_runs(id) ON DELETE CASCADE'))issues.push('migration_report_fk_mismatch');
 }
 for(const [name,expected] of Object.entries(indexes)){
  const rows=Array.isArray(catalog?.indexes)?catalog.indexes.filter(i=>i.name===name):[];const i=rows[0];
  if(rows.length!==1||i.unique!==true||i.valid!==true||i.ready!==true||i.immediate!==true||i.keys!==expected.fields.length||canonical(i.expressions)!==canonical(expected.fields.map(f=>`data->>'${f}'`).join(','))||canonical(i.predicate)!==canonical(expected.predicate))issues.push(`unique_index_mismatch:${name}`);
 }
 const inventory=[];const seen=new Set();for(const row of Array.isArray(catalog?.collections)?catalog.collections:[]){if(!row||!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(row.collection)||seen.has(row.collection)||!/^\d+$/.test(String(row.actual_count))||!/^\d+$/.test(String(row.pg_only_or_untracked))||BigInt(row.pg_only_or_untracked)>BigInt(row.actual_count)){issues.push('collection_inventory_invalid');continue;}seen.add(row.collection);inventory.push({collection:row.collection,actual_count:String(row.actual_count),pg_only_or_untracked:String(row.pg_only_or_untracked)});}
 const manifestIssues=[];
 if(manifest){const runs=catalog.migrationRuns?.filter(r=>r.runId===manifest.runId)??[];if(runs.length!==1||runs[0].status!=='completed')manifestIssues.push('migration_run_not_completed');for(const collection of manifest.collections){const reports=catalog.migrationCollections?.filter(r=>r.runId===manifest.runId&&r.collection===collection.name)??[];if(reports.length!==1)manifestIssues.push(`migration_collection_report_missing_or_duplicate:${collection.name}`);const inventory=catalog.collections?.filter(r=>r.collection===collection.name)??[];const actual=inventory.length===0?'0':inventory.length===1?String(inventory[0].actual_count):null;if(actual===null||collection.expectedCount!==undefined&&BigInt(actual)!==BigInt(collection.expectedCount))manifestIssues.push(`migration_collection_count_mismatch:${collection.name}`);if(reports[0]&&(!/^\d+$/.test(String(reports[0].sourceCount))||!/^\d+$/.test(String(reports[0].targetCount))||String(reports[0].sourceCount)!==String(reports[0].targetCount)||String(reports[0].targetCount)!==actual))manifestIssues.push(`migration_collection_report_count_mismatch:${collection.name}`);for(const expected of collection.requiredUniqueIndexes){const matches=catalog.indexes?.filter(i=>i.name===expected.name)??[];const i=matches[0];if(matches.length!==1||i.unique!==true||i.valid!==true||i.ready!==true||i.immediate!==true||i.keys!==expected.fields.length||canonical(i.expressions)!==canonical(expected.fields.map(f=>`data->>'${f}'`).join(','))||canonical(i.predicate)!==canonical(expected.predicate))manifestIssues.push(`migration_unique_index_mismatch:${collection.name}:${expected.name}`);}}}
 return{schemaReady:issues.length===0,manifestCoverageReady:manifest?manifestIssues.length===0:null,migrationMetadataReady:manifest?manifestIssues.length===0:null,manifestIssues,migrationReady:false,currentDataVerified:false,issues,collections:inventory,limitations:['Schema/catalog proof only. Independently verify frozen-source/current-target content, all collection unique indexes, tenant lineage and file SHA256.','Cached source_hash is not a current-data digest; PG-only records are included in inventory, not excluded.']};
}
export function parseManifest(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['runId','collections'].includes(k))||typeof value.runId!=='string'||!value.runId.trim()||!Array.isArray(value.collections)||!value.collections.length)throw Error('invalid_manifest');
 const identifier=/^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
 if(new Set(value.collections.map(c=>c?.name)).size!==value.collections.length)throw Error('invalid_manifest');
 for(const c of value.collections){if(!c||Object.keys(c).some(k=>!['name','expectedCount','requiredUniqueIndexes'].includes(k))||!identifier.test(c.name)||!Array.isArray(c.requiredUniqueIndexes)||c.expectedCount!==undefined&&(!Number.isSafeInteger(c.expectedCount)||c.expectedCount<0))throw Error('invalid_manifest');for(const i of c.requiredUniqueIndexes){if(!i||Object.keys(i).some(k=>!['name','fields','predicate'].includes(k))||!identifier.test(i.name)||!Array.isArray(i.fields)||!i.fields.length||i.fields.some(f=>!identifier.test(f))||new Set(i.fields).size!==i.fields.length||typeof i.predicate!=='string'||!i.predicate.trim())throw Error('invalid_manifest');}}
 return value;
}
export function runReadonly(argv=[],env=process.env,executor=spawnSync){
 let manifest=null;const options=[];
 try{for(let i=0;i<argv.length;i++){if(argv[i]==='--manifest'){if(manifest||!argv[i+1])throw Error('invalid_arguments');manifest=parseManifest(JSON.parse(fs.readFileSync(argv[++i],'utf8')));}else options.push(argv[i]);}}
 catch{return{exitCode:2,report:{mode:'blocked',executed:false,code:'invalid_manifest_or_arguments'}};}
 if(options.some(a=>!['--execute','--dry-run'].includes(a))||new Set(options).size!==options.length||options.includes('--execute')&&options.includes('--dry-run'))return{exitCode:2,report:{mode:'blocked',executed:false,code:'invalid_arguments'}};
 if(!options.includes('--execute'))return{exitCode:0,report:{mode:'dry-run',executed:false,readOnly:true,sql:READONLY_SQL,manifestProvided:Boolean(manifest)}};
 if(!String(env.DATABASE_URL??'').trim())return{exitCode:2,report:{mode:'blocked',executed:false,code:'postgres_connection_configuration_required'}};
 const sslMode=String(env.DATABASE_SSL_MODE||'require').trim().toLowerCase();let url;
 try{url=new URL(env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.pathname||url.pathname==='/'||!url.username||!url.password||url.hash||[url.username,url.password,url.pathname].some(v=>v.includes('REPLACE_')))throw Error('invalid_url');}catch{return{exitCode:2,report:{mode:'blocked',executed:false,code:'postgres_connection_configuration_invalid'}};}
 if(!['require','verify-full'].includes(sslMode)||[...url.searchParams.keys()].some(k=>k!=='sslmode')||url.searchParams.getAll('sslmode').length>1||url.searchParams.has('sslmode')&&url.searchParams.get('sslmode')!==sslMode)return{exitCode:2,report:{mode:'blocked',executed:false,code:'postgres_tls_or_target_conflict'}};
 const childEnv={PATH:env.PATH||'/usr/bin:/bin'};if(env.INFRA_PREP_PG_SSL_ROOT_CERT)childEnv.PGSSLROOTCERT=env.INFRA_PREP_PG_SSL_ROOT_CERT;
 Object.assign(childEnv,{PGDATABASE:env.DATABASE_URL,PGSSLMODE:sslMode,PGOPTIONS:'-c default_transaction_read_only=on',PGCONNECT_TIMEOUT:'5'});
 let result;try{result=executor(env.INFRA_PREP_PSQL_BIN||'psql',['-X','--no-password','-q','-t','-A','-v','ON_ERROR_STOP=1'],{input:READONLY_SQL,env:childEnv,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});}catch{return{exitCode:2,report:{mode:'executed',executed:true,readOnly:true,code:'postgres_readonly_probe_failed'}};}
 if(!result||result.error||result.status!==0)return{exitCode:2,report:{mode:'executed',executed:true,readOnly:true,code:'postgres_readonly_probe_failed'}};
 try{const lines=String(result.stdout).trim().split(/\r?\n/).filter(Boolean);if(lines.length!==1)throw Error('unexpected_output');const report=evaluateReadOnlyCatalog(JSON.parse(lines[0]),manifest);return{exitCode:report.schemaReady&&report.manifestCoverageReady!==false?0:2,report:{mode:'executed',executed:true,readOnly:true,...report}};}catch{return{exitCode:2,report:{mode:'executed',executed:true,readOnly:true,code:'postgres_catalog_output_invalid'}};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const result=runReadonly(process.argv.slice(2));console.log(JSON.stringify(result.report,null,2));process.exitCode=result.exitCode;}
export const READONLY_EXPECTED_COLUMNS=columns;
export const READONLY_EXPECTED_INDEXES=indexes;
