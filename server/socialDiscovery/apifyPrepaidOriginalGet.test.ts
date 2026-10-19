import assert from 'node:assert/strict';
import test from 'node:test';
import {createApifyPrepaidOriginalGetPort} from './apifyPrepaidOriginalGet.js';

test('original GET uses dedicated token only on exact Apify read endpoints',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];
 const fetcher=(async(url:string|URL|Request,init?:RequestInit)=>{calls.push({url:String(url),init:init!});const response=new Response(JSON.stringify({data:{id:'run'}}),{status:200});Object.defineProperty(response,'url',{value:String(url)});return response;}) as typeof fetch;
 const port=createApifyPrepaidOriginalGetPort(fetcher);
 const urls=['https://api.apify.com/v2/actors/clockworks~tiktok-scraper','https://api.apify.com/v2/actor-runs/run123','https://api.apify.com/v2/datasets/dataset123/items?offset=0&limit=5&format=json'];
 for(const url of urls)assert.deepEqual((await port.get({url,token:'dedicated-secret'})).body,{data:{id:'run'}});
 assert.equal(calls.length,3);
 for(const call of calls){assert.equal(call.init.method,'GET');assert.equal((call.init.headers as Record<string,string>).Authorization,'Bearer dedicated-secret');assert.equal(call.init.redirect,'error');assert.equal(call.init.cache,'no-store');}
 assert.ok(!JSON.stringify(await port.get({url:urls[0]!,token:'dedicated-secret'})).includes('dedicated-secret'));
});

test('original GET refuses alternate hosts, paid/write routes, token queries and redirected responses before receipt',async()=>{
 let calls=0;
 const fetcher=(async(url:string|URL|Request)=>{calls++;const response=new Response('{}',{status:200});Object.defineProperty(response,'url',{value:String(url)});return response;}) as typeof fetch;
 const port=createApifyPrepaidOriginalGetPort(fetcher);
 for(const url of ['https://evil.example/v2/actor-runs/r','http://api.apify.com/v2/actor-runs/r','https://api.apify.com/v2/actors/a~b/runs','https://api.apify.com/v2/actor-runs/r?token=secret','https://api.apify.com/v2/datasets/d/items?offset=0&limit=100&format=json','https://api.apify.com/v2/datasets/d/items?offset=5&limit=5&format=json','https://api.apify.com/v2/key-value-stores/x/records/y'])await assert.rejects(port.get({url,token:'dedicated-secret'}),/prepaid_original_get_unverified/);
 assert.equal(calls,0);
 const run='https://api.apify.com/v2/actor-runs/r';
 const reply=(body:string,status:number,url:string)=>{const response=new Response(body,{status});Object.defineProperty(response,'url',{value:url});return response;};
 await assert.rejects(createApifyPrepaidOriginalGetPort((async()=>reply('{broken',200,run)) as typeof fetch).get({url:run,token:'dedicated-secret'}),/prepaid_original_get_unverified/);
 await assert.rejects(createApifyPrepaidOriginalGetPort((async()=>reply('{}',401,run)) as typeof fetch).get({url:run,token:'dedicated-secret'}),/prepaid_original_get_unverified/);
 await assert.rejects(createApifyPrepaidOriginalGetPort((async()=>reply('{}',200,'https://evil.example/v2/actor-runs/r')) as typeof fetch).get({url:run,token:'dedicated-secret'}),/prepaid_original_get_unverified/);
});
