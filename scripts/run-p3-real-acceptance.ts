import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createP3LedgerEntry, p3RuntimeConfigurationProbe, verifyP3RealAcceptance, type P3AcceptanceManifest } from '../server/runtime/p3RealAcceptance.js';
import { digitalHumanQualityRuntimeReadiness } from '../server/runtime/readiness.js';

const args=process.argv.slice(2), command=args[0]||'probe';
const envFileIndex=args.indexOf('--env-file');
if(envFileIndex>=0){
  const source=await readFile(resolve(args[envFileIndex+1]||''),'utf8');
  for(const line of source.split(/\r?\n/)){
    const match=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(!match||process.env[match[1]]!==undefined)continue;
    process.env[match[1]]=match[2]!.trim().replace(/^(?:"(.*)"|'(.*)')$/,'$1$2');
  }
}
if(command==='probe'){
  const quality=await digitalHumanQualityRuntimeReadiness(process.env);
  const output=p3RuntimeConfigurationProbe(process.env,quality); console.log(JSON.stringify(output,null,2)); if(!output.ready)process.exitCode=2;
}else if(command==='verify'){
  const manifestPath=args[1]; if(!manifestPath)throw Error('usage: verify <manifest.json> [ledger.jsonl]');
  const manifest=JSON.parse(await readFile(resolve(manifestPath),'utf8')) as P3AcceptanceManifest;
  const result=await verifyP3RealAcceptance(manifest); console.log(JSON.stringify(result,null,2));
  if(!result.accepted)process.exitCode=1; else if(args[2]){
    const ledger=resolve(args[2]); let prior:string|null=null; try{const rows=(await readFile(ledger,'utf8')).trim().split('\n').filter(Boolean);if(rows.length)prior=JSON.parse(rows.at(-1)!).entryHash;}catch{}
    const entry=createP3LedgerEntry(manifest,prior);await appendFile(ledger,`${JSON.stringify(entry)}\n`,{encoding:'utf8',mode:0o600});console.log(JSON.stringify({recorded:true,entryHash:entry.entryHash},null,2));
  }
}else throw Error(`unknown command: ${command}`);
