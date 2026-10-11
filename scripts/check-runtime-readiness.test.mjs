import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {checkRuntimeReadiness} from './check-runtime-readiness.mjs';

// All HTTP fixtures bind exclusively to loopback; no application, env or credentials.
const readyReport = () => ({
  status: 'ready', issues: [], role: 'web',
  build: {commitSha: 'a'.repeat(40), version: 'fixture', startedAt: '2026-10-11T00:00:00Z'},
  capabilities: {text_generation: {ready: true}},
  socialOperating: {worker: {ready: true}},
});

async function withServer(handler, check) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({method: req.method, path: req.url, authorization: req.headers.authorization});
    handler(req, res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/api/overseas/ready`;
  try { await check(url, requests); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

function response(body, {status = 200, contentType = 'application/json'} = {}) {
  return (_req, res) => {
    res.writeHead(status, {'Content-Type': contentType});
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
}

test('accepts actual ready JSON shape with one unauthenticated GET', async () => {
  await withServer(response(readyReport()), async (url, requests) => {
    const report = await checkRuntimeReadiness(url);
    assert.equal(report.status, 'ready');
    assert.deepEqual(report.issues, []);
    assert.deepEqual(requests, [{method: 'GET', path: '/api/overseas/ready', authorization: undefined}]);
  });
});

test('accepts JSON media type with charset and structured JSON suffix', async () => {
  for (const contentType of ['application/json; charset=utf-8', 'application/readiness+json']) {
    await withServer(response(readyReport(), {contentType}), async url => {
      assert.equal((await checkRuntimeReadiness(url)).status, 'ready');
    });
  }
});

const invalidResponses = [
  ['SPA HTML with HTTP 200', '<html>fixture-private-body</html>', {contentType: 'text/html'}],
  ['JSON body with wrong content type', readyReport(), {contentType: 'text/plain'}],
  ['invalid JSON', '{"fixture-private-body":', {}],
  ['array JSON', [], {}],
  ['null JSON', null, {}],
  ['degraded status', {...readyReport(), status: 'degraded'}, {}],
  ['nonempty issues', {...readyReport(), issues: ['fixture-private-body']}, {}],
  ['missing status', {issues: []}, {}],
  ['missing issues', {status: 'ready'}, {}],
  ['wrong issues type', {...readyReport(), issues: {}}, {}],
  ['missing build role and capabilities', {status: 'ready', issues: []}, {}],
  ['invalid role', {...readyReport(), role: 'fixture-invalid'}, {}],
  ['array capabilities', {...readyReport(), capabilities: []}, {}],
  ['incomplete build metadata', {...readyReport(), build: {commitSha: 'a'.repeat(40)}}, {}],
  ['HTTP 503 despite ready body', readyReport(), {status: 503}],
];

for (const [name, body, options] of invalidResponses) {
  test(`rejects ${name}`, async () => {
    await withServer(response(body, options), async (url, requests) => {
      await assert.rejects(checkRuntimeReadiness(url), error => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('fixture-private-body'));
        assert.ok(!error.message.includes(url));
        return true;
      });
      assert.equal(requests.length, 1);
    });
  });
}

test('rejects redirect without following its target', async () => {
  await withServer((req, res) => {
    if (req.url === '/redirect-target') return response(readyReport())(req, res);
    res.writeHead(302, {Location: '/redirect-target'});
    res.end();
  }, async (url, requests) => {
    await assert.rejects(checkRuntimeReadiness(url));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, '/api/overseas/ready');
  });
});

test('times out a response that never sends headers', async () => {
  await withServer(() => {}, async url => {
    await assert.rejects(checkRuntimeReadiness(url, {timeoutMs: 50}));
  });
});

test('bounds response reading when headers arrive but body never finishes', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write('{"status":');
  }, async url => {
    await assert.rejects(checkRuntimeReadiness(url, {timeoutMs: 50}));
  });
});

test('rejects oversized bodies', async () => {
  await withServer(response({...readyReport(), padding: 'x'.repeat(1024)}), async url => {
    await assert.rejects(checkRuntimeReadiness(url, {maxBytes: 256}));
  });
});

test('rejects embedded URL credentials without sending a request', async () => {
  await withServer(response(readyReport()), async (url, requests) => {
    const credentialUrl = url.replace('http://', 'http://fixture-user:fixture-password@');
    await assert.rejects(checkRuntimeReadiness(credentialUrl), error => {
      assert.ok(!error.message.includes('fixture-password'));
      return true;
    });
    assert.equal(requests.length, 0);
  });
});

const runCli = promisify(execFile);
const cliPath = fileURLToPath(new URL('./check-runtime-readiness.mjs', import.meta.url));

test('CLI exits zero only for ready JSON and does not print response fields', async () => {
  await withServer(response({...readyReport(), privateFixture: 'fixture-private-body'}), async url => {
    const {stdout, stderr} = await runCli(process.execPath, [cliPath, url], {env: {}, timeout: 2000});
    assert.match(stdout, /Runtime readiness passed/);
    assert.equal(stderr, '');
    assert.ok(!stdout.includes('fixture-private-body'));
    assert.ok(!stdout.includes(url));
  });
});

test('CLI exits nonzero for HTML and never echoes response body or target URL', async () => {
  await withServer(response('<html>fixture-private-body</html>', {contentType: 'text/html'}), async url => {
    await assert.rejects(runCli(process.execPath, [cliPath, url], {env: {}, timeout: 2000}), error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /Runtime readiness failed/);
      assert.ok(!error.stderr.includes('fixture-private-body'));
      assert.ok(!error.stderr.includes(url));
      return true;
    });
  });
});
