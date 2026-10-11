import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { compilePackage, recommendPackage } from './weeklyPackage.js';
import { ReviewTodoService } from './reviewTodos.js';
import type { ReviewTodo } from '../../src/lib/reviewTodos.js';
const rows=new Map<string,any[]>(); let seq=0; let failTask=false;
const original={...store};
Object.assign(store, {
  async getById(c:string,id:string){return structuredClone(rows.get(c)?.find(r=>r.id===id)||null);},
  async list(c:string,q:any){let matches=(rows.get(c)||[]).filter(r=>Object.entries(q?.where||{}).every(([k,v])=>r[k]===v));if(q?.sort){const desc=q.sort.startsWith('-');const k=q.sort.replace(/^-/, '');matches=matches.slice().sort((a,b)=>String(a[k]||'').localeCompare(String(b[k]||''))*(desc?-1:1));}return {items:structuredClone(matches),page:1,perPage:100,totalPages:1,totalItems:matches.length};},
  async create(c:string,raw:any){if(c==='workflow_tasks'&&failTask){failTask=false;return null;}const row={...structuredClone(raw),id:`fixture-${++seq}`};rows.set(c,[...(rows.get(c)||[]),row]);return structuredClone(row);},
  async update(c:string,id:string,raw:any){const row=rows.get(c)?.find(r=>r.id===id);if(!row)return false;Object.assign(row,structuredClone(raw));return true;},
  async compareAndSwap(c:string,id:string,expected:Record<string,unknown>,raw:Record<string,unknown>){const row=rows.get(c)?.find(r=>r.id===id);if(!row||Object.entries(expected).some(([key,value])=>!isDeepStrictEqual(row[key],value)))return false;Object.assign(row,structuredClone(raw));return true;},
  async delete(){return false;}
} satisfies DataStore);
const oldFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('External network disabled in review integration test');};
try {
  const { allocateReviewTodos }=await import('../routes/digitalEmployees.js');
  const tenant='review-integration-only';
  const config=normalizeDigitalEmployeeConfig({companyName:'隔离企业',industry:'设备',primaryBusiness:'设备',focusProducts:'产品A',autonomyMode:'suggest',enabledWorkflows:[]});
  const goal=normalizeWeeklyGoal({startsAt:'2099-01-05',endsAt:'2099-01-11'},config);
  const pack=recommendPackage(goal,config);
  const source={id:'source',tenant_id:tenant,title:'本周目标',objective:'确认安装资料',business_line:goal.businessLine,content_platforms:goal.contentPlatforms,metric:goal.metric,baseline:0,target:1,unit:'项',starts_at:'2098-12-29',ends_at:'2099-01-04',scope:'产品A',constraints:[],owner_id:'actor',status:'succeeded',version:1};
  rows.set('digital_employee_configs',[{id:'config',tenant_id:tenant,status:'active',config}]);
  rows.set('weekly_goals',[source]);
  rows.set('weekly_plans',[{id:'source-plan',tenant_id:tenant,goal_id:'source',status:'approved',plan:{...compilePackage(pack,goal,config),configSnapshot:config}}]);
  const service=new ReviewTodoService(store);
  const todo:ReviewTodo={id:'knowledge-1',sourceIds:['insight-k'],sourceTitle:'安装问题',kind:'knowledge',title:'核实并补充安装条件',requirements:'核对供电与承重资料，形成待审核答案',acceptance:'附产品资料依据，并由负责人审核',reference:'客户安装问题',materials:'供电与承重参数',quantity:1,videoIndexes:[],status:'pending',reason:''};
  let board=await service.get(tenant,'2099-01-05');
  board=await service.save(tenant,{...board,sourceGoalId:'source',items:[todo],autoAssign:true},'actor');
  failTask=true;
  board=await service.dispatch(tenant,'actor',board.week,allocateReviewTodos);
  assert.equal(board.items[0].status,'needs_input','a failed task write cannot report success');
  assert.equal(rows.get('workflow_runs')?.length,1,board.lastError);
  assert.equal(rows.get('workflow_runs')![0].status,'initializing');
  board=await service.dispatch(tenant,'actor',board.week,allocateReviewTodos);
  assert.equal(board.items[0].status,'assigned',board.lastError);
  const goals=rows.get('weekly_goals')!;
  assert.equal(goals.length,2,'retry cannot create a duplicate goal');
  assert.equal(rows.get('workflow_runs')!.length,1,'retry cannot create a duplicate run');
  const tasks=rows.get('workflow_tasks')!;
  const assigned=tasks.find(t=>t.task_key==='review_todo_knowledge-1');
  assert.ok(assigned);
  assert.equal(assigned.destination,'enterprise');
  assert.match(assigned.description,/核对供电与承重资料/);
  assert.notEqual(assigned.status,'succeeded','knowledge work must remain pending human completion');
  await service.dispatch(tenant,'actor',board.week,allocateReviewTodos);
  await service.runDue(allocateReviewTodos,new Date('2099-01-05T01:01:00Z'));
  assert.equal(rows.get('workflow_runs')!.length,1);
  console.log('Review integration: saved todo → cloned next goal → persisted concrete tasks → start → partial-write recovery → no duplicate scheduled run passed');
} finally { Object.assign(store,original);globalThis.fetch=oldFetch; }
