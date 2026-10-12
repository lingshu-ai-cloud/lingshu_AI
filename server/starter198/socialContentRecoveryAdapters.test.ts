import assert from 'node:assert/strict';
import test from 'node:test';
import {socialProductionSupplyAdapters} from './socialContentRecoveryAdapters.js';
import type {SocialAssetSupplyProviderAdapter} from './socialContentAssetSupplyExecution.js';

const adapter=(adapterId:string):SocialAssetSupplyProviderAdapter=>({adapterId,sourceStrategies:['authorized_digital_presenter'],async execute(){return null;}});

test('mother-segment local crop adapter survives presenter execution filtering',()=>{
 const result=socialProductionSupplyAdapters({hasPresenterExecution:true,custom:[adapter('presenter_mother_segment.v1'),adapter('unsafe-per-shot-custom')],free:[],paid:()=>[]});
 assert.deepEqual(result.map(item=>item.adapterId),['presenter_mother_segment.v1']);
});
