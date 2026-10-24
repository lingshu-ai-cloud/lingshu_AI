import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

/** Real local HTTP + real persistent fixture store; only Meta's transport is simulated. */
async function fixtureServer() {
  const effects: string[] = [], forbidden: string[] = [];
  let expired = false, healthUnavailable = false;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), method = init?.method || 'GET';
    if (url.origin === 'http://127.0.0.1:1') throw new TypeError('isolated PocketBase fixture unavailable');
    if (url.origin !== 'https://graph.facebook.com') { forbidden.push(`${method} ${url.origin}`); throw new Error('unexpected fixture network'); }
    const request = `${method} ${url.pathname}`; effects.push(request);
    if (request === 'POST /v26.0/oauth/access_token') {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('client_id'), '123'); assert.equal(body.get('client_secret'), 'fixture-app-secret');
      assert.equal(body.get('redirect_uri'), process.env.META_ADS_REDIRECT_URI);
      assert.ok(body.get('code')?.startsWith('fixture-code-'));
      return Response.json({access_token:'fixture-user-token'});
    }
    assert.equal(method, 'GET', 'fixture forbids all advertising writes');
    assert.equal(init?.body, undefined);
    if (request === 'GET /v26.0/debug_token') {
      if (healthUnavailable) throw new TypeError('simulated Graph connectivity unavailable');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer 123|fixture-app-secret');
      return Response.json({data:{is_valid:true,app_id:'123',user_id:'789',expires_at:Math.floor(Date.now()/1000)+(expired?-1:60*86400),scopes:['ads_read','ads_management','pages_show_list','pages_read_engagement','pages_manage_ads']}});
    }
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-user-token');
    if (request === 'GET /v26.0/me/adaccounts') return Response.json({data:[{id:'act_1',name:'New customer account',currency:'USD',account_status:1,timezone_name:'America/Los_Angeles'}]});
    if (request === 'GET /v26.0/me/accounts') return Response.json({data:[{id:'10',name:'Customer brand',tasks:['ADVERTISE'],access_token:'fixture-page-token'}]});
    if (request === 'GET /v26.0/act_1/promote_pages') return Response.json({data:[{id:'10'}]});
    if (request === 'GET /v26.0/10') return Response.json({id:'10',access_token:'fixture-page-token'});
    if (request === 'GET /v26.0/act_1') return Response.json({id:'act_1',account_id:'1',name:'New customer account',currency:'USD',account_status:1});
    if (request === 'GET /v26.0/act_1/campaigns') return Response.json({data:[]});
    forbidden.push(request); throw new Error('unexpected Graph fixture path');
  }) as typeof fetch;
  const { platformAdConnectionsRouter } = await import('../routes/platformAdConnections.js');
  const { issueLocalIdentityTokenForTest } = await import('../auth/localIdentity.js');
  const { store } = await import('../storage/index.js');
  const tokens = () => ({
    owner:issueLocalIdentityTokenForTest({userId:'customer',tenantId:'customer-tenant',role:'admin'},{jti:randomUUID()}),
    foreign:issueLocalIdentityTokenForTest({userId:'foreign',tenantId:'foreign-tenant',role:'admin'}),
    sameTenantOtherUser:issueLocalIdentityTokenForTest({userId:'colleague',tenantId:'customer-tenant',role:'admin'}),
  });
  const app = express(); app.use(express.json()); app.use('/ads',platformAdConnectionsRouter);
  const server = app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  process.on('message', async (message: any) => {
    try {
      let result: unknown;
      if (message.action === 'tokens') result = tokens();
      else if (message.action === 'seed-history') result = await store.create('platform_ad_tasks',{id:'customer-history',tenant_id:'customer-tenant',connectionId:message.connectionId,name:'Preserved customer plan',status:'DRAFT'});
      else if (message.action === 'health-unavailable') { healthUnavailable = message.value; result = true; }
      else if (message.action === 'expired') { expired = message.value; result = true; }
      else if (message.action === 'evidence') result = {effects,forbidden,history:await store.getById('platform_ad_tasks','customer-history'),connections:(await store.list('platform_ad_connections')).totalItems};
      else throw new Error('unknown fixture command');
      process.send?.({id:message.id,result});
    } catch (error) { process.send?.({id:message.id,error:String(error)}); }
  });
  process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
  process.send?.({ready:true,port:(server.address() as {port:number}).port,tokens:tokens()});
}

