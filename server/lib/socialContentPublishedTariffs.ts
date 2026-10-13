import {createHash} from 'node:crypto';
import type {SocialPaidOperationIntent,SocialVerifiedAccountTariff} from './socialContentTaskBudgetAuthority.js';
export interface PublishedPricingEvidence {
 schemaVersion:1;basis:'published_undiscounted_ceiling';provider:'qwen';model:string;region:'cn-beijing';accountRef:string;
 sourceUrl:string;sourceBody:string;sourceResponseSha256:string;sourceContentSha256:string;checkedAt:string;validUntil:string;providerBinding:{baseUrl:string;credentialSha256:string};
 inputPriceCnyPerMillion:number;outputPriceCnyPerMillion:number;
}
export type PublishedAccountTariff=SocialVerifiedAccountTariff&{pricingBasis:'published_undiscounted_ceiling';publicPricingEvidence:PublishedPricingEvidence};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
/**
 * Published prices are copied into the tenant's durable tariff catalogue and
 * used as a conservative ceiling. Production must not depend on reloading the
 * vendor documentation for every film. Ninety days keeps the catalogue useful
 * across normal production while still requiring periodic evidence refresh.
 */
export const QWEN_PUBLISHED_TARIFF_VALIDITY_MS=90*24*3600000;
const text=(s:string)=>s.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,'').trim();
const valid=(n:number)=>Number.isFinite(n)&&n>0;
/** Parse the official model page's JSON data, never execute vendor scripts.
 * Region is selected inside the model-price section; cache/batch/free prices
 * are never accepted as standard online inference prices. */
export function parseOfficialQwenPublishedPrices(body:string,model:string){
 if(body.length>5*1024*1024)return null;
 const match=body.match(/window\.__ICE_PAGE_PROPS__=(\{[\s\S]*?\});/);if(!match)return null;
 let row:Record<string,unknown>;try{row=JSON.parse(match[1]!).docDetailData.storeData.data;}catch{return null;}
 if(row.title!==model||row.alias!==`/model-studio/${model}`||row.website!=='cn'||row.language!=='zh'||typeof row.content!=='string')return null;
 const content=row.content,priceStart=content.search(/<h2[^>]*>模型价格\b|<h2[^>]*>模型价格\s/);if(priceStart<0)return null;
 const after=content.slice(priceStart),next=after.indexOf('<h2',4),prices=next<0?after:after.slice(0,next);
 const start=prices.search(/<section\b[^>]*id="华北2-北京(?:-\d+)?"/);if(start<0)return null;
 const tags=/<\/?section\b[^>]*>/g;tags.lastIndex=start;let depth=0,end=-1;
 for(let token=tags.exec(prices);token;token=tags.exec(prices)){if(token[0].startsWith('</'))depth--;else depth++;if(depth===0){end=tags.lastIndex;break;}}
 if(end<0)return null;const region=prices.slice(start,end);
 const inputs:number[]=[],outputs:number[]=[];
 for(const table of region.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)){
  const html=table[1]!;const headers=[...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(m=>text(m[1]!));
  if(headers.join('|')!=='计费项|价格（元）|单位'){if(headers.includes('计费项'))return null;continue;}
  for(const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)){
   const cells=[...tr[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m=>text(m[1]!));
   if(cells.length!==3||!['输入','输出'].includes(cells[0]!)||!/^每百万tokens$/i.test(cells[2]!))continue;
   if(!/^\d+(?:\.\d+)?$/.test(cells[1]!))return null;const amount=Number(cells[1]);if(!valid(amount))return null;(cells[0]==='输入'?inputs:outputs).push(amount);
  }
 }
 if(!inputs.length||inputs.length!==outputs.length)return null;
 return {inputPriceCnyPerMillion:Math.max(...inputs),outputPriceCnyPerMillion:Math.max(...outputs),sourceContentSha256:sha(content)};
}
/** Re-parse the actual public document; a caller flag or numeric env estimate
 * cannot qualify as published account-bound evidence. */
