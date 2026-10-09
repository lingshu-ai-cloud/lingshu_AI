import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function schema(filename:string):Record<string,any> {
  let apply:((app:unknown)=>unknown)|undefined;
  const saved:Record<string,any>[]=[];
  vm.runInNewContext(readFileSync(`pb_migrations/${filename}`,'utf8'),{
    Collection:class {constructor(value:Record<string,unknown>){Object.assign(this,value);}},
    migrate:(up:(app:unknown)=>unknown)=>{apply=up;},
  });
  assert.ok(apply);
  apply({save:(collection:Record<string,any>)=>{saved.push(collection);}});
  assert.equal(saved.length,1);
  return saved[0]!;
}
const cases=[
 ['1791072009_create_social_weekly_cancellations.js','social_weekly_cancellations',['tenant_id','program_id','package_id','package_version']],
 ['1791072010_create_studio_render_jobs.js','studio_render_jobs',['tenant_id','project_id','idempotency_key']],
 ['1791072020_create_social_weekly_material_requests.js','social_weekly_material_requests',['tenant_id','program_id','requirement_key']],
 ['1791072011_create_social_weekly_agent_planning.js','social_weekly_agent_planning',['tenant_id','program_id','package_id','package_version','planning_version']],
] as const;
for(const [filename,name,identity] of cases) test(`${name} schema locks client access and scopes durable identity to tenant`,()=> {
 const collection=schema(filename);
 assert.equal(collection.name,name);
 assert.equal(collection.type,'base');
 for(const rule of ['listRule','viewRule','createRule','updateRule','deleteRule']) assert.equal(collection[rule],null);
 const fields=new Map<string,Record<string,any>>(collection.fields.map((field:Record<string,any>)=>[field.name,field]));
 for(const field of identity) assert.equal(fields.get(field)?.required,true);
 const unique=collection.indexes.find((index:string)=>index.startsWith('CREATE UNIQUE INDEX'));
 assert.ok(unique);
 assert.ok(unique.endsWith(`(${identity.join(', ')})`));
 if(name==='studio_render_jobs') {
   for(const name of ['progress','attempts']) {assert.equal(fields.get(name)?.required,undefined);assert.equal(fields.get(name)?.min,0);}
 }
 if(name==='social_weekly_cancellations') {
   for(const name of ['checkpoints','effects']) assert.notEqual(fields.get(name)?.required,true,'empty receipt sets remain valid');
 }
 for(const name of ['package_version','planning_version']) if(fields.has(name)) assert.equal(fields.get(name)?.min,1);
});
