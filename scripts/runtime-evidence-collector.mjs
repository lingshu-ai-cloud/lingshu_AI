import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateScopeEvidence,validateWeeklyEvidence} from './runtime-evidence/scope.mjs';
import {validateWhatsAppEvidence,validateMessengerEvidence} from './runtime-evidence/customer.mjs';
import {validateInstagramEvidence,validatePublicationEvidence} from './runtime-evidence/provider.mjs';

const validators={tenantScope:validateScopeEvidence,weeklyPackage:validateWeeklyEvidence,whatsapp:validateWhatsAppEvidence,messenger:validateMessengerEvidence,instagram:validateInstagramEvidence,publication:validatePublicationEvidence};
const forbidden=/^(?:token|access[_-]?token|refresh[_-]?token|raw[_-]?token|client[_-]?secret|app[_-]?secret|secret|password|authorization|cookie|private[_-]?key|api[_-]?key|credential|credentials|encrypted[_-]?(?:token|secret))$/i;
const secretText=/(?:Bearer\s+\S+|-----BEGIN[^\n]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/;
function fail(code){throw Object.assign(new Error(code),{code});}
export function rejectSecrets(value,depth=0){
 if(depth>60)fail('input_nesting_limit');
 if(typeof value==='string'&&secretText.test(value))fail('secret_input_rejected');
 if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(forbidden.test(key))fail('secret_input_rejected');rejectSecrets(item,depth+1);}
}
const safeCode=code=>typeof code==='string'&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(code)?code:'validator_check';
function targetMatches(input,data,name){
 const target=input.expectedScope,scope=data.scope??data.expected;
 if(!target||typeof target.tenantId!=='string'||!target.tenantId||!scope||scope.tenantId!==target.tenantId)return false;
 const accountMapMatches=scope.accountVersions&&typeof scope.accountVersions==='object'&&!Array.isArray(scope.accountVersions)&&Object.keys(scope.accountVersions).length>0&&Object.keys(scope.accountVersions).length===Object.keys(target.accountVersions??{}).length&&Object.entries(scope.accountVersions).every(([id,v])=>v===target.accountVersions?.[id]);
 if(name==='weeklyPackage')return scope.programId===target.programId&&scope.packageId===target.packageId&&scope.packageVersion===target.packageVersion&&scope.programVersion===target.programVersion&&accountMapMatches;
 if(name==='tenantScope')return scope.programId===target.programId&&scope.programVersion===target.programVersion&&accountMapMatches;
 return scope.accountId&&Number.isSafeInteger(target.accountVersions?.[scope.accountId])&&(scope.accountVersion??scope.version)===target.accountVersions[scope.accountId];
}
/** Offline contract inspection only. No input identity, payload, token, error
 * message or validator summary is copied into the output. */
export async function collectDryRun(input,now=new Date()){
 rejectSecrets(input);
 if(!input||typeof input!=='object'||Array.isArray(input)||input.schemaVersion!=='runtime-evidence-input.v1'||!input.sections||typeof input.sections!=='object'||Array.isArray(input.sections))fail('input_schema_invalid');
 if(Object.keys(input.sections).some(key=>!Object.hasOwn(validators,key)))fail('unknown_evidence_section');
 const sections={};
 for(const [name,validate] of Object.entries(validators)){
  const data=input.sections[name];
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length===0){sections[name]={status:'missing',runtimeVerified:false,checks:[{code:'local_evidence_missing',passed:false}]};continue;}
  if(Object.keys(data).length&& !targetMatches(input,data,name)){sections[name]={status:'failed',runtimeVerified:false,checks:[{code:'collector_target_scope_mismatch',passed:false}]};continue;}
  try{
   const result=await validate({...data,dryRun:true,mode:'dry-run',now:now.toISOString()});
   const checks=Array.isArray(result?.checks)?result.checks.map(check=>({code:safeCode(check.code),passed:check.passed===true})):[];
   sections[name]={status:result?.status==='failed'?'failed':'unverified',runtimeVerified:false,checks};
  }catch{sections[name]={status:'failed',runtimeVerified:false,checks:[{code:'validator_rejected',passed:false}]};}
 }
 return {schemaVersion:'runtime-evidence-report.v1',mode:'dry-run',collectedAt:now.toISOString(),networkCalls:0,outboundEffects:0,runtimeVerified:false,sections};
}
export function renderReport(report){
 const rows=Object.entries(report.sections).map(([name,item])=>`| ${name} | ${item.status} | ${item.checks.filter(c=>c.passed).length}/${item.checks.length} | false |`);
 return ['# 真实运行证据 dry run 报告','','此报告只检查本地证据契约。真实运行验收未完成；没有网络调用、消息发送或发布。输入身份、recipient、原始回执与密钥不写入报告。','','| 证据类别 | 本地状态 | 校验通过数 | 真实运行已验真 |','| --- | --- | --- | --- |',...rows,'','## 验收记录','','- 可信只读来源与采集主体：待填','- 租户和账号版本复核：待填','- provider 原始回执及签名来源：待填','- 采集时间和有效期复核：待填','- 人工验收结论及阻塞项：待填',''].join('\n');
}
async function main(args){
 if(![4,6].includes(args.length)||args[0]!=='--input'||args[2]!=='--out'||args.length===6&&(args[4]!=='--section'||!Object.hasOwn(validators,args[5])))fail('usage_input_out_required');
 const raw=await readFile(resolve(args[1]));if(raw.length>5*1024*1024)fail('input_size_limit');
 let input;try{input=JSON.parse(raw.toString('utf8'));}catch{fail('input_json_invalid');}
 const report=await collectDryRun(input),directory=resolve(args[3]);
 if(args.length===6)report.sections={[args[5]]:report.sections[args[5]]};
 try{if((await lstat(directory)).isSymbolicLink())fail('output_symlink_rejected');}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(directory,{recursive:true,mode:0o700});
 await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 await writeFile(resolve(directory,'report.md'),renderReport(report),{mode:0o600,flag:'wx'});
 process.stdout.write('dry_run_report_written runtime_verified=false network_calls=0 outbound_effects=0\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{process.stderr.write(`${safeCode(error.code??'collector_failed')}\n`);process.exitCode=1;});
