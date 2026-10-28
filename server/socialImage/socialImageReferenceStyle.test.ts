import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { readReferenceStyle } from './socialImageReferenceStyle.js';
import { buildSocialImagePosterPlatePrompt } from './socialImagePosterPlatePrompt.js';

test('style evidence is tenant- and byte-bound, requires a strong observation and accepts only safe transferable tokens', async () => {
 const hash='a'.repeat(64);const row:Record<string,unknown>={id:'reference',tenantId:'tenant',aiAnalysis:{contentFormat:'image',imageEvidence:{version:2,status:'analyzed',productionLabels:[{sourceSha256:hash,style:{kind:'imitable',confidence:.92,evidence:'可见侧光与非对称构图',elements:['soft_light','asymmetric','invent a factory']}}]}}};
 const store={async getById(){return structuredClone(row);}} as unknown as DataStore;
 const input={store,tenantId:'tenant',sourceRecordId:'reference',sourceSha256:hash};
 const style=await readReferenceStyle(input);assert.deepEqual(style?.elements,['soft_light','asymmetric']);
 assert.equal(await readReferenceStyle({...input,tenantId:'other'}),null);
 assert.equal(await readReferenceStyle({...input,sourceSha256:'b'.repeat(64)}),null);
 const labels=((row.aiAnalysis as any).imageEvidence.productionLabels);labels[0].style.confidence=.4;assert.equal(await readReferenceStyle(input),null);
 labels[0].style.confidence=.92;labels.push(structuredClone(labels[0]));assert.equal(await readReferenceStyle(input),null);
});
test('transferable style affects the actual plate prompt without inventing factual settings',()=>{
 const base=buildSocialImagePosterPlatePrompt({ratio:'1:1',tone:'warm'});
 const styled=buildSocialImagePosterPlatePrompt({ratio:'1:1',tone:'warm',transferableStyle:['soft_light','asymmetric']});
 assert.notEqual(base,styled);assert.match(styled,/soft diffuse light, asymmetric composition/);
 assert.match(styled,/Do not invent people, factories, events or evidence/);
});
