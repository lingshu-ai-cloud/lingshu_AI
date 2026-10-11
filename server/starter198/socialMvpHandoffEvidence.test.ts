import test from 'node:test';import assert from 'node:assert/strict';
import type {DataStore} from '../storage/datastore.js';
import {readSocialMvpHandoff,SOCIAL_MVP_HANDOFFS} from './socialMvpHandoffEvidence.js';
import {socialMvpHandoffFixture} from '../../shared/contracts/socialMvpHandoff.fixture.js';
import {socialRequestHash} from './socialContentValidation.js';
function store(rows:Record<string,unknown>[]):DataStore{return {list:async(collection:string)=>({items:collection===SOCIAL_MVP_HANDOFFS?rows:[],totalItems:collection===SOCIAL_MVP_HANDOFFS?rows.length:0})} as unknown as DataStore;}
test('no authoritative record is missing even with a structurally complete controlled clip',async()=>{const f=socialMvpHandoffFixture();const result=await readSocialMvpHandoff(store([]),f.package.scope);assert.equal(result.package,null);assert.deepEqual(result.gaps,['mvp_authoritative_handoff_missing']);});
test('edited frozen input retaining claimed recordHash fails before evidence resolution',async()=>{const f=socialMvpHandoffFixture();const content={package:f.package,clips:[f.A,f.B],history:{A:0,B:0},verified:true};const result=await readSocialMvpHandoff(store([{...f.package.scope,content,content_hash:socialRequestHash(content)}]),f.package.scope);assert.equal(result.package,null);assert.deepEqual(result.gaps,['package_changed']);});
test('server storage package still cannot replace absent supplier/rights/fee evidence',async()=>{const f=socialMvpHandoffFixture();const {recordHash:_,...body}=f.package;f.package.recordHash=socialRequestHash(body);f.A.packageHash=f.B.packageHash=f.package.recordHash;const content={package:f.package,clips:[f.A,f.B],history:{A:0,B:0},verified:true};const result=await readSocialMvpHandoff(store([{...f.package.scope,content,content_hash:socialRequestHash(content)}]),f.package.scope);assert.equal(result.package,null);assert.deepEqual(result.gaps,['evidence_missing']);});
test('reference versions remain separate from task scope and resolved hashes never claim source authenticity',async()=>{
 const f=socialMvpHandoffFixture(),evidenceContent={controlled:'fixture'},evidenceHash=socialRequestHash(evidenceContent);
 const rewrite=(v:unknown):void=>{if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(k==='id'&&x==='controlled-ref'){Object.assign(v,{version:'2',sha256:evidenceHash});}else rewrite(x);}};rewrite(f);
 const {recordHash:_,...body}=f.package;f.package.recordHash=socialRequestHash(body);f.A.packageHash=f.B.packageHash=f.package.recordHash;
 const content={package:f.package,clips:[f.A,f.B],history:{A:0,B:0}};
 const db={list:async(collection:string,input:{where:Record<string,string>})=>{
 if(collection===SOCIAL_MVP_HANDOFFS)return {items:[{...f.package.scope,content,content_hash:socialRequestHash(content)}],totalItems:1};
 assert.equal(input.where.version,'1');assert.equal(input.where.evidence_version,'2');return {items:[{...input.where,content:evidenceContent,content_hash:evidenceHash}],totalItems:1};
 }} as unknown as DataStore;
 const result=await readSocialMvpHandoff(db,f.package.scope);assert.ok(result.package);assert.ok(result.gaps.includes('mvp_source_adapter_authority_verification_required'));assert.ok(result.gaps.includes('mvp_final_human_creative_acceptance_required'));
});
test('incomplete real-stack handoff stays blocked even with a frozen package',async()=>{
 const f=socialMvpHandoffFixture();const {recordHash:_,...body}=f.package;f.package.recordHash=socialRequestHash(body);f.A.packageHash=f.package.recordHash;const content={package:f.package,clips:[f.A],history:{A:0,B:0}};
 const result=await readSocialMvpHandoff(store([{...f.package.scope,content,content_hash:socialRequestHash(content)}]),f.package.scope);assert.deepEqual(result.gaps,['required_scene_clip_missing']);assert.equal(result.package,null);
});
