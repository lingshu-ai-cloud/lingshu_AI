import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectCalendarDeliverables,projectDailyCustomerServiceCards,orderDailyCalendarTasks,mergeDailyTaskCards,projectDailyMilestones,conciseCalendarTitle} from './calendarDeliverables';
import type {AgentCalendarTask} from './AgentWeeklyCalendar';
const card=(id:string,step:string,group='tenant:week:videoA'):AgentCalendarTask=>({id,executionStep:step,deliverableGroup:group,date:'2026-10-07',time:step==='quality_check'?'15:00':'10:00',agent:'content',title:'视频 A · 产品 A',output:'实际结果',context:'测试',minutes:20,status:'planned'});
test('daily milestones retain destinations while weekly goals and review occupy Monday and Sunday only',()=>{
 const steps=['business_outline','business_schedule','benchmark_collection','benchmark_scoring','director_analysis','material_preparation','script','storyboard','material_readiness','asset_generation','video_generation','quality_check','user_approval','publishing','performance_monitoring','weekly_review','template_extraction'];
 const sources=steps.map((step,i)=>({...card(String(i),step),workspaceTarget:{programId:'p',packageId:'pkg',packageVersion:1,executionTaskId:String(i)},dependsOn:i?[String(i-1)]:[]}));
 const duty={...card('customer','customer_always_on'),title:'24小时常驻客服',agent:'customer' as const};
 const result=orderDailyCalendarTasks(projectDailyMilestones([...sources,duty]));
 assert.equal(result.length,10);assert.equal(result[0]!.title,'本周目标确认');
 assert.equal(result[0]!.date,'2026-10-05');assert.equal(result.at(-1)!.title,'周目标验收与复盘');assert.equal(result.at(-1)!.date,'2026-10-11');
 const ordinary=result.filter(t=>t.date==='2026-10-07');assert.equal(ordinary.length,8);assert.equal(ordinary[0]!.title,'今日经营计划');assert.equal(ordinary[1]!.id,'customer');
 assert.deepEqual(result.flatMap(t=>t.dailyTaskGroup?.tasks??[t]).map(t=>t.id).sort(),[...sources,duty].map(t=>t.id).sort());
 for(const source of sources)assert.equal(result.flatMap(t=>t.dailyTaskGroup?.tasks??[]).find(t=>t.id===source.id),source);
 assert.equal(conciseCalendarTitle('4. 编导拆解 · 待编导明确'),'编导拆解');
 assert.deepEqual(projectDailyMilestones([]),[],'empty days do not fabricate jobs');
});
test('same day duplicate stage merges without losing exact tasks or downstream dependency',()=>{
 const workspaceTarget={programId:'program',packageId:'pkg',packageVersion:2,executionTaskId:'a'};
 const a={...card('a','material_preparation'),workspaceTarget};
 const b={...a,id:'b',workspaceTarget:{...workspaceTarget,executionTaskId:'b'}};
 const next={...card('next','script'),workspaceTarget:{...workspaceTarget,executionTaskId:'next'},dependsOn:['b']};
 const anotherDay={...a,id:'tomorrow',date:'2026-10-08'};
 const result=mergeDailyTaskCards([a,b,next,anotherDay]);
 assert.equal(result.length,3);
 assert.deepEqual(result[0]!.dailyTaskGroup?.tasks.map(t=>t.id),['a','b']);
 assert.deepEqual(result[1]!.dependsOn,[result[0]!.id]);
 assert.equal(result[2]!.id,'tomorrow');
});
test('daily board keeps business duty first and follows real dependencies for independent production tasks',()=>{
 const duty={...card('duty','performance_monitoring'),agent:'business' as const,title:'24小时经营值守'};
 const render={...card('render','render'),dependsOn:['export']};
 const exported={...card('export','export'),dependsOn:['video']};
 const video=card('video','video_generation');
 const result=orderDailyCalendarTasks([render,exported,video,duty]);
 assert.deepEqual(result.map(task=>task.id),['duty','video','export','render']);
 assert.equal(projectCalendarDeliverables([video,card('quality','quality_check')],true).length,2);
});
test('one deliverable retains final deadline, real navigation identity and internal nodes',()=>{
 const nodes=[card('script','script'),{...card('video','video_generation'),productionTaskId:'actual-content',productionExecutionTaskId:'video'},card('quality','quality_check')];
 const result=projectCalendarDeliverables(nodes);
 assert.equal(result.length,1);assert.equal(result[0].id,'quality');assert.equal(result[0].time,'15:00');assert.equal(result[0].productionTaskId,'actual-content');assert.equal(result[0].productionExecutionTaskId,'video');assert.equal(result[0].internalNodes?.length,3);
 assert.equal(result[0].title,'完成视频成片');
});
test('another tenant, publication and human exception never collapse into this video',()=>{
 const human={...card('upload','material_readiness'),agent:'human' as const};
 const result=projectCalendarDeliverables([card('v','video_generation'),card('q','quality_check'),card('other','quality_check','other-tenant:week:videoA'),human,card('publish','publishing')]);
 assert.deepEqual(result.map(c=>c.id),['q','other','upload','publish']);
});
test('blocked internal node is visible on deliverable, completed final evidence remains authoritative',()=>{
 const blocked={...card('asset','asset_generation'),status:'blocked' as const,reason:'缺产品证据'};
 assert.equal(projectCalendarDeliverables([blocked,card('q','quality_check')])[0].reason,'缺产品证据');
 assert.equal(projectCalendarDeliverables([blocked,{...card('q','quality_check'),status:'completed'}])[0].status,'completed');
});
test('missing final delivery and unscoped nodes stay visible instead of silently disappearing',()=>{
 const script=card('script','script');const unscoped={...card('legacy','video_generation'),deliverableGroup:undefined};
 assert.deepEqual(projectCalendarDeliverables([script,unscoped]),[{...script,agent:'director'},unscoped]);
});
test('weekly goal summaries expand their Monday business workflow into independent cards',()=>{
 const mondayNodes:AgentCalendarTask[]=[
  {...card('goal','business_outline',undefined),agent:'business',date:'2026-10-12',time:'09:00',title:'拆解本周经营目标'},
  {...card('context','context_readiness',undefined),agent:'business',date:'2026-10-12',time:'10:00',title:'核验企业上下文'},
  {...card('accounts','publishing_calendar',undefined),agent:'business',date:'2026-10-12',time:'11:00',title:'核验发布账号'},
 ];
 const summary:AgentCalendarTask={...mondayNodes[0],id:'goal-week-goal',title:'经营目标与执行准备',calendarSummaryOnly:true,output:'周目标摘要',internalNodes:mondayNodes};
 const result=projectCalendarDeliverables([summary]);
 assert.deepEqual(result.map(task=>task.id),['goal','context','accounts']);
 assert.ok(result.every(task=>task.calendarSummaryOnly!==true));
});

