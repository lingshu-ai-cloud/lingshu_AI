import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {registerEnterpriseProductMaterials} from './enterpriseProductMaterialRegistration.js';

test('enterprise product image registration is tenant-scoped, byte-hashed, traceable and idempotent',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'enterprise-product-register-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const tenant='tenant-a',relative=`tenants/${tenant}/products/main.png`,file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});const bytes=await sharp({create:{width:160,height:288,channels:3,background:'#77aacc'}}).png().toBuffer();fs.writeFileSync(file,bytes);
 const profile={id:'profile-a',tenant_id:tenant,updated_at:'2026-10-12T01:00:00Z',profile:{products:{items:[{id:'GUIANFA-RS-001',name:'云朵泡沫卸妆蜜',imageUrl:`/media/${relative}`,images:[{url:`/media/${relative}`}]}]}}};
 const dataStore={list:async()=>({items:[profile],totalItems:1,page:1,perPage:2,totalPages:1})} as never, writes:any[]=[];
 const upsert=(input:any)=>{writes.push(input);return {...input.record,id:input.id,tenantId:input.tenantId,contentSha256:input.contentSha256,productId:input.productId,productRef:input.productRef,sourceTaskIds:[input.taskId]};};
 const first=await registerEnterpriseProductMaterials({dataStore,tenantId:tenant,taskId:'task-1',productId:'GUIANFA-RS-001',mediaRoot:root,upsert});
 const second=await registerEnterpriseProductMaterials({dataStore,tenantId:tenant,taskId:'task-1',productId:'GUIANFA-RS-001',mediaRoot:root,upsert});
 assert.equal(first.length,1);assert.equal(second[0]!.id,first[0]!.id);assert.equal(writes.length,2,'idempotency is delegated to the canonical SHA upsert with the same identity');
 assert.equal(writes[0].contentSha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(writes[0].productRef,'product:GUIANFA-RS-001');assert.equal(writes[0].record.provenance.profileVersion,profile.updated_at);assert.equal(writes[0].record.provenance.sourceSha256,writes[0].contentSha256);
 assert.equal(writes[0].record.width,160);assert.equal(writes[0].record.height,288);assert.equal(writes[0].record.commercialUseApproved,true);assert.equal(writes[0].record.licenseEvidence,'enterprise_profile:profile-a:product:GUIANFA-RS-001');
 assert.deepEqual(await registerEnterpriseProductMaterials({dataStore,tenantId:tenant,taskId:'task-1',productId:'OTHER',mediaRoot:root,upsert}),[]);
 const foreignStore={list:async()=>({items:[{...profile,tenant_id:'tenant-b'}],totalItems:1,page:1,perPage:2,totalPages:1})} as never;
 await assert.rejects(registerEnterpriseProductMaterials({dataStore:foreignStore,tenantId:tenant,taskId:'task-1',productId:'GUIANFA-RS-001',mediaRoot:root,upsert}),/scope_invalid/);
});
