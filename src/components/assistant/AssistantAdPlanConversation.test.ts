import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const realRequire=createRequire(import.meta.url);
function fixture(createdTaskId?:string){
 const cells:any[]=[],effects:Array<()=>void>=[],exports:any={};let cursor=0;
 const request={sceneId:'AD-02',...(createdTaskId?{createdTaskId}:{})};
 let thread:any={conversationKey:'original',messages:[{role:'assistant',content:'逐项确认',businessScenePrompt:request}]};
 const store={threads:{business:thread},setMessages:(_id:string,messages:any[])=>{thread.messages=messages;}};
 const cell=()=>cells[cursor++]??(cells[cursor-1]={});
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./AssistantAdPlanConversation.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,Error,require(name:string){
   if(name==='react')return {useState:(initial:any)=>{const c=cell();if(!('value'in c))c.value=typeof initial==='function'?initial():initial;return[c.value,(v:any)=>c.value=typeof v==='function'?v(c.value):v];},useRef:(initial:any)=>{const c=cell();return c.ref??={current:initial};},useEffect:(fn:any)=>effects.push(fn)};
   if(name==='react/jsx-runtime')return realRequire(name);
   if(name==='antd')return {Alert:'Alert',Button:'Button',Spin:'Spin'};
   if(name.includes('platformAdsDomain'))return {emptyAdPlanConfiguration:{}};
   if(name.includes('platformAds'))return {platformAdsApi:{getTask:async(id:string)=>({id,name:'原计划'})}};
   if(name.includes('productionNavigation'))return {productionNavigationIdentity:()=> 'identity'};
   if(name.includes('assistantStore'))return {useAssistantStore:{getState:()=>store}};
   if(name.includes('globalAssistantRuntime'))return {PRIMARY_ASSISTANT_THREAD:'business'};
   if(name.includes('AdAccountDirectory'))return {AdAccountDirectoryProvider:'Provider'};
   return {default:name.split('/').at(-1)};
  },
 });
 const render=()=>{cursor=0;effects.length=0;return exports.default({request});};
 const nodes=(n:any):any[]=>!n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(5).flatMap(nodes)];
 return {render,thread,find:(name:string)=>nodes(render()).find(n=>n.type===name),effects,async flush(){for(const effect of effects)effect();for(let i=0;i<8;i++)await Promise.resolve();}};
}
test('only the saved-task callback announces success and binds the plan to the current message',()=>{
 const f=fixture();const form=f.find('AdPlanConversationCreate');assert.equal(form.props.saveOnly,true);
 assert.equal(f.thread.messages[0].content,'逐项确认');
 form.props.onDone({id:'real-saved-id',name:'新计划'});
 assert.equal(f.thread.messages[0].content,'恭喜计划创建成功。');
 assert.equal(f.thread.messages[0].businessScenePrompt.createdTaskId,'real-saved-id');
 assert.equal(f.find('AssistantNavigationPortalCard').props.portal.page,'adsPlans');
});
test('a refreshed success message reads its existing plan rather than starting another creation',async()=>{
 const f=fixture('original-task');f.render();await f.flush();
 assert.equal(f.find('AdPlanConversationCreate'),undefined);
 assert.match(f.find('AssistantNavigationPortalCard').props.portal.description,/原计划/);
});
test('late creation responses do not overwrite a different conversation',()=>{
 const f=fixture();const done=f.find('AdPlanConversationCreate').props.onDone;
 f.thread.conversationKey='another';done({id:'saved-id',name:'新计划'});
 assert.equal(f.thread.messages[0].content,'逐项确认');
});