test('a direct persisted task wins over a duplicate node embedded in a weekly summary',()=>{
 const direct={...card('goal','business_outline',undefined),agent:'business' as const,title:'真实执行任务'};
 const summary:AgentCalendarTask={...direct,id:'summary',calendarSummaryOnly:true,internalNodes:[{...direct,title:'旧摘要节点'}]};
 assert.deepEqual(projectCalendarDeliverables([summary,direct]).map(task=>task.title),['真实执行任务']);
});

test('customer runtime jobs become one daily always-on card for each day of the week',()=>{
 const whatsapp={...card('wa','customer_channel_readiness',undefined),agent:'customer' as const,date:'2026-10-12',status:'completed' as const,customerExecutionTarget:{tenantId:'t',programId:'p',packageId:'w',packageVersion:1,taskId:'wa',publicationTaskId:'pub',stepKind:'customer_channel_readiness' as const,channel:'whatsapp' as const}};
 const messenger={...card('msg','customer_inquiry_handoff',undefined),agent:'customer' as const,date:'2026-10-15',status:'blocked' as const,customerExecutionTarget:{tenantId:'t',programId:'p',packageId:'w',packageVersion:1,taskId:'msg',publicationTaskId:'pub',stepKind:'customer_inquiry_handoff' as const,channel:'messenger' as const}};
 const result=projectDailyCustomerServiceCards([whatsapp,messenger,card('publish','publishing')],'2026-10-12');
 const customer=result.filter(task=>task.executionStep==='customer_always_on');
 assert.equal(customer.length,7);assert.equal(customer[0]!.date,'2026-10-12');assert.equal(customer[6]!.date,'2026-10-18');
 assert.ok(customer.every(task=>task.time==='00:00'&&task.minutes===1440&&task.title==='24小时常驻客服'&&task.status==='blocked'));
 assert.equal(customer[0]!.customerServiceSummary?.attentionCount,1);
 assert.deepEqual(result.filter(task=>['customer_channel_readiness','customer_inquiry_handoff'].includes(task.executionStep||'')),[]);
});