export function isVerifiedPublishedTariff(t:SocialVerifiedAccountTariff):boolean{
 try{
 const p=t as PublishedAccountTariff,e=p.publicPricingEvidence;if(!/^qwen3-vl-(?:flash|plus)$|^qwen-vl-max$/.test(p.model)||p.pricingBasis!=='published_undiscounted_ceiling'||p.verifiedAccountPrice!==false||p.currency!=='CNY'||!e||e.schemaVersion!==1||e.basis!==p.pricingBasis||e.provider!==p.provider||e.model!==p.model||e.accountRef!==p.accountRef||e.region!=='cn-beijing'||e.checkedAt!==p.checkedAt||e.validUntil!==p.validUntil||e.sourceUrl!==`https://help.aliyun.com/zh/model-studio/${p.model}`||sha(e.sourceBody)!==e.sourceResponseSha256||!e.providerBinding)return false;
 const b=e.providerBinding,u=new URL(b.baseUrl);if(u.protocol!=='https:'||u.hostname!=='dashscope.aliyuncs.com'||u.pathname.replace(/\/+$/,'')!=='/compatible-mode/v1'||u.username||u.password||u.search||u.hash||! /^[a-f0-9]{64}$/.test(b.credentialSha256))return false;
 const account=`qwen:${sha(JSON.stringify({baseUrl:b.baseUrl.replace(/\/+$/,''),credentialSha256:b.credentialSha256}))}`;if(account!==p.accountRef)return false;
 const parsed=parseOfficialQwenPublishedPrices(e.sourceBody,p.model);if(!parsed||parsed.sourceContentSha256!==e.sourceContentSha256||parsed.inputPriceCnyPerMillion!==e.inputPriceCnyPerMillion||parsed.outputPriceCnyPerMillion!==e.outputPriceCnyPerMillion||p.evidenceRef!==`official-public-tariff:${sha(JSON.stringify(e))}`||Date.parse(e.validUntil)-Date.parse(e.checkedAt)>QWEN_PUBLISHED_TARIFF_VALIDITY_MS)return false;
 if(Object.keys(p.meters).sort().join(',')!=='inputTokens,outputTokens')return false;
 return ['inputTokens','outputTokens'].every(unit=>{const m=p.meters[unit];return m&&m.priceCny===(unit==='inputTokens'?e.inputPriceCnyPerMillion:e.outputPriceCnyPerMillion)&&m.unitsPerPrice===1000000&&m.minimumUnits===0&&m.increment===1;});
 }catch{return false;}
}
export function createSocialContentPublishedTariffReader(ports:{
 readProviderBinding(intent:SocialPaidOperationIntent):Promise<{provider:string;model:string;baseUrl:string;credentialSha256:string}|null>;
 fetchOfficial?:(url:string)=>Promise<{url:string;status:number;body:string}>;now?:()=>Date;
}){
 const fetchOfficial=ports.fetchOfficial||(async function(url:string){const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});const reader=response.body?.getReader();if(!reader)return{url:response.url,status:response.status,body:''};const chunks:Uint8Array[]=[];let bytes=0;for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>5*1024*1024){await reader.cancel();throw new Error('official_pricing_document_too_large');}chunks.push(part.value);}const body=Buffer.concat(chunks).toString('utf8');return{url:response.url,status:response.status,body};});
 return {async read(intent:SocialPaidOperationIntent):Promise<PublishedAccountTariff|null>{
  const binding=await ports.readProviderBinding(intent);if(!binding||binding.provider!=='qwen'||intent.provider!=='qwen'||binding.model!==intent.model||!/^[a-f0-9]{64}$/.test(binding.credentialSha256))return null;
  let api:URL;try{api=new URL(binding.baseUrl);}catch{return null;}
  if(api.protocol!=='https:'||api.hostname!=='dashscope.aliyuncs.com'||api.pathname.replace(/\/+$/,'')!=='/compatible-mode/v1'||api.username||api.password||api.search||api.hash)return null;
  const accountRef=`qwen:${sha(JSON.stringify({baseUrl:binding.baseUrl.replace(/\/+$/,''),credentialSha256:binding.credentialSha256},Object.keys({baseUrl:'',credentialSha256:''}).sort()))}`;
  if(accountRef!==intent.accountRef||!/^qwen3-vl-(?:flash|plus)$|^qwen-vl-max$/.test(intent.model)||Object.keys(intent.maximumUnits).sort().join(',')!=='inputTokens,outputTokens')return null;
  const url=`https://help.aliyun.com/zh/model-studio/${intent.model}`;
  let source:{url:string;status:number;body:string};try{source=await fetchOfficial(url);}catch{return null;}
  if(source.url!==url||source.status!==200)return null;
  const extracted=parseOfficialQwenPublishedPrices(source.body,intent.model);if(!extracted)return null;
  const checkedAt=(ports.now?.()||new Date()).toISOString(),validUntil=new Date(Date.parse(checkedAt)+QWEN_PUBLISHED_TARIFF_VALIDITY_MS).toISOString();
  const evidence:PublishedPricingEvidence={schemaVersion:1,basis:'published_undiscounted_ceiling',provider:'qwen',model:intent.model,region:'cn-beijing',accountRef,sourceUrl:url,sourceBody:source.body,providerBinding:{baseUrl:binding.baseUrl,credentialSha256:binding.credentialSha256},sourceResponseSha256:sha(source.body),...extracted,checkedAt,validUntil};
  return{provider:intent.provider,model:intent.model,accountRef,stage:intent.stage,currency:'CNY',verifiedAccountPrice:false,pricingBasis:'published_undiscounted_ceiling',publicPricingEvidence:evidence,evidenceRef:`official-public-tariff:${sha(JSON.stringify(evidence))}`,checkedAt,validUntil,meters:{inputTokens:{priceCny:extracted.inputPriceCnyPerMillion,unitsPerPrice:1000000,minimumUnits:0,increment:1},outputTokens:{priceCny:extracted.outputPriceCnyPerMillion,unitsPerPrice:1000000,minimumUnits:0,increment:1}}};
 }};
}
