import assert from 'node:assert/strict';
import test from 'node:test';
import {admitExternalSupplyAdapters,socialProductionSupplyAdapters} from './socialContentRecoveryAdapters.js';
import type {SocialAssetSupplyProviderAdapter} from './socialContentAssetSupplyExecution.js';

const adapter=(adapterId:string):SocialAssetSupplyProviderAdapter=>({adapterId,sourceStrategies:['authorized_digital_presenter'],async execute(){return null;}});

test('mother-segment local crop adapter survives presenter execution filtering',()=>{
 const result=socialProductionSupplyAdapters({hasPresenterExecution:true,custom:[adapter('presenter_mother_segment.v1'),adapter('unsafe-per-shot-custom')],free:[],paid:()=>[]});
 assert.deepEqual(result.map(item=>item.adapterId),['presenter_mother_segment.v1']);
});

test('weekly opaque adapters fail closed before execute; manual and built-in recovery remain',async()=>{
 let calls=0;
 const injected:SocialAssetSupplyProviderAdapter={adapterId:'injected',sourceStrategies:['customer_real_asset'],async execute(){calls++;return null;}};
 assert.throws(()=>admitExternalSupplyAdapters({adapters:[injected],weekly:true}),/weekly_custom_supplier_submit_boundary_unverified/);
 assert.equal(calls,0);
 assert.deepEqual(admitExternalSupplyAdapters({adapters:[],weekly:true}),[]);
 const manual=admitExternalSupplyAdapters({adapters:[injected],weekly:false});
 assert.equal(manual[0],injected);
 await manual[0]!.execute({} as Parameters<SocialAssetSupplyProviderAdapter['execute']>[0]);
 assert.equal(calls,1);
});
