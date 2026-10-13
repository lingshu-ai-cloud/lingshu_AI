import assert from 'node:assert/strict';
import express from 'express';

process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.DEMO_MODE = 'false';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';

const { auth } = await import('../storage/index.js');
const { bindDataAuthority, dataAuthorityRequestScope } = await import('../storage/dataAuthority.js');
auth.verifyToken = async () => {
  bindDataAuthority('local');
  return { userId: 'studio-contract-test-user', tenantId: 'local_tenant_studio_contract', dataAuthority: 'local' };
};

const { studioRouter } = await import('./studio.js');
const app = express();
app.use(dataAuthorityRequestScope);
app.use(express.json());
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');

try {
  const response = await fetch(`http://127.0.0.1:${address.port}/studio/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer studio-contract-test' },
    body: JSON.stringify({
      title: '冲突制作草稿',
      spec: {
        script: '当前确认脚本',
        storyboardAssignments: { S01: 'material-current' },
        analysisResults: {
          schemaVersion: 'studio-analysis.v1',
          storyboard: { script: '旧脚本', assignments: { S01: 'material-old' } },
          voiceover: {},
          shots: {},
        },
      },
    }),
  });
  const body = await response.json() as { code?: string; reasons?: string[] };
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.code, 'STUDIO_PRODUCTION_CONTRACT_CONFLICT');
  assert.deepEqual(body.reasons, ['脚本存在两个不一致版本', '逐镜素材绑定存在两个不一致版本']);
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
}

console.log('studio project production-contract integration passed');
