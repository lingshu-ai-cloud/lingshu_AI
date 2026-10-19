import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const storeUrl = new URL('./pbStore.ts', import.meta.url).href;
const authorityUrl = new URL('./dataAuthority.ts', import.meta.url).href;

function run(root: string, code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval',
      `const {pbStore}=await import(${JSON.stringify(storeUrl)});const {runWithDataAuthority}=await import(${JSON.stringify(authorityUrl)});await runWithDataAuthority('local',async()=>{${code}});`,
    ], { env: { ...process.env, NODE_ENV: 'test', ENABLE_LOCAL_DEV_FALLBACK: 'true', LOCAL_STORE_DIR: root }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', status => status === 0 ? resolve(stdout.trim()) : reject(Error(stderr)));
  });
}

test('fixed local-store binding reads and writes its configured directory', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'local-binding-fixed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = await run(root, `await pbStore.create('binding_probe',{id:'one',value:1});console.log((await pbStore.getById('binding_probe','one')).value);`);
  assert.equal(output, '1');
  assert.equal(JSON.parse(readFileSync(path.join(root, 'binding_probe.json'), 'utf8'))[0].value, 1);
});

test('changing LOCAL_STORE_DIR after import fails closed without writing either store', async t => {
  const initial = mkdtempSync(path.join(tmpdir(), 'local-binding-initial-'));
  const intended = mkdtempSync(path.join(tmpdir(), 'local-binding-intended-'));
  t.after(() => { rmSync(initial, { recursive: true, force: true }); rmSync(intended, { recursive: true, force: true }); });
  const output = await run(initial, `process.env.LOCAL_STORE_DIR=${JSON.stringify(intended)};for(const operation of [()=>pbStore.list('binding_probe'),()=>pbStore.create('binding_probe',{id:'wrong'}),()=>pbStore.update('binding_probe','wrong',{value:1}),()=>pbStore.delete('binding_probe','wrong')]){try{await operation();console.log('unexpected_success')}catch(error){console.log(error.message)}}`);
  assert.deepEqual(output.split('\n'), Array(4).fill('local_store_directory_changed_after_import'));
  assert.equal(existsSync(path.join(initial, 'binding_probe.json')), false);
  assert.equal(existsSync(path.join(intended, 'binding_probe.json')), false);
});
