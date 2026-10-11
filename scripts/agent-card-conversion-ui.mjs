import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createServer,transformWithEsbuild} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright-core';
const scope={tenantId:'audit-tenant',programId:'audit-program',packageId:'audit-week',packageVersion:1};
const sale={...scope,id:'handoff-original',version:3,runId:'run-original',memberId:'member-original',customerId:'customer-original',sourceInteractionId:'interaction-original',ownerUserId:'owner-original',createdBy:'creator',approvedBatchId:'approved-original',approvedBatchVersion:2,approvedContentHash:'hash',sourceKind:'new_inquiry',channel:'whatsapp',status:'awaiting_claim',claimDueAt:'2026-10-06T10:00:00+08:00',feedbackDueAt:'2026-10-07T10:00:00+08:00',claimedAt:null,feedback:null,sourceEvidence:{body:'原客户询盘需要报价',interactionId:'interaction-original',timestamp:1791244800000}};
const customerProjection={binding:{bindingId:'binding-original',runId:'run-original',goalId:'goal',planId:'plan',boundBy:'owner-original',boundAt:'2026-10-05T00:00:00Z'},tasks:[{step:'drafts',taskId:'workflow-original',taskKey:'followup_batch_draft',title:'原客服草稿运行',status:'blocked',evidenceStatus:'blocked',reason:'只读验收',scheduledAt:'2026-10-06T11:00:00+08:00',latestFinishAt:'2026-10-06T12:00:00+08:00',estimateDurationMinutes:30}],scheduleGaps:[]};
const workspace={readOnly:true,run:{id:'run-original'},tasks:[{id:'workflow-original',task_key:'followup_batch_draft',title:'原客服草稿运行',status:'blocked'}],segment:{id:'segment-original',member_count:1,excluded_count:0},members:[{id:'member-original',customer_id:'customer-original',membership:'included'}],batch:{id:'batch-original',version:2,status:'draft'},items:[{id:'item-original',customer_id:'customer-original',customer_name:'原客户 · customer-original',draft_body:'原运行已核验的只读草稿',channel:'messenger'}]};
// Complete the production workspace identity contract; do not bypass its validator.
workspace.scope={tenantId:scope.tenantId,runId:'run-original'};
workspace.tasks[0].run_id='run-original';
Object.assign(workspace.segment,{tenant_id:scope.tenantId,run_id:'run-original'});
Object.assign(workspace.batch,{tenant_id:scope.tenantId,run_id:'run-original',segment_id:workspace.segment.id});
Object.assign(workspace.members[0],{tenant_id:scope.tenantId,segment_id:workspace.segment.id});
Object.assign(workspace.items[0],{tenant_id:scope.tenantId,batch_id:workspace.batch.id,segment_member_id:workspace.members[0].id});
const mismatched=process.argv.includes('--mismatched-workspace');
if(mismatched){workspace.run.id='run-other';workspace.members[0]={id:'member-other',customer_id:'customer-other',membership:'included'};workspace.items[0].customer_id='customer-other';workspace.items[0].customer_name='异源客户 · customer-other';workspace.items[0].draft_body='异源草稿不应显示';}
const evidencePath=mismatched?'work/agent-card-conversion/mismatch-evidence.json':'work/agent-card-conversion/evidence.json';
const sourceFiles=['src/components/socialProgram/WeeklyCustomerCalendar.tsx','src/components/socialProgram/weeklySalesNavigation.ts','src/components/socialProgram/WeeklySalesHandoffPanel.tsx','src/components/ConversionPage.tsx','src/components/CustomerWorkflowPanel.tsx','src/components/socialProgram/CustomerWeeklyCalendar.tsx','src/lib/digitalEmployees.ts','src/hooks/useDeliveryHandoff.ts','src/lib/customerWorkspaceIdentity.ts'];
const hashes=()=>Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])).then(Object.fromEntries);
const beforeHashes=await hashes();
await mkdir('work/agent-card-conversion',{recursive:true});
const persist=async report=>{await mkdir('work',{recursive:true});await writeFile(evidencePath,JSON.stringify(report,null,2)+'\n');};
// WeeklyCustomerCalendar owns the real card projection and customer dispatch handler.
// Sales uses the exported production reveal handler and real target panel.
const fixture=`import React,{useEffect,useRef,useState}from'react';import{createRoot}from'react-dom/client';
import Calendar from'/src/components/socialProgram/WeeklyCustomerCalendar.tsx';import Sales from'/src/components/socialProgram/WeeklySalesHandoffPanel.tsx';import Conversion from'/src/components/ConversionPage.tsx';import{revealWeeklySalesAction}from'/src/components/socialProgram/weeklySalesNavigation.ts';import'/src/index.css';
localStorage.setItem('overseas_token','isolated-audit-token');window.auditNavigation=[];
function Shell(){const[page,setPage]=useState('calendar');const[error,setError]=useState('');const root=useRef(null);useEffect(()=>{const listener=e=>{window.auditNavigation.push(e.detail);if(e.detail.page==='conversion')setPage('conversion')};window.addEventListener('lingshu:navigate',listener);return()=>window.removeEventListener('lingshu:navigate',listener)},[]);return <div style={{height:'100vh'}}>{page==='calendar'?<><Calendar programId="audit-program" packageId="audit-week" packageVersion={1} weekStart="2026-10-05" weekEnd="2026-10-11" executionTasks={[{tenantId:'audit-tenant',programId:'audit-program',packageId:'audit-week',packageVersion:1}]} onOpenSales={card=>{try{revealWeeklySalesAction(card,${JSON.stringify(scope)},root.current)}catch(e){setError(e.message)}}}/><div ref={root}><Sales programId="audit-program" packageId="audit-week" packageVersion={1}/></div>{error&&<p role="alert">{error}</p>}</>:<Conversion onEnterConversation={()=>{}} onLeaveConversation={()=>{}} isInConversation={false}/>}</div>};createRoot(document.getElementById('root')).render(<Shell/>);`;
let vite,browser; const readRequests=[],blocked=[],unknown=[],errors=[];
try{
 vite=await createServer({configFile:false,cacheDir:'work/agent-card-conversion-vite',resolve:{dedupe:['react','react-dom']},optimizeDeps:{entries:[],include:['react','react-dom/client','react-dom','react/jsx-runtime','lucide-react','emoji-picker-react']},plugins:[react(),tailwind(),{name:'agent-card-conversion-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/agent-card-conversion')return next();const c=await transformWithEsbuild(fixture,'conversion-audit.tsx',{loader:'tsx',jsx:'automatic'});res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/agent-card-conversion',`<html><body><div id="root"></div><script type="module">${c.code}</script></body></html>`));});}}],server:{host:'127.0.0.1',port:0,hmr:false}});await vite.listen();
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
 await page.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin||!['GET','HEAD'].includes(req.method())){blocked.push(`${req.method()} ${url}`);return route.abort();}if(!url.pathname.startsWith('/api/'))return route.continue();readRequests.push(url.pathname+url.search);let body;
 if(url.pathname.endsWith('/sales-handoffs'))body={items:[sale]};
 else if(url.pathname.endsWith('/sales-handoffs/sources'))body={items:[],gaps:[],relationshipChecks:[]};
 else if(url.pathname.endsWith('/employees'))body={employees:[{id:'owner-original',name:'原销售',role:'customer_service',isCurrent:true}]};
 else if(url.pathname.endsWith('/customer-run-binding'))body={item:customerProjection};
 else if(url.pathname.endsWith('/material-requests'))body={items:[]};
 else if(url.pathname==='/api/overseas/customers')body={items:[]};
 else if(url.pathname==='/api/overseas/enterprise/profile')body={};
 else if(url.pathname==='/api/overseas/enterprise/knowledge-completion')body={};
 else if(url.pathname==='/api/overseas/customers/templates')body={items:[]};
 else if(url.pathname==='/api/overseas/enterprise/customer-service/status')body={enabled:false,canAutoSend:false,autoReplyReady:false};
 else if(url.pathname==='/api/overseas/digital-employees/runs/run-original/customer-workspace')body=workspace;
 else {unknown.push(url.pathname+url.search);return route.fulfill({status:404,json:{error:'unmocked_read'}});}
 return route.fulfill({json:body});});
 await page.goto(`${origin}/agent-card-conversion`);
 await page.getByRole('button',{name:'由我领取',exact:true}).waitFor();
 await page.getByRole('button').filter({has:page.getByText('销售领取客户交接',{exact:true})}).click();
 const saleDialog=page.getByRole('dialog',{name:'任务详情'});await saleDialog.getByRole('button',{name:/进入这条任务|核验此任务/}).click();await saleDialog.waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const el=document.querySelector('[data-sales-target]');return el&&document.activeElement===el&&el.getBoundingClientRect().top>=0&&el.getBoundingClientRect().bottom<=innerHeight});
 const salesTarget=await page.getByRole('button',{name:'由我领取',exact:true}).evaluate(el=>({target:JSON.parse(el.dataset.salesTarget),focused:document.activeElement===el,visible:el.getBoundingClientRect().top>=0&&el.getBoundingClientRect().bottom<=innerHeight}));
 assert.equal(salesTarget.focused,true);assert.equal(salesTarget.visible,true);assert.deepEqual(salesTarget.target,{...scope,handoffId:sale.id,handoffVersion:3,runId:'run-original',memberId:'member-original',customerId:'customer-original',action:'claim'});
 await page.screenshot({path:'work/agent-card-conversion/sales.png',fullPage:true});
 // Deliberately do not click the claim mutation.
 await page.getByRole('button').filter({has:page.getByText('原客服草稿运行',{exact:true})}).click();
 const customerDialog=page.getByRole('dialog',{name:'任务详情'});await customerDialog.getByRole('button',{name:/进入这条任务|核验此任务/}).click();
 await page.getByRole('heading',{name:'逐客草稿与修订',exact:true}).waitFor();
 if(mismatched){
  await page.waitForFunction(()=>document.querySelector('[data-followup-item]')||document.querySelector('[role=alert]'));
  await page.screenshot({path:'work/agent-card-conversion/mismatch.png',fullPage:true});
  const foreignVisible=await page.locator('textarea').evaluateAll(elements=>elements.some(el=>el.value==='异源草稿不应显示'&&el.getBoundingClientRect().height>0));
  assert.equal(foreignVisible,false,'mismatched workspace must reject foreign draft display');
  const alerts=page.getByRole('alert');assert(await alerts.count()>0,'mismatched workspace must show rejection');
  assert.match(await alerts.first().textContent(),/身份|不一致|原运行|原客户|归属|核验/);
  assert.deepEqual(await hashes(),beforeHashes);await persist({status:'passed',case:'mismatched-workspace',foreignVisible:false,rejection:await alerts.first().textContent(),sourceHashes:beforeHashes,sourceHashesUnchanged:true});
 }else{
 const item=page.locator('[data-followup-item="item-original"]');await item.waitFor();if(mismatched)await page.screenshot({path:'work/agent-card-conversion/mismatch.png',fullPage:true});assert.equal(await item.getByRole('textbox').inputValue(),'原运行已核验的只读草稿');assert.match(await item.textContent(),/原客户 · customer-original/);
 assert.equal(await page.getByText('原客服草稿运行 · blocked',{exact:true}).count(),1);
 const navigation=await page.evaluate(()=>({event:window.auditNavigation.at(-1),stored:JSON.parse(sessionStorage.getItem('digitalEmployee.businessDeepLink'))}));
 for(const value of [navigation.event,navigation.stored]){assert.equal(value.page,'conversion');assert.equal(value.runId,'run-original');assert.equal(value.taskId,'workflow-original');assert.equal(value.businessRef.taskKey,'followup_batch_draft');}
 assert(readRequests.includes('/api/overseas/digital-employees/runs/run-original/customer-workspace'));
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(unknown,[]);
 await page.screenshot({path:'work/agent-card-conversion/customer.png',fullPage:true});
 const sourceHashes=await hashes();assert.deepEqual(sourceHashes,beforeHashes,'production sources changed during browser acceptance');
 assert.equal(workspace.members.find(member=>member.id==='member-original')?.customer_id,workspace.items[0].customer_id);
 const customerTarget=await item.evaluate(el=>({panel:'CustomerWorkflowPanel inside ConversionPage',itemId:el.dataset.followupItem,visible:el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0}));
 const report={scope:'Real calendar/handlers/target panels; controlled navigation shell; read-only API fixtures; not full authenticated App',chromeVersion:browser.version(),salesTarget,customerTarget,productionHandlers:['WeeklyCustomerCalendar → forwardCalendarSales → revealWeeklySalesAction','WeeklyCustomerCalendar → openCustomerCalendarTask → dispatchDigitalEmployeeDeepLink → useDeliveryHandoff → ConversionPage → CustomerWorkflowPanel'],navigation,readRequests,sourceHashes,sourceHashesUnchanged:true,customerBinding:{runId:workspace.run.id,memberId:workspace.members[0].id,customerId:workspace.items[0].customer_id,verification:'production workspace validator enforces run/tenant/batch/member/customer relation; displayed original item'},gaps:['Customer run handoff carries run/task only; validated member/customer and tenant relations are supplied by the original workspace response, not an independently scoped member/customer navigation target.']};
 await persist(report);console.log(JSON.stringify(report,null,2));
 }
}catch(error){await persist({status:'failed',case:mismatched?'mismatched-workspace':'positive',error:error.message,readRequests,blocked,unknown,errors,sourceHashes:await hashes(),sourceHashesUnchanged:JSON.stringify(await hashes())===JSON.stringify(beforeHashes),workspaceFixture:workspace});console.error('FAIL agent-card-conversion',error.message,{readRequests,blocked,unknown,errors});throw error;}finally{await browser?.close();await vite?.close();}
