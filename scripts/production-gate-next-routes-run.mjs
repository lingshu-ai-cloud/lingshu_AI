import{spawnSync,execFileSync}from'node:child_process';
import{readFileSync,writeFileSync,mkdirSync,existsSync,rmSync}from'node:fs';
import{createHash}from'node:crypto';
import path from'node:path';
import{sourceHashes,sourceDrift}from'./production-gate-next-source-snapshot.mjs';
const files=['server/routes/weeklyInitialSchedule.integration.test.ts','server/routes/weeklyContentNavigation.integration.test.ts','server/routes/weeklyPreArtifactNavigation.integration.test.ts','server/routes/socialPrograms.weeklyCreativeRepairExecutionMount.test.ts'];
const output='work/production-gate-next-validation/routes';mkdirSync(output,{recursive:true});
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const report={scope:'Isolated Express routes with memory stores and injected publishing ports; no real providers/workers',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashesBefore:sourceHashes(),results:[]};
for(const file of files){const name=path.basename(file),evidence=path.resolve(`${output}/${name}.network.json`),before=hash(file);rmSync(evidence,{force:true});
 // Intentionally do not inherit NODE_OPTIONS, dotenv configuration, provider credentials or backend URLs.
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'test',DATA_BACKEND:'pocketbase',QUEUE_BACKEND:'local',DISABLE_LOCAL_AUTH_FALLBACK:'true',ENABLE_LOCAL_DEV_FALLBACK:'false',NEXT_AUDIT_NETWORK_EVIDENCE:evidence};
 const args=['--import',path.resolve('scripts/production-gate-next-loopback-guard.mjs'),'--import','tsx',file];const run=spawnSync(process.execPath,args,{cwd:process.cwd(),env,encoding:'utf8',timeout:60000});
 const log=(run.stdout||'')+'\n'+(run.stderr||'');writeFileSync(`${output}/${name}.log`,log);const observed=existsSync(evidence),network=observed?JSON.parse(readFileSync(evidence,'utf8')):{events:[]};
 const after=hash(file);const passed=run.status===0&&!run.error&&observed&&before===after&&!network.events.some(e=>e.type==='blocked');
 const result={file,command:[process.execPath,...args],exitCode:run.status,error:run.error?.message||null,tests:Number(log.match(/(?:#|ℹ) tests (\d+)/)?.[1]||0),pass:Number(log.match(/(?:#|ℹ) pass (\d+)/)?.[1]||0),fail:Number(log.match(/(?:#|ℹ) fail (\d+)/)?.[1]||0),passed,sourceBefore:before,sourceAfter:after,networkEvidenceObserved:observed,network};report.results.push(result);console.log(`${passed?'PASS':'FAIL'} ${file} exit ${run.status}`);if(!passed)console.log(log.slice(-1600));
}
report.sourceHashesAfter=sourceHashes();report.sourceDrift=sourceDrift(report.sourceHashesBefore,report.sourceHashesAfter);report.sourceUnchanged=report.sourceDrift.length===0;
report.actualTestCount=report.results.reduce((n,r)=>n+r.tests,0);report.passed=report.sourceUnchanged&&report.results.every(r=>r.passed);if(!report.sourceUnchanged)console.log('FAIL source drift',JSON.stringify(report.sourceDrift));writeFileSync(`${output}/results.json`,JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
