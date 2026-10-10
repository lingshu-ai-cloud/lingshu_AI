import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access,readFile} from 'node:fs/promises';
import {createServer,transformWithEsbuild} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright-core';

// Actual calendar component and actual button handlers; callbacks are observation seams.
// This does NOT mount ConnectedAgentCalendar or assert its destination panels.
const scope={tenantId:'audit-tenant',programId:'audit-program',packageId:'audit-week',packageVersion:1};
const common={...scope,runId:'run',taskId:'original-task',itemId:'item',requestId:'request',id:'recovery'};
const cases=[
 {id:'publication',title:'发布执行',agent:'business',publicationExecutionTarget:{...scope,taskId:'publication',publicationTaskId:'post',accountId:'account'}},
 {id:'inventory',title:'库存复用',agent:'content',inventoryTarget:{...scope,taskId:'inventory',bindingId:'binding',publicationTaskId:'post'}},
 {id:'cross-week-material:continuation:verification',title:'跨周素材',agent:'human',crossWeekMaterialTarget:{...scope,continuationId:'continuation',requestId:'request',consumerTaskId:'consumer'}},
 {id:'customer-exception:request:submission',title:'客服知识报价补齐',agent:'human',customerExceptionTarget:{...common,memberId:'member',action:'submission'}},
 {id:'publication-recovery:recovery',title:'发布恢复',agent:'human',publicationRecoveryTarget:{...common,publicationTaskId:'post',attemptId:'attempt'}},
 {id:'native-send-recovery:recovery',title:'M IG 恢复',agent:'human',nativeRecoveryTarget:{...common,channel:'instagram'}},
 {id:'native-send-recovery:messenger',title:'Messenger 恢复',agent:'human',nativeRecoveryTarget:{...common,id:'messenger',channel:'messenger'}},
 {id:'send-recovery:recovery',title:'WA 恢复',agent:'human',sendRecoveryTarget:{...common,channel:'whatsapp'}},
 {id:'sales:handoff:claim',salesTarget:{...scope,handoffId:'handoff',handoffVersion:1,runId:'run',memberId:'member',customerId:'customer',action:'claim'},title:'销售交接',agent:'human',salesHandoffId:'handoff',salesPackageId:'audit-week',salesPackageVersion:1,salesAction:'claim'},
 {id:'production',title:'内容生产',agent:'content',productionTaskId:'production-task',productionExecutionTaskId:'execution-task'},
 {id:'material',title:'人工素材',agent:'human',materialRequestId:'request',materialAction:'upload'},
 {id:'customer',title:'客服运行',agent:'customer',customerRunId:'run',customerWorkflowTaskId:'workflow-task',customerTaskKey:'customer_readiness'},
];
const tasks=cases.map(t=>({...t,date:'2026-10-05',time:'10:00',status:'blocked',minutes:null,output:'隔离验收产物',context:'仅观察路由，无写操作'}));
const invalid={id:'unbound',title:'缺失真实绑定',agent:'content',date:'2026-10-05',time:'11:00',status:'blocked',minutes:null,output:'未绑定',context:'拒绝打开'};
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import Calendar from '/src/components/smartBusiness/AgentWeeklyCalendar.tsx';import'/src/index.css';window.auditClicks=[];createRoot(document.getElementById('root')).render(<Calendar startsAt="2026-10-05" tasks={${JSON.stringify([...tasks,invalid])}} onOpenProduction={task=>window.auditClicks.push(task)}/>);`;
let vite,browser;
try {
 await access('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
 vite=await createServer({configFile:false,cacheDir:'work/agent-card-click-vite',resolve:{dedupe:['react','react-dom']},optimizeDeps:{entries:[],include:['react','react-dom/client','react-dom','react/jsx-runtime','lucide-react']},plugins:[react(),tailwind(),{name:'agent-card-click-audit',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/agent-card-click')return next();const compiled=await transformWithEsbuild(fixture,'audit.tsx',{loader:'tsx',jsx:'automatic'});res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/agent-card-click',`<html><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`));});}}],server:{host:'127.0.0.1',port:0,hmr:false}});
 await vite.listen();browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
 await page.route('**/*',route=>{const req=route.request();if(new URL(req.url()).origin!==origin||!['GET','HEAD'].includes(req.method())||new URL(req.url()).pathname.startsWith('/api/')){requests.push(`${req.method()} ${req.url()}`);return route.abort();}return route.continue();});
 await page.goto(`${origin}/agent-card-click`);
 for(const task of tasks){
   await page.getByRole('button').filter({has:page.getByText(task.title,{exact:true})}).click();
   const dialog=page.getByRole('dialog',{name:'任务详情'});await dialog.waitFor();
   await dialog.getByRole('button',{name:/查看真实发布安排|核验原发送异常|进入这条任务|核验此任务/}).click();
   await dialog.waitFor({state:'hidden'});
   assert.deepEqual(await page.evaluate(()=>window.auditClicks.at(-1)),task,`${task.title}: callback must preserve full identity`);
 }
 assert.equal(await page.evaluate(()=>window.auditClicks.length),tasks.length);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 // Missing concrete binding must not expose a callback action.
 await page.getByRole('button').filter({has:page.getByText(invalid.title,{exact:true})}).click();
 const invalidDialog=page.getByRole('dialog',{name:'任务详情'});
 assert.equal(await invalidDialog.getByText('此任务尚无可打开的生产对象；执行状态以后台记录为准。',{exact:true}).count(),1);
 assert.equal(await invalidDialog.getByRole('button',{name:/进入这条任务|核验此任务/}).count(),0);
 await invalidDialog.getByRole('button',{name:'关闭任务详情'}).click();
 console.log('SOURCE SHA256',createHash('sha256').update(await readFile('src/components/smartBusiness/AgentWeeklyCalendar.tsx')).digest('hex'));
 console.log('PASS: 12 actual calendar card → modal → button → exact identity callback paths; unbound card fails closed; zero API requests and page errors. Destination panel mounting remains separately unverified.');
}finally{await browser?.close();await vite?.close();}
