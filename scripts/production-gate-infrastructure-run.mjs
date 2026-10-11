import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
const checks=[
 ['Actual DATA_BACKEND routing with injected stores','scripts/production-gate-infrastructure-backend.test.ts'],
 ['DATA_BACKEND SQL contract','server/storage/postgres.test.ts'],
 ['Postgres cutover routing source contract','server/storage/postgresCutover.contract.test.ts'],
 ['Atomic publication catalog proof','server/publishing/publicationAtomicStore.test.ts'],
 ['Durable lease lifecycle memory model','server/runtime/durableLease.test.ts'],
 ['Direct publishing lease contention memory model','server/publishing/directPublishLease.test.ts'],
 ['BullMQ configuration and injected probe','server/queues/bullmq.test.ts'],
 ['Failclosed authentication HTTP/injected provider','server/middleware/authAvailability.test.ts'],
 ['Eight production configuration gates','server/socialPrograms/weeklyProductionEnvironmentReadiness.test.ts'],
 ['Infrastructure connection failclosed probes','server/socialPrograms/weeklyProductionEnvironmentProbe.test.ts'],
];
mkdirSync('work',{recursive:true});
const sources=['server/storage/index.ts','server/storage/postgres.ts','server/storage/pbStore.ts','server/runtime/durableLease.ts','server/publishing/publicationAtomicStore.ts','server/publishing/pendingPublishGuard.ts','server/queues/bullmq.ts','server/middleware/auth.ts','server/lib/localFallbackPolicy.ts','server/socialPrograms/weeklyProductionEnvironmentReadiness.ts','server/socialPrograms/weeklyProductionEnvironmentProbe.ts','scripts/production-gate-infrastructure-network.mjs'];
const hashes=()=>Object.fromEntries(sources.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
const evidence={scope:'isolated_contracts_only',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashesBefore:hashes(),actualPostgresVerified:false,actualRedisVerified:false,results:[]};
for(const [label,file] of checks){const network=path.resolve(`work/production-gate-infrastructure-${path.basename(file)}.network.json`),env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'test',DATA_BACKEND:'pocketbase',QUEUE_BACKEND:'local',DISABLE_LOCAL_AUTH_FALLBACK:'true',ENABLE_LOCAL_DEV_FALLBACK:'false',INFRA_EVIDENCE_PATH:network};
 rmSync(network,{force:true});
 const command=[process.execPath,'--import',path.resolve('scripts/production-gate-infrastructure-network.mjs'),'--import','tsx',file];
 let status=0,output='';try{output=execFileSync(command[0],command.slice(1),{env,cwd:process.cwd(),timeout:60000,encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(error){status=error.status??1;output=String(error.stdout??'')+String(error.stderr??'');}
 const networkEvidenceObserved=existsSync(network);
 const sockets=networkEvidenceObserved?JSON.parse(readFileSync(network,'utf8')):{events:[]};
 if(!networkEvidenceObserved&&status===0)status=1;
 const blocked=sockets.events.filter(e=>e.type==='blocked_socket');if(blocked.length&&status===0)status=1;
 const result={label,file,command:command.slice(1).join(' '),status,output,networkEvidenceObserved,network:sockets,sourceHash:createHash('sha256').update(readFileSync(file)).digest('hex')};evidence.results.push(result);console.log(`${status===0?'PASS':'FAIL'} ${label}: exit ${status}`);if(status)console.log(output.slice(-2000));
}
evidence.sourceHashesAfter=hashes();
evidence.sourceHashesUnchanged=JSON.stringify(evidence.sourceHashesBefore)===JSON.stringify(evidence.sourceHashesAfter);
writeFileSync('work/production-gate-infrastructure-evidence.json',JSON.stringify(evidence,null,2));
if(!evidence.sourceHashesUnchanged||evidence.results.some(r=>r.status!==0))process.exitCode=1;
