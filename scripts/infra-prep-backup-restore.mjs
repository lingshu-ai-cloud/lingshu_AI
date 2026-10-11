import {readFileSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function validateBackupManifest(value){
 if(!value||value.schemaVersion!=='infra-backup.v1'||!value.cutoverId||!Number.isFinite(Date.parse(value.createdAt))||!value.sourceCommit)throw Error('backup_manifest_invalid');
 for(const name of ['postgres','redis']){const item=value[name];if(!item||typeof item.artifact!=='string'||!item.artifact||!(/^[a-f0-9]{64}$/i.test(item.sha256??''))||typeof item.version!=='string'||!item.version)throw Error(`backup_manifest_${name}_invalid`);}
 if(!['pre-cutover','post-cutover'].includes(value.cutoverPhase)||typeof value.postBackupWrites!=='boolean'||typeof value.consistentRecoveryPoint!=='boolean')throw Error('backup_manifest_cutover_evidence_missing');
 if(!Array.isArray(value.activeJobIds)||!Array.isArray(value.unknownAttemptIds)||typeof value.admissionStopped!=='boolean')throw Error('backup_manifest_runtime_evidence_missing');
 return {cutoverId:value.cutoverId,sourceCommit:value.sourceCommit,eligibility:'preliminary',restoreEligible:value.admissionStopped&&value.activeJobIds.length===0&&value.unknownAttemptIds.length===0&&value.cutoverPhase==='pre-cutover'&&value.postBackupWrites===false&&value.consistentRecoveryPoint===true};
}
function endpoint(raw,protocols,label){let url;try{url=new URL(raw);}catch{throw Error(`${label}_url_invalid`);}if(!protocols.includes(url.protocol)||!url.hostname||!url.password||url.hash||[url.username,url.password,url.pathname].some(v=>v.includes('REPLACE_')))throw Error(`${label}_credentials_or_endpoint_missing`);return url;}
export function backupPrecheckPlan({execute=false,env={},manifest}={}){
 const evidence=manifest?validateBackupManifest(manifest):null;
 if(!execute)return {mode:'dry-run',commands:['psql: server version + lease index catalog (SELECT only)','redis-cli: PING + INFO persistence + INFO server'],manifest:evidence,mutations:0,connect:false};
 const pg=endpoint(env.DATABASE_URL,['postgres:','postgresql:'],'postgres');
 if(!pg.username||!pg.pathname.slice(1))throw Error('postgres_user_database_required');const ssl=env.DATABASE_SSL_MODE;if(!['require','verify-full'].includes(ssl))throw Error('postgres_ssl_mode_required');if(pg.searchParams.has('sslmode')&&pg.searchParams.get('sslmode')!==ssl)throw Error('postgres_ssl_mode_conflict');
 const redis=endpoint(env.REDIS_URL,['redis:','rediss:'],'redis');
 if(redis.pathname&&!/^\/\d*$/.test(redis.pathname))throw Error('redis_database_invalid');
 if(!manifest)throw Error('backup_manifest_required');
 return {mode:'read-only-precheck',pg,redis,manifest:evidence};
}
export async function verifyBackupArtifacts(manifest){for(const name of ['postgres','redis']){const hash=createHash('sha256');try{for await(const chunk of createReadStream(manifest[name].artifact))hash.update(chunk);}catch{throw Error(`backup_artifact_${name}_unreadable`);}if(hash.digest('hex')!==manifest[name].sha256.toLowerCase())throw Error(`backup_artifact_${name}_hash_mismatch`);}}
const leaseQuery="SELECT current_setting('server_version'); SELECT i.indisvalid AND i.indisready AND i.indisunique, pg_get_indexdef(i.indexrelid), pg_get_expr(i.indpred,i.indrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='idx_lingshu_durable_operation_lease_subject';";
export async function runBackupPrecheck(input={},runner=runCommand){
 const plan=backupPrecheckPlan(input);if(plan.mode==='dry-run')return plan;
 await (input.verifyArtifacts??verifyBackupArtifacts)(input.manifest);const pg=plan.pg,r=plan.redis;
 const commands=[
 {bin:'psql',args:['--no-psqlrc','--no-password','--set=ON_ERROR_STOP=1','--tuples-only','--command',leaseQuery],env:{PATH:input.env.PATH||process.env.PATH,PGHOST:pg.hostname,PGPORT:pg.port||'5432',PGUSER:decodeURIComponent(pg.username),PGPASSWORD:decodeURIComponent(pg.password),PGDATABASE:decodeURIComponent(pg.pathname.slice(1)),PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=5000',PGSSLMODE:input.env.DATABASE_SSL_MODE}},
 ...[['PING'],['INFO','persistence'],['INFO','server']].map(command=>({bin:'redis-cli',args:['--no-auth-warning','--raw','-h',r.hostname,'-p',r.port||'6379','-n',r.pathname.slice(1)||'0',...(r.username?['--user',decodeURIComponent(r.username)]:[]),...(r.protocol==='rediss:'?['--tls']:[]),...command],env:{PATH:input.env.PATH||process.env.PATH,REDISCLI_AUTH:decodeURIComponent(r.password)}}))];
 for(let index=0;index<commands.length;index++){let result;try{result=await runner(commands[index]);}catch{throw Error(`backup_precheck_step_${index+1}_failed`);}if(result.code!==0)throw Error(`backup_precheck_step_${index+1}_failed`);const output=String(result.stdout??'');if(index===0&&(!output.includes('idx_lingshu_durable_operation_lease_subject')||!/\bt\b/.test(output)))throw Error('backup_precheck_postgres_metadata_incomplete');if(index===0&&output.trim().split(/\s+/)[0].split('.')[0]!==input.manifest.postgres.version.split('.')[0])throw Error('backup_precheck_postgres_version_mismatch');if(index===1&&output.trim()!=='PONG')throw Error('backup_precheck_redis_ping_failed');if(index===2&&(!output.includes('loading:0')||!output.includes('rdb_last_bgsave_status:ok')||output.includes('aof_last_write_status:err')))throw Error('backup_precheck_redis_persistence_unhealthy');if(index===3&&!/redis_version:\d/.test(output))throw Error('backup_precheck_redis_version_missing');if(index===3&&output.match(/redis_version:(\d+)/)?.[1]!==input.manifest.redis.version.split('.')[0])throw Error('backup_precheck_redis_version_mismatch');}
 return {mode:plan.mode,steps:commands.length,manifest:plan.manifest,mutations:0,restored:false,backupCreated:false};
}
export function runCommand({bin,args,env}){return new Promise((resolve,reject)=>{const child=spawn(bin,args,{env,stdio:['ignore','pipe','pipe']});let stdout='';child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>65536)child.kill();});child.stderr.resume();const timer=setTimeout(()=>child.kill(),10000);child.on('error',()=>{clearTimeout(timer);reject(Error('command_failed'));});child.on('close',code=>{clearTimeout(timer);resolve({code,stdout});});});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const args=process.argv.slice(2);for(const arg of args)if(arg!=='--execute-read-only'&&!arg.startsWith('--manifest='))throw Error('unsupported_argument');const file=args.find(a=>a.startsWith('--manifest='))?.slice(11);const manifest=file?JSON.parse(readFileSync(file,'utf8')):undefined;console.log(JSON.stringify(await runBackupPrecheck({execute:args.includes('--execute-read-only'),env:process.env,manifest}),null,2));}catch(error){console.error(/^[a-z0-9_]+$/.test(String(error.message))?error.message:'backup_precheck_failed');process.exitCode=1;}}
