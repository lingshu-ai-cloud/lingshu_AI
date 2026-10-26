import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('HTTP pack edits, reload and import stay inside the authenticated tenant and preserve shared templates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tenant-faq-packs-'));
  const keys = ['LOCAL_STORE_DIR', 'NODE_ENV', 'ENABLE_LOCAL_DEV_FALLBACK', 'PB_URL'];
  const before = keys.map(key => process.env[key]);
  Object.assign(process.env, { LOCAL_STORE_DIR: dir, NODE_ENV: 'test', ENABLE_LOCAL_DEV_FALLBACK: 'true', PB_URL: 'http://127.0.0.1:1' });
  const [{enterpriseRouter}, {auth}, {writeTenantProfile, normalizeProfile}, {dataAuthorityRequestScope, runWithDataAuthority, bindDataAuthority}] = await Promise.all([
    import('./enterprise'), import('../storage/index'), import('./enterpriseProfileStore'), import('../storage/dataAuthority'),
  ]);
  const originalAuth = auth.verifyToken;
  auth.verifyToken = async header => {
    const tenantId = header === 'Bearer a' ? 'tenant-a' : header === 'Bearer b' ? 'tenant-b' : '';
    if (tenantId) bindDataAuthority('local');
    return tenantId ? { tenantId, userId: `owner-${tenantId}`, dataAuthority: 'local' as const } : null;
  };
  const template = new URL('../knowledge/packs/general/presales.json', import.meta.url);
  const originalTemplate = await readFile(template);
  const app = express(); app.use(express.json()); app.use(dataAuthorityRequestScope); app.use('/enterprise', enterpriseRouter);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const api = async (token: string, resource: string, method = 'GET', body?: unknown, version?: string) => {
    const r = await fetch(`http://127.0.0.1:${address.port}/enterprise${resource}`, {method, headers: {'Content-Type':'application/json', Authorization:`Bearer ${token}`, ...(version ? {'If-Match':`"${version}"`} : {})}, ...(body ? {body:JSON.stringify(body)} : {})});
    return {status:r.status, body:await r.json() as any};
  };
  try {
    for (const tenantId of ['tenant-a','tenant-b']) await runWithDataAuthority('local', () => writeTenantProfile(tenantId, normalizeProfile({company:{name:tenantId}} as any), 'owner'));
    const initial = await api('a','/profile');
    const items = [{q:'本企业的样品政策？',a:'只属于租户 A 的样品答复。'}];
    const saved = await api('a','/profile?tenantId=tenant-b','PATCH',{tenantId:'tenant-b',faqPackOverrides:{'general/presales':{items}}},initial.body.factVersion.contentHash);
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    const packA = (await api('a','/faq/packs')).body.packs.find((p:any)=>p.id==='general/presales');
    assert.equal(packA.customized,true); assert.equal(packA.items[0].a,items[0].a);
    const packB = (await api('b','/faq/packs?tenantId=tenant-a')).body.packs.find((p:any)=>p.id==='general/presales');
    assert.equal(packB.customized,false); assert.ok(!JSON.stringify(packB).includes('只属于租户 A'));
    assert.equal((await api('b','/profile')).body.faqPackOverrides,undefined);
    assert.equal((await api('','/faq/packs')).status,401);
    const stale = await api('a','/profile','PATCH',{faqPackOverrides:{'general/presales':{items:[{q:'旧页面覆盖',a:'不应成功'}]}}},initial.body.factVersion.contentHash);
    assert.equal(stale.status,409);
    const imported = await api('a','/faq/packs/import','POST',{industry:'general',scenario:'presales',questions:[items[0].q],tenantId:'tenant-b'});
    assert.equal(imported.status,200); assert.equal(imported.body.imported,1);
    assert.equal(imported.body.profile.faq[0].answer,items[0].a);
    assert.equal(imported.body.profile.faq[0].approvedForAuto,false);
    assert.equal((await api('b','/profile')).body.faq.length,0);
    assert.deepEqual(await readFile(template),originalTemplate);
  } finally {
    auth.verifyToken = originalAuth; server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r()));
    keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];});
    await rm(dir,{recursive:true,force:true});
  }
});
