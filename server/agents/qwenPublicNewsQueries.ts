import {qwenDiscoveryQuery} from './qwenDiscoveryQuery.js';
import {industryInsightScope} from '../externalInformation/industryInsightReport.js';
/** One geographically unrestricted industry query plus one merchant-market query. Neither is evidence or full-web coverage. */
export function qwenPublicNewsQueries(question:string,days?:number,supplementInstruction?:string):string[] {
 if(!/今日资讯/u.test(question)) {
  const prompt=qwenDiscoveryQuery(question,days,supplementInstruction);
  const queries=prompt.split('\n').filter(line=>/^\d\. /u.test(line)).map(line=>line.replace(/^\d\. /u,''));
  const {market}=industryInsightScope(question);
  const {industry}=industryInsightScope(question);
  if (/^(?:中国|China)$/iu.test(market.trim()) && /美妆|化妆品|护肤|个护/u.test(industry)) {
   return ['中国 化妆品', '中国 美妆 原料'];
  }
  if (/^(?:全球|global)$/iu.test(market.trim()) && queries[0]) {
   // RSS handles freshness separately; query prose and a literal global token can starve discovery.
   const topic=queries[0].replace(/^global\s+/iu,'').split(/\s+(?:product launch market news|supply chain pricing|manufacturing capacity partnerships|research technology regulation|regulation standards|research technology|market competition|manufacturing supply chain partnerships)\b/iu)[0].replace(/\bcosmetics\s+(?=cosmetic ingredients\b)/iu,'').trim();
   if (topic) return [`${topic} innovation`,topic];
  }
  return queries;
 }
 const {industry}=industryInsightScope(question);
 const keywords:Array<[RegExp,string]>=[
  [/美妆|化妆品|护肤|个护|cosmetic|skincare|personal care/iu,'skincare'],
  [/家具|家居|furniture/iu,'家具 OR furniture'],[/服装|apparel/iu,'服装 OR apparel'],[/纺织|textile/iu,'纺织 OR textiles'],
  [/机械|machinery/iu,'机械 OR machinery'],[/电子|electronics/iu,'电子 OR electronics'],[/食品|food/iu,'食品 OR food'],
 ];
 const wide=keywords.find(([pattern])=>pattern.test(industry))?.[1] || industry.trim().slice(0,100);
 const prompt=qwenDiscoveryQuery(question,days);
 const first=prompt.split('\n').find(line=>/^1\. /u.test(line))?.replace(/^1\. /u,'') || '';
 let market=first.split(/\s+(?:product launch market news|supply chain pricing)\b/u)[0].trim();
 if(/region=North America \(US, Canada\)/u.test(prompt))market=market.replace(/^United States\b/u,'(United States OR Canada)');
 return [...new Set([wide,market].filter(Boolean))].slice(0,2);
}
