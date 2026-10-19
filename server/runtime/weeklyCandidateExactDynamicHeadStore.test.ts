import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,mkdirSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import path from 'node:path';
import {LangGraphTestStore} from '../../scripts/langgraphTestStore.js';
import type {CompareExpected,DataStore,ListQuery,ListResult,Record_} from '../storage/datastore.js';
import type {WeeklyCandidateDynamicExactHeadV2} from './weeklyCandidateExactPaidRequests.js';
import {prepareWeeklyCandidateExactDynamicHeadAnchor,WEEKLY_CANDIDATE_EXACT_DYNAMIC_HEADS} from './weeklyCandidateExactDynamicHeadStore.js';

const h=(value:string)=>createHash('sha256').update(value).digest('hex');
const initial=(suffix='a'):WeeklyCandidateDynamicExactHeadV2=>({schema:'weekly-candidate-dynamic-exact-head.v2',operationId:`operation-${suffix}`,
 authorizationHash:h(`authorization-${suffix}`),planHash:h(`plan-${suffix}`),generation:0,ledgerHash:h(`ledger-${suffix}-0`)});
const next=(head:WeeklyCandidateDynamicExactHeadV2,suffix='1'):WeeklyCandidateDynamicExactHeadV2=>({...head,generation:head.generation+1,ledgerHash:h(`ledger-${suffix}`)});

class AtomicStore implements DataStore{
 rows=new Map<string,Record_>();unknownCreate=false;unknownCas=false;
 supportsAtomicCompareAndSwap(){return true;}
 async getById<T=Record_>(_collection:string,id:string){return structuredClone(this.rows.get(id)??null) as T|null;}
 async create<T=Record_>(_collection:string,data:Record<string,unknown>){if(this.rows.has(String(data.id)))return null;this.rows.set(String(data.id),structuredClone(data as Record_));if(this.unknownCreate)throw Error('lost create response');return structuredClone(data) as T;}
 async update(){return false;}
 async compareAndSwap(_collection:string,id:string,expected:CompareExpected,data:Record<string,unknown>){const row=this.rows.get(id);if(!row||!Object.entries(expected).every(([key,value])=>JSON.stringify(row[key])===JSON.stringify(value)))return false;Object.assign(row,structuredClone(data));if(this.unknownCas)throw Error('lost CAS response');return true;}
 async delete(){return false;}
 async list<T=Record_>(_collection:string,_query?:ListQuery):Promise<ListResult<T>>{const items=[...this.rows.values()] as T[];return{items,totalItems:items.length,totalPages:1,page:1,perPage:500};}
}

