import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const realRequire=createRequire(import.meta.url);
function fixture(failure?:number){
 const cells:any[]=[],exports:any={};let cursor=0,calls=0,identity='same-user';const results:any[]=[];
 let form:any={name:'已确认的计划',video:'已选视频',goal:'提升有效视频观看',market:'美国',budget:'100',currency:'USD',channels:['Facebook'],configuration:{accountConnectionId:'account',materialSource:{name:'视频'},countries:['US'],adMessage:'已确认文案',dailyBudget:10,startsAt:'2026-10-28T09:00',endsAt:'2026-10-29T09:00'}};
 const cell=()=>cells[cursor++]??(cells[cursor-1]={});
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./AdPlanConversationCreate.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,Date,URL,console,window:{location:{href:'http://localhost/?page=strategy'}},
  require(name:string){
   if(name==='react')return {useState:(initial:any)=>{const c=cell();if(!('value'in c))c.value=typeof initial==='function'?initial():initial;return[c.value,(v:any)=>c.value=typeof v==='function'?v(c.value):v];},useRef:(initial:any)=>{const c=cell();return c.ref??=( {current:initial});},useEffect:()=>{}};
   if(name==='react/jsx-runtime')return realRequire(name);
   if(name==='antd')return Object.fromEntries(['Alert','Button','Descriptions','Input','InputNumber','Select'].map(x=>[x,x==='Input'?Object.assign(()=>null,{TextArea:'TextArea'}):x]));
   if(name.includes('platformAds'))return {platformAdsApi:{generatePlan:async(body:any)=>{calls++;assert.equal(body.configuration.accountConnectionId,'account');if(failure)throw Object.assign(Error('not saved'),{status:failure});return {...body,id:'created-task',budget:100,version:1};}}};
   if(name.includes('productionNavigation'))return {productionNavigationIdentity:()=>identity};
   if(name.includes('metaMessageChoice'))return {adMarketSummary:()=> '美国'};
   if(name.includes('metaAdJourney'))return {metaNeedsWebsite:()=>false};
   if(name.includes('metaAdObjectives'))return {META_AD_GOALS:['提升有效视频观看']};
   if(name.includes('MetaLeadFields'))return {default:'MetaLeadFields',emptyMetaLeadFields:{}};
   return {default:name.split('/').at(-1),MetaPageSelect:'MetaPageSelect'};
  },
 });
 const render=()=>{cursor=0;return exports.default({value:form,onChange:(v:any)=>{form=typeof v==='function'?v(form):v;},onSaved:()=>{},onBusy:()=>{},onManual:()=>{},onDone:(v:any)=>results.push(v),saveOnly:true});};
 const buttons=(node:any):any[]=>!node||typeof node!=='object'?[]:[...(node.type==='Button'?[node]:[]),...[node.props?.children].flat(5).flatMap(buttons)];
 const find=(label:string)=>buttons(render()).find(b=>b.props.children===label);
 return {find,render,calls:()=>calls,results,setIdentity:(v:string)=>identity=v,async create(){for(let i=0;i<5;i++){const next=find('确认，继续');assert.equal(next.props.disabled,false);next.props.onClick();assert.equal(calls,0,'no plan is created during the question steps');}const save=find('创建一条新计划');assert.equal(save.props.color,'blue');save.props.onClick();for(let i=0;i<12;i++)await Promise.resolve();}};
}
test('five sequential confirmations precede one explicit create call and success requires the saved task',async()=>{const f=fixture();await f.create();assert.equal(f.calls(),1);assert.equal(f.results[0].id,'created-task');});
test('unknown create outcomes never announce success or allow an immediate duplicate create',async()=>{const f=fixture(503);await f.create();assert.equal(f.calls(),1);assert.equal(f.results.length,0);assert.equal(f.find('创建一条新计划').props.disabled,true);});
