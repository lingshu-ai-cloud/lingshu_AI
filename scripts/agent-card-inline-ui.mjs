import assert from 'node:assert/strict';
import {readFile,access,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer,transformWithEsbuild} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright-core';
import {program,pkg,tasks,inventoryRecord,scope,cross,exceptions,publication,natives,wa,mockRead} from './agent-card-inline-fixture.mjs';

const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import Connected from '/src/components/smartBusiness/ConnectedAgentCalendar.tsx';import'/src/index.css';localStorage.setItem('overseas_token','isolated-audit-token');createRoot(document.getElementById('root')).render(<Connected/>);`;
let vite,browser;
try{
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';await access(chrome);
 vite=await createServer({configFile:false,cacheDir:'work/agent-card-inline-vite',resolve:{dedupe:['react','react-dom']},optimizeDeps:{entries:[],include:['react','react-dom/client','react-dom','react/jsx-runtime','lucide-react']},plugins:[{name:'audit-readonly-context',enforce:'pre',transform(_code,id){if(id.split('?')[0].endsWith('/src/contexts/SocialProgramContext.tsx'))return `export const useOptionalSocialProgram=()=>({activeProgram:${JSON.stringify(program)}});export const useSocialProgram=useOptionalSocialProgram;export const SocialProgramProvider=({children})=>children;`;}},react(),tailwind(),{name:'audit-html',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/agent-card-inline')return next();const compiled=await transformWithEsbuild(fixture,'fixture.tsx',{loader:'tsx',jsx:'automatic'});res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/agent-card-inline',`<html><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`));});}}],server:{host:'127.0.0.1',port:0,hmr:false}});
 await vite.listen();browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],blocked=[],reads=[];
 page.on('pageerror',e=>errors.push(e.message));const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
 await page.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin||!['GET','HEAD'].includes(req.method())){blocked.push(`${req.method()} ${req.url()}`);return route.abort();}if(url.pathname.startsWith('/api/')){reads.push(url.pathname+url.search);const data=mockRead(url);return route.fulfill(data===undefined?{status:404,json:{error:`GET fixture missing ${url.pathname}`}}:{json:data});}return route.continue();});
 await page.goto(`${origin}/agent-card-inline`);
 await page.getByText(/^经营项目：/).waitFor();
 await page.getByRole('combobox',{name:'查看周任务包版本'}).selectOption(JSON.stringify([pkg.packageId,pkg.version]));
 await page.getByRole('button').filter({has:page.getByText('13. 用户确认成片 · 待编导明确',{exact:true})}).waitFor();
 const cases=[
 {id:'cross-week-material:'+cross.item.continuationId+':verification',panel:'cross-week-material:t:p:week2:2:'+cross.item.continuationId,data:{request:cross.item.source.requestId,consumer:cross.item.target.consumerTaskId}},
 ...exceptions.flatMap(r=>['submission','verification'].map(action=>({id:`customer-exception:${r.requestId}:${action}`,panel:`weekly-customer-exception:t:p:week2:2:bound-run:${r.requestId}`,data:{tenantId:'t',programId:'p',packageId:'week2',packageVersion:'2',runId:'bound-run',requestId:r.requestId}}))),
 {id:'publication-recovery:'+publication.id,panel:'publication-recovery:t:p:week2:2:'+publication.id,data:{tenant:'t',task:publication.taskId,publication:publication.publicationTaskId,attempt:publication.attemptId}},
 ...natives.map(r=>({id:'native-send-recovery:'+r.id,panel:'native-send-recovery:t:p:week2:2:'+r.id,data:{tenant:'t',run:r.runId,task:r.taskId,request:r.requestId,channel:r.channel}})),
 {id:'send-recovery:'+wa.id,panel:'customer-send-recovery:t:p:week2:2:'+wa.id,data:{tenant:'t',program:'p',package:'week2',version:'2',id:wa.id,run:wa.runId,task:wa.taskId,item:wa.itemId,channel:'whatsapp'}},
 {id:'audit-inventory-approval',panel:`inventory-workspace:t:p:week2:2:${inventoryRecord.item.bindingId}`,data:{publication:'next'}},
 {id:'audit-publication-execution',panel:'publication-execution:t:p:week2:2:audit-publication-execution',data:{tenant:'t',program:'p',package:'week2',version:'2',task:'audit-publication-execution'}},
 ];
 const failures=[],evidence=[];
 const sourceBefore=createHash('sha256').update(await readFile('src/components/smartBusiness/ConnectedAgentCalendar.tsx')).digest('hex');
 for(const c of cases){try{
   // Actual calendar card id is stable across localized titles and duplicate knowledge labels.
   const card=page.locator(`[data-agent-calendar-card-id="${c.id}"]`);
   await card.waitFor({timeout:10000});await card.click();
   const dialog=page.getByRole('dialog',{name:'任务详情'});await dialog.waitFor();
   await dialog.getByRole('button',{name:/核验此任务生产对象与上游|核验原发送异常与真实回执|查看真实发布安排与平台尝试/}).click();
   await dialog.waitFor({state:'hidden'});
   const panel=page.locator(`[id="${c.panel}"]`);await panel.waitFor({state:'visible',timeout:10000});
   for(const [k,v] of Object.entries(c.data))assert.equal(await panel.evaluate((node,k)=>node.dataset[k],k),v,`${c.id} dataset ${k}`);
   if(c.id==='audit-publication-execution')await panel.getByText(/Attempt audit-readonly-attempt/).waitFor();
   await page.waitForFunction(id=>document.activeElement?.id===id,c.panel,{timeout:5000});
   evidence.push({caseId:c.id,panelId:c.panel,identityDataset:await panel.evaluate(node=>({...node.dataset})),visible:await panel.isVisible(),focused:await page.evaluate(()=>document.activeElement?.id),sourceHash:sourceBefore,readRequests:[...new Set(reads)]});
   console.log('PASS INLINE',c.id,c.panel);
 }catch(e){failures.push({id:c.id,error:e.message});console.log('FAIL INLINE',c.id,e.message);const dialog=page.getByRole('dialog',{name:'任务详情'});if(await dialog.count())await dialog.getByRole('button',{name:'关闭任务详情'}).click();}}
 const sourceAfter=createHash('sha256').update(await readFile('src/components/smartBusiness/ConnectedAgentCalendar.tsx')).digest('hex');
 await mkdir('work',{recursive:true});await writeFile('work/agent-card-inline-evidence.json',JSON.stringify({fixtureOnly:true,sourceBefore,sourceAfter,evidence,failures,pageErrors:errors,blockedRequests:blocked,reads:[...new Set(reads)]},null,2));
 assert.equal(sourceAfter,sourceBefore,'shared source changed during audit');
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 console.log('SUPPORTED GET READS',JSON.stringify([...new Set(reads)]));
 console.log('SOURCE SHA256',createHash('sha256').update(await readFile('src/components/smartBusiness/ConnectedAgentCalendar.tsx')).digest('hex'));
 assert.deepEqual(failures,[],'inline real panel click failures');
 console.log('PASS 11 inline cases across 7 categories; exact panel datasets/visible/focus; JSON evidence work/agent-card-inline-evidence.json');
}finally{await browser?.close();await vite?.close();}
