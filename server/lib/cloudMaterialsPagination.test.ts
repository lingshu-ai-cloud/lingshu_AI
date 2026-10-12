import test from 'node:test';
import assert from 'node:assert/strict';
import {readCloudMaterialLibrary} from './cloudMaterials.js';

test('tenant material recall reads every page, keeps unlisted records and excludes foreign rows',async()=>{
 const own=Array.from({length:501},(_,index)=>({id:`owned-${index}`,tenantId:'tenant-a',title:`素材 ${index}`,type:'video',scope:'own',sha256:'a'.repeat(64)}));
 const foreign={id:'foreign',tenantId:'tenant-b',title:'foreign',type:'video',scope:'own',sha256:'b'.repeat(64)};
 const calls:number[]=[];
 const store={list:async(_collection:string,query:any)=>{calls.push(query.page);return query.page===1?{items:own.slice(0,500),totalItems:502,page:1,perPage:500,totalPages:2}:{items:[own[500],foreign],totalItems:502,page:2,perPage:500,totalPages:2};}} as never;
 const result=await readCloudMaterialLibrary('tenant-a',undefined,store);
 assert.equal(result.source.state,'ready');assert.deepEqual(calls,[1,2]);assert.equal(result.items.length,501);assert.ok(result.items.some(item=>item.id==='pb-owned-500'));assert.ok(!result.items.some(item=>item.id==='pb-foreign'));
});
