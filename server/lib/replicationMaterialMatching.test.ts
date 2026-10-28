import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchReplicationMaterial, matchReplicationMaterialFallback } from './replicationMaterialMatching.js';
const material = {id:'owned-video',tenantId:'tenant',scope:'own',type:'video',duration:12,file:'tenants/tenant/real.mp4',sourceType:'tenant_upload',contentSha256:'a'.repeat(64),segments:[{start:4,end:9,action:'传送带输送透明瓶，设备持续灌装液体',subject:['透明瓶','设备','液体']}]};
const input={tenantId:'tenant',shotDescription:'透明瓶在传送带输送，设备灌装液体',duration:3,materials:[material]};
test('matches concrete actions and subjects with timed trim and content binding',()=>{
 const result=matchReplicationMaterial(input)!;
 assert.equal(result.materialId,'owned-video');assert.equal(result.trimStart,4);assert.equal(result.trimEnd,7);assert.equal(result.contentSha256,'a'.repeat(64));
});
test('catalog images, other tenants, references, shared and test videos never match',()=>{
 for(const patch of [{type:'image'},{tenantId:'other'},{sourceType:'tiktok_reference'},{scope:'shared'},{synthetic:true}]) assert.equal(matchReplicationMaterial({...input,materials:[{...material,...patch}]}),null);
});
test('generic product words, wrong actions and insufficient clean duration return null',()=>{
 assert.equal(matchReplicationMaterial({...input,shotDescription:'产品展示'}),null);
 assert.equal(matchReplicationMaterial({...input,shotDescription:'手持瓶子涂抹液体'}),null);
 assert.equal(matchReplicationMaterial({...input,duration:6}),null);
 assert.equal(matchReplicationMaterial({...input,materials:[{...material,segments:[{start:4,end:9,action:'没有灌装；传送带输送透明瓶和液体设备'}]}]}),null);
});
test('product identity is exact and whole clip visual observations are accepted without inventing trim evidence',()=>{
 assert.equal(matchReplicationMaterial({...input,requiredProductId:'product-1'}),null);
 assert.ok(matchReplicationMaterial({...input,requiredProductId:'product-1',materials:[{...material,productId:'product-1'}]}));
 assert.equal(matchReplicationMaterial({...input,materials:[{...material,segments:[],tags:['透明瓶传送带灌装液体']}]}),null);
 const result=matchReplicationMaterial({...input,materials:[{...material,segments:[],visualObservations:['传送带输送透明瓶，设备灌装液体']}]})!;
 assert.equal(result.trimStart,0);
});
test('weekly matching prefers the exact product, then public semantic footage, then ordinary B-roll', () => {
 const product = {...material,id:'product-video',productId:'product-1'};
 const publicVideo = {...material,id:'public-video',scope:'shared',tenantId:'',sourceCategory:'official_import',sourceType:'official_import',productId:undefined};
 const ordinary = {...material,id:'factory-video',segments:[{start:0,end:5,action:'工厂机器灌装液体',subject:['设备','瓶']}],productId:undefined};
 const request = {...input,requiredProductId:'product-1'};
 assert.equal(matchReplicationMaterialFallback({...request,materials:[ordinary,publicVideo,product]})?.materialId,'product-video');
 const publicMatch=matchReplicationMaterialFallback({...request,materials:[ordinary,publicVideo]});
 assert.equal(publicMatch?.tier,'public');
 assert.match(publicMatch?.visualDescription || '',/示意画面/);
 const generic=matchReplicationMaterialFallback({...request,shotDescription:'产品包装展示',materials:[ordinary]});
 assert.equal(generic?.tier,'generic');
 assert.equal(generic?.materialId,'factory-video');
 assert.match(generic?.visualDescription || '',/不展示或证明本产品/);
 assert.equal(matchReplicationMaterialFallback({...request,shotDescription:'产品包装展示',materials:[{...ordinary,tenantId:'other'}]}),null);
});
