import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-video-admission-'));
process.env.NODE_ENV = 'development';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.LOCAL_STORE_DIR = temporary;

const [{acquireDiscoveryAdmissionLease},{releaseDurableOperationLease},{runWithDataAuthority},{store}] = await Promise.all([
  import('./videos.js'),
  import('../runtime/durableLease.js'),
  import('../storage/dataAuthority.js'),
  import('../storage/index.js'),
]);

test('approved candidate admission serializes concurrent workers for one tenant',async()=>{
  try {
    await runWithDataAuthority('local',async()=>{
      const first=await acquireDiscoveryAdmissionLease('tenant-admission');
      let secondAcquired=false;
      const pending=acquireDiscoveryAdmissionLease('tenant-admission').then(lease=>{secondAcquired=true;return lease;});
      await new Promise(resolve=>setTimeout(resolve,180));
      assert.equal(secondAcquired,false,'second worker must not perform its inventory read while the first owns admission');
      await releaseDurableOperationLease({dataStore:store,lease:first});
      const second=await pending;
      assert.equal(secondAcquired,true);
      await releaseDurableOperationLease({dataStore:store,lease:second});
    });
  } finally {
    fs.rmSync(temporary,{recursive:true,force:true});
  }
});
