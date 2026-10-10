import { createHash } from 'node:crypto';
export type InitialPreparationSource={key:string;platform:'youtube'|'tiktok'|'instagram'|'facebook';mode:'keyword'|'account';value:string;origin:'external'|'owned';jobId?:string};
export type InitialPreparation={requestId:string;goalId:string;revision:number;confirmedBy:string;confirmedAt:string;status:'collecting'|'analyzing'|'preparing'|'running'|'blocked';sources:InitialPreparationSource[];candidateIds:string[];reason:string;runId?:string};
export function initialPreparationSources(input:{platforms:unknown;products:unknown;historyAccounts?:unknown;stage?:unknown;historyCollectionRequestId?:unknown}):InitialPreparationSource[]{
 const platforms=Array.isArray(input.platforms)?input.platforms.filter((p):p is InitialPreparationSource['platform']=>['youtube','tiktok','instagram','facebook'].includes(String(p))):[];
 const products=Array.isArray(input.products)?input.products.map(String).map(x=>x.trim()).filter(Boolean):[];
 if(!platforms.length||!products.length)throw Error('initial_preparation_scope_required');
 const sources:InitialPreparationSource[]=platforms.map(platform=>({key:`external:${platform}`,platform,mode:'keyword',value:products.join(' '),origin:'external'}));
 if(input.stage==='b2b_growth'&&Array.isArray(input.historyAccounts))for(const raw of input.historyAccounts){const url=new URL(String(raw));const platform=platforms.find(p=>url.hostname===`${p}.com`||url.hostname.endsWith(`.${p}.com`));if(url.protocol!=='https:'||!platform)throw Error('initial_history_account_invalid');sources.push({key:`owned:${String(input.historyCollectionRequestId||"default")}:${platform}:${url.href}`,platform,mode:'account',value:url.href,origin:'owned'});}
 return [...new Map(sources.map(s=>[s.key,s])).values()];
}
export function initialPreparationJobKey(tenantId:string,state:InitialPreparation,source:InitialPreparationSource){return createHash('sha256').update(JSON.stringify(source.origin==='owned'?[tenantId,'history',source.key]:[tenantId,state.goalId,state.requestId,source.key])).digest('hex').slice(0,15);}
export async function advanceInitialPreparation(state:InitialPreparation,ports:{save:(state:InitialPreparation)=>Promise<void>;enqueue:(source:InitialPreparationSource)=>Promise<string>;observe:(id:string)=>Promise<{status:string;candidateIds:string[];error?:string}>;analyzed:(ids:string[])=>Promise<boolean>;prepare:(ids:string[])=>Promise<{ready:boolean;reason?:string;revision:number}>;activate:(revision:number)=>Promise<string>}):Promise<InitialPreparation>{
 if(state.status==='running')return state;
 const current=structuredClone(state);current.reason='';
 try{
  for(const source of current.sources)if(!source.jobId){source.jobId=await ports.enqueue(source);await ports.save(current);}
  const observations=await Promise.all(current.sources.map(source=>ports.observe(source.jobId!)));
  const failed=observations.find(o=>o.status==='failed');if(failed)throw Error(failed.error||'真实采集失败');
  if(observations.some(o=>!['done','completed'].includes(o.status))){current.status='collecting';await ports.save(current);return current;}
  if(observations.some(o=>!o.candidateIds.length))throw Error('采集未取得真实候选，请调整账号或关键词后重新确认计划');
  current.candidateIds=[...new Set(observations.flatMap(o=>o.candidateIds))];
  if(!await ports.analyzed(current.candidateIds)){current.status='analyzing';await ports.save(current);return current;}
  current.status='preparing';await ports.save(current);
  const prepared=await ports.prepare(current.candidateIds);if(!prepared.ready)throw Error(prepared.reason||'制作输入尚未就绪');
  current.revision=prepared.revision;await ports.save(current);
  current.runId=await ports.activate(prepared.revision);current.status='running';await ports.save(current);return current;
 }catch(error){current.status='blocked';current.reason=error instanceof Error?error.message:'初始化准备失败';await ports.save(current);return current;}
}
