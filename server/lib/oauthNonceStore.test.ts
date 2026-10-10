import { assertExactOAuthRedirectUri, validatedProductionOAuthOrigin, getPublicOrigin } from './oauthConfig.js';
import type { Request } from 'express';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { issueOAuthNonce, consumeOAuthNonce, oauthClientIdentityHash } from './oauthNonceStore.js';
import { getTenantMetaOAuthClient, getTenantInstagramOAuthClient, getTenantTikTokOAuthClient, signOAuthState, parseOAuthState } from './tenantPlatformApps.js';
import type { DataStore, Record_ } from '../storage/datastore.js';

test('durable nonce rejects replay, expiry, tenant/user/platform/client changes and concurrent consumers',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'oauth-nonce-'));const now=Date.now();const binding={tenantId:'tenant',userId:'user',platform:'instagram',expiresAt:now+60000,clientHash:oauthClientIdentityHash({appId:'native',appSecret:'fake'})};const options={directory,production:false,now};
 try{await issueOAuthNonce('state',binding,options);for(const change of [{tenantId:'other'},{userId:'other'},{platform:'facebook'},{clientHash:'other'}])assert.equal(await consumeOAuthNonce('state',{...binding,...change},options),false);
 assert.equal(await consumeOAuthNonce('state',binding,{...options,now:now+60000}),false);
 const results=await Promise.all(Array.from({length:8},()=>consumeOAuthNonce('state',binding,options)));assert.equal(results.filter(Boolean).length,1);assert.equal(await consumeOAuthNonce('state',binding,{...options}),false);
 await issueOAuthNonce('crash-safe',binding,options);
 const moduleUrl = new URL('./oauthNonceStore.ts', import.meta.url).href;
 const child=()=>new Promise<number>((resolve,reject)=>{const script=`import {consumeOAuthNonce} from ${JSON.stringify(moduleUrl)}; const ok=await consumeOAuthNonce('crash-safe',${JSON.stringify(binding)},{directory:${JSON.stringify(directory)},production:false,now:${now},dataStore:{supportsAtomicOperationLease:()=>false}});process.exit(ok?0:2);`;const p=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{stdio:'ignore'});p.on('error',reject);p.on('exit',code=>resolve(code??3));});
 assert.deepEqual((await Promise.all([child(),child()])).sort(),[0,2]);assert.equal(await consumeOAuthNonce('crash-safe',binding,options),false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('production refuses non-atomic storage instead of local fallback',async()=>{const dataStore={supportsAtomicOperationLease:()=>false} as unknown as DataStore;const binding={tenantId:'tenant',userId:'user',platform:'instagram',expiresAt:Date.now()+60000,clientHash:'fake'};await assert.rejects(issueOAuthNonce('state',binding,{dataStore,production:true}),/atomic_storage_required/);assert.equal(await consumeOAuthNonce('state',binding,{dataStore,production:true}),false);});
test('tenant OAuth config does not fall back to global credentials; strict state rejects unsafe return and extra signature fields',async()=>{
 process.env.META_SOCIAL_APP_ID='global';process.env.META_SOCIAL_APP_SECRET='global';process.env.INSTAGRAM_APP_ID='global';process.env.INSTAGRAM_APP_SECRET='global';process.env.TIKTOK_CLIENT_KEY='global';process.env.TIKTOK_CLIENT_SECRET='global';
 const missing={list:async()=>({items:[],totalItems:0})} as unknown as DataStore;
 for(const getter of [getTenantMetaOAuthClient,getTenantInstagramOAuthClient,getTenantTikTokOAuthClient]) { assert.equal(await getter('missing-test-tenant',missing),null); const foreign={list:async()=>({items:[{id:'foreign',tenant_id:'other',platform:'meta',app_id:'id',app_secret:'secret'}],totalItems:1})} as unknown as DataStore; assert.equal(await getter('tenant',foreign),null); }
 const state=signOAuthState({tenantId:'tenant',userId:'user',platform:'instagram',returnTo:'/ok'});assert.ok(parseOAuthState(state));assert.equal(parseOAuthState(state+'.extra'),null);assert.equal(parseOAuthState(signOAuthState({tenantId:'tenant',userId:'user',platform:'instagram',returnTo:'//evil'})),null);
});

test('existing atomic durable collection arbitrates exactly one production callback across helper instances',async()=>{
 const rows=new Map<string,Record_>();const dataStore={supportsAtomicOperationLease:()=>true,create:async(_collection:string,data:Record<string,unknown>)=>{const key=JSON.stringify([data.tenant_id,data.lease_scope,data.subject_id]);if(rows.has(key))return null;const row={id:String(rows.size+1),...data};rows.set(key,row);return structuredClone(row);},list:async(_collection:string,query:{where:Record<string,unknown>})=>{const items=[...rows.values()].filter(row=>Object.entries(query.where).every(([key,value])=>row[key]===value));return {items,totalItems:items.length};}} as unknown as DataStore;
 const binding={tenantId:'tenant',userId:'user',platform:'facebook',expiresAt:Date.now()+60000,clientHash:'client'};const options={dataStore,production:true};await issueOAuthNonce('production-state',binding,options);
 assert.equal((await Promise.all(Array.from({length:12},()=>consumeOAuthNonce('production-state',binding,options)))).filter(Boolean).length,1);assert.equal(await consumeOAuthNonce('production-state',binding,{...options}),false);
});

test('production OAuth origin ignores forwarded host and requires exact HTTPS origin and signed callback',()=>{
 for(const value of [undefined,'','http://safe.test','https://u:p@safe.test','https://safe.test/path','https://safe.test/?q=x','https://safe.test/#x'])assert.throws(()=>validatedProductionOAuthOrigin(value));
 assert.equal(validatedProductionOAuthOrigin('https://safe.test/'),'https://safe.test');
 const previousNode=process.env.NODE_ENV,previousOrigin=process.env.PUBLIC_BASE_URL,previousKey=process.env.TENANT_PLATFORM_APP_KEY;try{process.env.TENANT_PLATFORM_APP_KEY=Buffer.alloc(32,7).toString('base64');process.env.NODE_ENV='production';delete process.env.PUBLIC_BASE_URL;const request={headers:{'x-forwarded-proto':'https'},protocol:'https',get:()=> 'attacker.test'} as unknown as Request;assert.throws(()=>getPublicOrigin(request),/origin_required/);process.env.PUBLIC_BASE_URL='https://safe.test';assert.equal(getPublicOrigin(request),'https://safe.test');
 const uri='https://safe.test/api/overseas/social/oauth/instagram/callback';const state=signOAuthState({tenantId:'tenant',userId:'user',platform:'instagram',returnTo:'/',redirectUri:uri});assert.equal(parseOAuthState(state)?.redirectUri,uri);assert.doesNotThrow(()=>assertExactOAuthRedirectUri(parseOAuthState(state)?.redirectUri,uri));assert.throws(()=>assertExactOAuthRedirectUri(parseOAuthState(state)?.redirectUri,'https://changed.test/api/overseas/social/oauth/instagram/callback'));assert.throws(()=>assertExactOAuthRedirectUri(undefined,uri));
 }finally{if(previousKey===undefined)delete process.env.TENANT_PLATFORM_APP_KEY;else process.env.TENANT_PLATFORM_APP_KEY=previousKey;if(previousNode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousNode;if(previousOrigin===undefined)delete process.env.PUBLIC_BASE_URL;else process.env.PUBLIC_BASE_URL=previousOrigin;}
});