async function journey() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ad-customer-journey-'));
  let child: ChildProcess | undefined, messages = 0;
  const environment = {...process.env,LOCAL_STORE_DIR:dir,PB_URL:'http://127.0.0.1:1',PB_ADMIN_EMAIL:'',PB_ADMIN_PASSWORD:'',NODE_ENV:'test',DATA_BACKEND:'pocketbase',ENABLE_LOCAL_DEV_FALLBACK:'true',TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK:'true',TENANT_PLATFORM_APP_KEY:'fixture-encryption-key',OAUTH_STATE_SECRET:'fixture-session-key',META_ADS_API_VERSION:'v26.0',META_ADS_APP_ID:'123',META_ADS_APP_SECRET:'fixture-app-secret',META_ADS_LOGIN_MODE:'classic',META_ADS_REDIRECT_URI:'http://localhost:5197/api/overseas/platform-ads/oauth/meta/callback'};
  const start = async () => {
    child = spawn(process.execPath,['node_modules/tsx/dist/cli.mjs',fileURLToPath(import.meta.url),'--fixture-server'],{cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe','ipc']});
    let output = ''; child.stdout?.on('data',data=>{output+=data;}); child.stderr?.on('data',data=>{output+=data;});
    return await new Promise<any>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('fixture server timeout: '+output)),15000);
      child!.once('error',reject);child!.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error('fixture server failed: '+output));});
      child!.on('message',(message:any)=>{if(message.ready){clearTimeout(timer);resolve(message);}});
    });
  };
  const stop = async () => { const current=child;if(!current)return;if(current.exitCode!==null){child=undefined;return;}await new Promise<void>(resolve=>{current.once('exit',()=>resolve());current.kill('SIGTERM');});child=undefined; };
  const command = (action:string,extra:Record<string,unknown>={}) => new Promise<any>((resolve,reject)=>{
    const id=++messages;const listener=(message:any)=>{if(message.id!==id)return;child!.off('message',listener);message.error?reject(new Error(message.error)):resolve(message.result);};
    child!.on('message',listener);child!.send({id,action,...extra});
  });
  const allEffects:string[]=[];
  try {
    let runtime=await start(), base=`http://127.0.0.1:${runtime.port}/ads`, tokens=runtime.tokens;
    const request = async (route:string, options:{token?:string|null;method?:string;body?:unknown;status?:number}={}) => {
      const response=await fetch(base+route,{method:options.method||'GET',headers:{...(options.token===null?{}:{Authorization:`Bearer ${options.token||tokens.owner}`}),...(options.body===undefined?{}:{'Content-Type':'application/json'})},body:options.body===undefined?undefined:JSON.stringify(options.body),signal:AbortSignal.timeout(10000)});
      const text=await response.text();assert.equal(response.status,options.status??200,`${route}: ${text}`);
      if(!route.includes('/start'))for(const secret of ['fixture-user-token','fixture-page-token','fixture-app-secret','tokenCipher','stateHash'])assert.ok(!text.includes(secret),`public response leaked ${secret}`);
      return response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text;
    };
    await request('/connections',{token:null,status:401});assert.deepEqual((await request('/connections')).items,[]);
    const bind = async (number:number) => {
      const started=await request('/oauth/meta/start',{method:'POST',body:{}});const authorizationURL=new URL(started.url);
      assert.equal(authorizationURL.origin,'https://www.facebook.com');assert.equal(authorizationURL.searchParams.get('client_id'),'123');
      await request(`/oauth/meta/${started.sessionId}/accounts`,{token:tokens.foreign,status:409});
      await request(`/oauth/meta/${started.sessionId}/accounts`,{token:tokens.sameTenantOtherUser,status:409});
      const pending=await request('/oauth/meta/current');assert.equal(pending.session.sessionId,started.sessionId);assert.equal(pending.session.status,'pending');
      const callback=`/oauth/meta/callback?state=${authorizationURL.searchParams.get('state')}&code=fixture-code-${number}`;
      await request(callback,{token:null});await request(callback,{token:null,status:409});
      if(number===1){
        const beforeResume=await command('evidence');allEffects.push(...beforeResume.effects);assert.deepEqual(beforeResume.forbidden,[]);
        await stop();runtime=await start();base=`http://127.0.0.1:${runtime.port}/ads`;tokens=runtime.tokens;
      }
      const recovered=await request('/oauth/meta/current');assert.equal(recovered.session.status,'ready');assert.equal(recovered.session.sessionId,started.sessionId);
      const accounts=await request(`/oauth/meta/${started.sessionId}/accounts`);assert.equal(accounts.accounts[0].id,'act_1');
      const pages=await request(`/oauth/meta/${started.sessionId}/pages?accountId=act_1`);assert.equal(pages.items[0].id,'10');
      await request(`/oauth/meta/${started.sessionId}/connect`,{method:'POST',token:tokens.foreign,body:{accountId:'act_1',pageId:'10'},status:409});
      const connected=await request(`/oauth/meta/${started.sessionId}/connect`,{method:'POST',body:{accountId:'act_1',pageId:'10'}});
      assert.equal(connected.connection.defaultPage.id,'10');
      const again=await request(`/oauth/meta/${started.sessionId}/connect`,{method:'POST',body:{accountId:'act_1',pageId:'10'}});assert.equal(again.connection.id,connected.connection.id);
      return connected.connection;
    };
    const connection=await bind(1);const history=await command('seed-history',{connectionId:connection.id});
    const oldLogin=tokens.owner;tokens=await command('tokens');assert.notEqual(tokens.owner,oldLogin);
    assert.equal((await request('/connections')).items[0].id,connection.id,'fresh application login retains binding');
    const reauthorized=await bind(2);assert.equal(reauthorized.id,connection.id);assert.equal((await request('/connections')).items.length,1);
    assert.deepEqual((await command('evidence')).history,history,'reauthorization preserves exact historical record');
    const beforeRestart=await command('evidence');allEffects.push(...beforeRestart.effects);assert.deepEqual(beforeRestart.forbidden,[]);
    await stop();runtime=await start();base=`http://127.0.0.1:${runtime.port}/ads`;tokens=runtime.tokens;
    assert.equal((await request('/connections')).items[0].id,connection.id,'new server process reads persisted connection');
    assert.deepEqual((await command('evidence')).history,history,'history survives server process restart');
    assert.deepEqual((await request('/connections',{token:tokens.foreign})).items,[]);
    await request(`/connections/${connection.id}/campaigns`,{token:tokens.foreign,status:404});
    await command('health-unavailable',{value:true});
    const unavailable=await request(`/connections/${connection.id}/authorization/check`,{method:'POST',body:{},status:503});assert.equal(unavailable.code,'AUTH_CHECK_UNAVAILABLE');
    assert.equal((await request('/connections')).items[0].authorization.status,'healthy','transient inspection failure preserves last known evidence');
    await command('health-unavailable',{value:false});
    await command('expired',{value:true});
    assert.equal((await request(`/connections/${connection.id}/authorization/check`,{method:'POST',body:{}})).connection.authorization.status,'expired');
    const readsBefore=(await command('evidence')).effects.length;
    const blocked=await request(`/connections/${connection.id}/campaigns`,{status:409});assert.equal(blocked.code,'AUTH_EXPIRED');
    assert.equal((await command('evidence')).effects.length,readsBefore,'expired gate prevents provider reads');
    await command('expired',{value:false});await request(`/connections/${connection.id}/authorization/check`,{method:'POST',body:{}});
    const payload=Buffer.from(JSON.stringify({algorithm:'HMAC-SHA256',issued_at:Math.floor(Date.now()/1000),user_id:'789',app_id:'123'})).toString('base64url');
    const signed=`${createHmac('sha256','fixture-app-secret').update(payload).digest('base64url')}.${payload}`;
    const revoke=await fetch(base+'/oauth/meta/deauthorize',{method:'POST',body:new URLSearchParams({signed_request:signed})});assert.equal(revoke.status,200);
    const listed=await request('/connections');assert.equal(listed.items[0].authorization.status,'revoked');
    const revoked=await request(`/connections/${connection.id}/campaigns`,{status:409});assert.equal(revoked.code,'USER_REVOKED');
    const final=await command('evidence');allEffects.push(...final.effects);assert.deepEqual(final.forbidden,[]);assert.deepEqual(final.history,history);assert.equal(final.connections,1);
    assert.equal(allEffects.filter(effect=>effect==='POST /v26.0/oauth/access_token').length,2);
    assert.ok(allEffects.every(effect=>effect.startsWith('GET ')||effect==='POST /v26.0/oauth/access_token'),'no ad create/update/activate/budget/upload writes');
    console.log('Meta new-customer HTTP journey passed: bind, resume, fresh login, reauthorize same ID, process restart, tenant isolation, expiry/revocation gates, exact history preservation; no ad writes');
  } finally { await stop();fs.rmSync(dir,{recursive:true,force:true}); }
}
if(process.argv.includes('--fixture-server'))await fixtureServer();else await journey();