test('genesis persists across LangGraphTestStore restart and advances monotonically',async t=>{
 const root=mkdtempSync(path.join(tmpdir(),'weekly-exact-head-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const file=path.join(root,'store.json');
 const first=new LangGraphTestStore(file) as DataStore;first.supportsAtomicCompareAndSwap=()=>true;
 const genesis=initial(),anchor=await prepareWeeklyCandidateExactDynamicHeadAnchor({store:first,tenantId:'tenant-a',initialHead:genesis});
 assert.deepEqual(await anchor.read(),genesis);const advanced=next(genesis);assert.equal(await anchor.compareAndSwap(genesis,advanced),true);
 assert.equal(await anchor.compareAndSwap(genesis,advanced),true,'exact transition replay is idempotent');
 await assert.rejects(anchor.compareAndSwap({...genesis,ledgerHash:h('wrong predecessor')},advanced),/expected_not_current/);
 const restarted=new LangGraphTestStore(file) as DataStore;restarted.supportsAtomicCompareAndSwap=()=>true;
 const reopened=await prepareWeeklyCandidateExactDynamicHeadAnchor({store:restarted,tenantId:'tenant-a',initialHead:genesis});
 assert.deepEqual(await reopened.read(),advanced);await assert.rejects(reopened.compareAndSwap(genesis,advanced),/expected_not_current/);
});

test('concurrent CAS has one winner and unknown writes are decided by readback',async()=>{
 const store=new AtomicStore(),genesis=initial();store.unknownCreate=true;
 const left=await prepareWeeklyCandidateExactDynamicHeadAnchor({store,tenantId:'tenant-a',initialHead:genesis});store.unknownCreate=false;
 const right=await prepareWeeklyCandidateExactDynamicHeadAnchor({store,tenantId:'tenant-a',initialHead:genesis});
 const a=next(genesis,'a'),b=next(genesis,'b'),outcomes=await Promise.allSettled([left.compareAndSwap(genesis,a),right.compareAndSwap(genesis,b)]);
 assert.equal(outcomes.filter(item=>item.status==='fulfilled'&&item.value===true).length,1);
 const current=await left.read();assert.ok(current);assert.ok([a.ledgerHash,b.ledgerHash].includes(current!.ledgerHash));
 const later=next(current!,'unknown');store.unknownCas=true;assert.equal(await left.compareAndSwap(current!,later),true);assert.deepEqual(await left.read(),later);
});

test('identity collision, cross identity, tamper and rollback fail closed',async()=>{
 const store=new AtomicStore(),genesis=initial(),anchor=await prepareWeeklyCandidateExactDynamicHeadAnchor({store,tenantId:'tenant-a',initialHead:genesis});
 const id=[...store.rows.keys()][0]!;const row=store.rows.get(id)!;
 row.tenant_id='tenant-b';await assert.rejects(anchor.read(),/record_changed/);row.tenant_id='tenant-a';
 await assert.rejects(anchor.compareAndSwap(genesis,{...next(genesis),planHash:h('foreign')}),/transition_invalid/);
 const advanced=next(genesis);assert.equal(await anchor.compareAndSwap(genesis,advanced),true);row.generation=0;row.ledger_hash=genesis.ledgerHash;
 await assert.rejects(anchor.read(),/rollback_detected/);row.generation=1;row.ledger_hash=h('tampered');
 await assert.rejects(anchor.read(),/rollback_detected/);
 const collision=new AtomicStore();collision.rows.set(id,{...row,id,tenant_id:'other-tenant'});
 await assert.rejects(prepareWeeklyCandidateExactDynamicHeadAnchor({store:collision,tenantId:'tenant-a',initialHead:genesis}),/record_changed/);
});

test('tenant and full identity are isolated and atomic capability is mandatory',async()=>{
 const store=new AtomicStore(),a=initial('a'),b=initial('b');
 await prepareWeeklyCandidateExactDynamicHeadAnchor({store,tenantId:'tenant-a',initialHead:a});
 await prepareWeeklyCandidateExactDynamicHeadAnchor({store,tenantId:'tenant-b',initialHead:a});
 await prepareWeeklyCandidateExactDynamicHeadAnchor({store,tenantId:'tenant-a',initialHead:b});assert.equal(store.rows.size,3);
 const unavailable={...store,supportsAtomicCompareAndSwap:()=>false} as unknown as DataStore;
 await assert.rejects(prepareWeeklyCandidateExactDynamicHeadAnchor({store:unavailable,tenantId:'tenant-a',initialHead:a}),/atomic_store_required/);
});

test('real PocketBase migration supports fresh, prior-to-current, down and replay in disposable databases',{skip:!existsSync(path.join(homedir(),'.local/share/lingshu/pocketbase/pocketbase'))||!existsSync('/usr/bin/sqlite3')},()=>{
 const pb=path.join(homedir(),'.local/share/lingshu/pocketbase/pocketbase'),scratch=mkdtempSync(path.join(tmpdir(),'weekly-head-migration-'));
 const source=path.resolve('pb_migrations'),all=path.join(scratch,'all'),baseline=path.join(scratch,'baseline');mkdirSync(all);mkdirSync(baseline);
 const targetMigration='1792195219_create_weekly_candidate_exact_dynamic_heads.js';
 for(const name of readdirSync(source).filter(name=>name.endsWith('.js'))){cpSync(path.join(source,name),path.join(all,name));if(name!==targetMigration)cpSync(path.join(source,name),path.join(baseline,name));}
 const run=(dir:string,migrations:string,...args:string[])=>execFileSync(pb,['migrate',...args,`--dir=${dir}`,`--migrationsDir=${migrations}`],{input:'y\n',encoding:'utf8',timeout:120000});
 const query=(dir:string,sql:string)=>execFileSync('/usr/bin/sqlite3',[path.join(dir,'data.db'),sql],{encoding:'utf8'}).trim();
 const verify=(dir:string)=>{assert.equal(query(dir,"select count(*) from _collections where name='weekly_candidate_exact_dynamic_heads';"),'1');
  const raw=query(dir,"select json_object('fields',json(fields),'indexes',json(indexes),'listRule',listRule,'viewRule',viewRule,'createRule',createRule,'updateRule',updateRule,'deleteRule',deleteRule) from _collections where name='weekly_candidate_exact_dynamic_heads';"),schema=JSON.parse(raw);
  for(const rule of ['listRule','viewRule','createRule','updateRule','deleteRule'])assert.equal(schema[rule],null);assert.match(schema.indexes.join('\n'),/UNIQUE INDEX idx_weekly_candidate_exact_dynamic_head_identity/);
  assert.equal(schema.fields.find((field:{name:string})=>field.name==='generation').onlyInt,true);};
 try{const fresh=path.join(scratch,'fresh');run(fresh,all,'up');verify(fresh);
  const baselineMigrations=readdirSync(baseline).filter(name=>name.endsWith('.js')),allMigrations=readdirSync(all).filter(name=>name.endsWith('.js'));
  assert.equal(baselineMigrations.includes(targetMigration),false);assert.equal(allMigrations.includes(targetMigration),true);assert.equal(allMigrations.length,baselineMigrations.length+1);
  const upgrade=path.join(scratch,'upgrade');run(upgrade,baseline,'up');const before=Number(query(upgrade,'select count(*) from _migrations;'));run(upgrade,all,'up');assert.equal(Number(query(upgrade,'select count(*) from _migrations;')),before+1);verify(upgrade);
  run(upgrade,all,'down','1');assert.equal(query(upgrade,"select count(*) from _collections where name='weekly_candidate_exact_dynamic_heads';"),'0');assert.equal(Number(query(upgrade,'select count(*) from _migrations;')),before);
  run(upgrade,all,'up');verify(upgrade);assert.equal(Number(query(upgrade,'select count(*) from _migrations;')),before+1);
 }finally{rmSync(scratch,{recursive:true,force:true});}
});

test('migration manifest binds the exact migration bytes',()=>{
 const name='1792195219_create_weekly_candidate_exact_dynamic_heads.js',source=readFileSync(`pb_migrations/${name}`);
 const manifest=JSON.parse(readFileSync('scripts/pb-migration-checksums.json','utf8')) as {migrations:Record<string,string>};
 assert.equal(manifest.migrations[name],createHash('sha256').update(source).digest('hex'));
});
