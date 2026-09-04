/** Isolated real-PocketBase migration rehearsal; never opens the deployed DB. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { DIGITAL_EMPLOYEE_MIGRATIONS } from './check-digital-employee-migrations.js';

const root = process.cwd();
const binary = process.env.PB_REHEARSAL_BIN;
assert.ok(binary && path.isAbsolute(binary), 'PB_REHEARSAL_BIN must name an explicit local executable');
assert.match(execFileSync(binary, ['--version'], { encoding: 'utf8' }), /0\.39\.5\b/, 'use the release Dockerfile PocketBase version');
const baseline = '7133ded3c5a78654c9ea048fc61c1bafb96ddf74';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-release-migrations-'));
const results: unknown[] = [];
const run = (args: string[]) => {
  const output = execFileSync(binary, args, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.doesNotMatch(output, /Error:|failed to apply migration/, 'PocketBase CLI may report an error with exit code zero');
  return output;
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const port = async () => {
  const listener = net.createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const selected = (listener.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  return selected;
};
try {
  for (const scenario of ['fresh', 'baseline-upgrade', 'setup-first-upgrade']) {
    const work = path.join(temporary, scenario);
    const migrations = path.join(work, 'migrations');
    const data = path.join(work, 'data');
    const hooks = path.join(work, 'hooks');
    fs.mkdirSync(migrations, { recursive: true }); fs.mkdirSync(hooks);
    for (const file of fs.readdirSync(path.join(root, 'pb_migrations'))) {
      if (!file.endsWith('.js') || (scenario !== 'fresh' && DIGITAL_EMPLOYEE_MIGRATIONS.includes(file as any))) continue;
      fs.copyFileSync(path.join(root, 'pb_migrations', file), path.join(migrations, file));
    }
    const flags = [`--dir=${data}`, `--migrationsDir=${migrations}`, `--hooksDir=${hooks}`, '--automigrate=false'];
    run(['migrate', 'up', ...flags]);
    const email = 'rehearsal@lingshu.invalid';
    const password = randomUUID();
    run(['superuser', 'upsert', email, password, ...flags]);
    const origin = `http://127.0.0.1:${await port()}`;
    let output = '';
    let child: ReturnType<typeof spawn> | undefined;
    const stop = async () => {
      if (!child || child.exitCode !== null) return;
      const current = child;
      const exited = new Promise<void>(resolve => current.once('exit', () => resolve()));
      current.kill('SIGTERM');
      const timer = setTimeout(() => current.kill('SIGKILL'), 5_000);
      await exited; clearTimeout(timer); child = undefined;
    };
    const start = async () => {
      child = spawn(binary, ['serve', `--http=${origin.slice(7)}`, '--hooksWatch=false', ...flags], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.on('data', chunk => { output += chunk; }); child.stderr?.on('data', chunk => { output += chunk; });
      for (let attempt = 0; attempt < 80; attempt++) {
        if (child.exitCode !== null) throw new Error(output.slice(-3000));
        try { if ((await fetch(origin + '/api/health', { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
        await sleep(100);
      }
      throw new Error('isolated PocketBase did not become healthy');
    };
    let token = '';
    const request = async (endpoint: string, method = 'GET', body?: unknown, authorized = true) => {
      const response = await fetch(origin + '/api/' + endpoint, {
        method, headers: { 'content-type': 'application/json', ...(authorized && token ? { authorization: token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
      return { response, value: await response.json() as any };
    };
    const authenticate = async () => {
      const auth = await request('collections/_superusers/auth-with-password', 'POST', { identity: email, password });
      assert.ok(auth.response.ok); token = auth.value.token;
    };
    const setup = (script: string) => execFileSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), script], {
      cwd: root, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', PB_URL: origin, PB_ADMIN_EMAIL: email, PB_ADMIN_PASSWORD: password,
        WORKBENCH_ADMIN_EMAIL: '', WORKBENCH_ADMIN_PASSWORD: '' },
    });
    try {
      await start(); await authenticate();
      if (scenario === 'baseline-upgrade') {
        fs.mkdirSync(path.join(work, 'scripts'));
        fs.symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), 'dir');
        const oldSetup = path.join(work, 'scripts/setup-pb.ts');
        fs.writeFileSync(oldSetup, execFileSync('git', ['show', `${baseline}:scripts/setup-pb.ts`], { cwd: root }));
        setup(oldSetup);
      } else setup(path.join(root, 'scripts/setup-pb.ts'));
      const before = (await request('collections?perPage=500')).value.items as any[];
      const sentinel = await request('collections/tenants/records', 'POST', { name: 'release rehearsal sentinel', companyName: scenario });
      assert.ok(sentinel.response.ok, JSON.stringify(sentinel.value));
      if (scenario !== 'fresh') {
        await stop();
        for (const file of DIGITAL_EMPLOYEE_MIGRATIONS) fs.copyFileSync(path.join(root, 'pb_migrations', file), path.join(migrations, file));
        run(['migrate', 'up', ...flags]);
        await start(); await authenticate();
      }
      setup(path.join(root, 'scripts/setup-pb.ts'));
      const after = (await request('collections?perPage=500')).value.items as any[];
      for (const collection of before) {
        const next = after.find(item => item.name === collection.name);
        assert.ok(next && next.id === collection.id, 'existing collection identity must survive');
        for (const field of collection.fields) assert.ok(next.fields.some((item: any) => item.name === field.name && item.id === field.id), `${collection.name}.${field.name} must survive`);
      }
      const retained = await request(`collections/tenants/records/${sentinel.value.id}`);
      assert.equal(retained.value.companyName, scenario);
      for (const name of ['workflow_tasks', 'followup_batch_items', 'content_batch_plans', 'digital_employee_config_versions']) {
        const collection = after.find(item => item.name === name);
        assert.ok(collection, name);
        for (const rule of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule']) assert.equal(collection[rule], null, name + '.' + rule);
        assert.equal((await request(`collections/${name}/records`, 'GET', undefined, false)).response.status, 403);
      }
      const configBody = { tenant_id: sentinel.value.id, config: { mode: 'rehearsal' }, status: 'draft', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      assert.ok((await request('collections/digital_employee_configs/records', 'POST', configBody)).response.ok);
      assert.equal((await request('collections/digital_employee_configs/records', 'POST', configBody)).response.status, 400, 'tenant configuration uniqueness');
      if (scenario === 'fresh') {
        const routeOutput = execFileSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'scripts/verify-digital-employee-pb-routes.ts')], {
          cwd: root, timeout: 90_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NODE_ENV: 'test', PB_URL: origin, PB_ADMIN_EMAIL: email, PB_ADMIN_PASSWORD: password,
            LINGSHU_PB_REHEARSAL: 'isolated', LINGSHU_LOCAL_STORE_DIR: path.join(work, 'local-store') },
        });
        console.log(routeOutput.trim());
      }
      await stop();
      assert.match(run(['migrate', 'up', ...flags]), /No new migrations/, 'second execution must be a no-op');
      results.push({ scenario, passed: true, collections: after.length, originalCollections: before.length, dataPreserved: true, anonymousAccessDenied: true });
      console.log(`[migration] ${scenario}: passed`);
    } finally { await stop(); fs.writeFileSync(path.join(work, 'pocketbase.log'), output); }
  }
} finally {
  fs.writeFileSync(path.join(temporary, 'report.json'), JSON.stringify({ baseline, pocketbase: '0.39.5', results,
    limitation: 'Reconstructed checked-in baseline, not a copy of the live target database; no deployment performed.' }, null, 2));
  console.log(`[migration] preserved rehearsal evidence: ${temporary}`);
}
