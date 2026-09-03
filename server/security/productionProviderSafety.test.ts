import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tiktokDirectPostAudited } from '../integrations/social.js';
import { readSocialCommentStates } from '../routes/socialEngagement.js';
import { providerRequestTimeoutMs } from './providerHttp.js';

assert.equal(tiktokDirectPostAudited({}), false, 'Direct Post must default to unaudited');
assert.equal(tiktokDirectPostAudited({ TIKTOK_DIRECT_POST_AUDITED: 'false' }), false);
assert.equal(tiktokDirectPostAudited({ TIKTOK_DIRECT_POST_AUDITED: 'true' }), true);

const storageFailure = new Error('pocketbase_unavailable');
const failRead = async () => { throw storageFailure; };
await assert.rejects(
  readSocialCommentStates('tenant-production', { load: failRead, env: { NODE_ENV: 'production' } }),
  error => error === storageFailure,
  'production must not turn a state-store outage into an empty state set',
);
assert.deepEqual(
  await readSocialCommentStates('tenant-development', { load: failRead, env: { NODE_ENV: 'development' } }),
  [],
  'local development retains the legacy no-PocketBase fallback',
);

assert.equal(providerRequestTimeoutMs({}), 30_000);
assert.throws(() => providerRequestTimeoutMs({ PROVIDER_HTTP_TIMEOUT_MS: '999' }), /PROVIDER_HTTP_TIMEOUT_MS_invalid/);
assert.throws(() => providerRequestTimeoutMs({ PROVIDER_HTTP_TIMEOUT_MS: '120001' }), /PROVIDER_HTTP_TIMEOUT_MS_invalid/);

const serverRoot = path.resolve(process.cwd(), 'server');
const sourceFiles: string[] = [];
function collectSourceFiles(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(absolute);
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) sourceFiles.push(absolute);
  }
}
collectSourceFiles(serverRoot);
const rawAxiosImports = sourceFiles
  .filter(file => /from ['"]axios['"]/.test(fs.readFileSync(file, 'utf8')))
  .map(file => path.relative(process.cwd(), file).split(path.sep).join('/'))
  .sort();
assert.deepEqual(rawAxiosImports, [
  'server/integrations/whatsapp.ts',
  'server/security/providerHttp.ts',
], 'provider calls must use the shared bounded client unless they enforce a domain-specific timeout');
const whatsappSource = fs.readFileSync(path.join(serverRoot, 'integrations/whatsapp.ts'), 'utf8');
assert.equal((whatsappSource.match(/timeout:\s*whatsappProviderTimeoutMs\(\)/g) || []).length, 3,
  'every intentional raw WhatsApp axios call must carry the validated domain-specific timeout');

const publishingSource = fs.readFileSync(path.join(serverRoot, 'routes/publishing.ts'), 'utf8');
const legacyImportSource = publishingSource.slice(
  publishingSource.indexOf("publishingRouter.post('/local-videos/import-rendered'"),
  publishingSource.indexOf("publishingRouter.get('/best-time'"),
);
assert.match(legacyImportSource, /process\.env\.NODE_ENV === 'production'/,
  'production rendered-video import must reject shared legacy host paths');
assert.doesNotMatch(legacyImportSource, /return \{\s*sourcePath[,}]/,
  'legacy import responses must not echo host paths');
const publicPostSource = publishingSource.slice(
  publishingSource.indexOf('function publicPost('),
  publishingSource.indexOf('function hasPublishedTargets('),
);
assert.doesNotMatch(publicPostSource, /tenantId:\s*post\.tenant_id/,
  'calendar DTOs must not return an already-authenticated tenant identifier');
assert.match(publishingSource, /function publicPostingSchedule\([\s\S]*?slots: normalizeScheduleSlots/,
  'posting schedules must use a public allowlist DTO');

for (const routeName of ['social.ts', 'youtube.ts']) {
  const uploadRouteSource = fs.readFileSync(path.join(serverRoot, `routes/${routeName}`), 'utf8');
  assert.match(uploadRouteSource, /video:\s*publicPublishedVideo\(result\.video\)/,
    `${routeName} must strip provider operation handles from direct-publish responses`);
  assert.doesNotMatch(uploadRouteSource, /video:\s*result\.video/,
    `${routeName} must never return the raw provider upload result`);
}

const studioSource = fs.readFileSync(path.join(serverRoot, 'routes/studio.ts'), 'utf8');
assert.match(studioSource, /outputPath:\s*publishingVideoReference\(tenantId, outputPath\)/,
  'server renders must return a tenant-scoped reference instead of an absolute host path');
assert.match(studioSource, /transformProjectRenderReferences\(spec, tenantId, 'public'\)/,
  'stored project render paths must be sanitized before returning them');

const digitalEmployeeSource = fs.readFileSync(path.join(serverRoot, 'routes/digitalEmployees.ts'), 'utf8');
assert.match(digitalEmployeeSource, /run:\s*publicWorkflowRun\(run\)/,
  'digital employee overview must use a run allowlist DTO');
assert.match(digitalEmployeeSource, /tasks:\s*taskItems\.map\(task => publicWorkflowTask/,
  'digital employee overview must use task allowlist DTOs');
assert.match(digitalEmployeeSource, /data: \$\{JSON\.stringify\(publicEvent\)\}/,
  'digital employee SSE must serialize the public event DTO');
assert.doesNotMatch(digitalEmployeeSource, /JSON\.stringify\(event\)/,
  'digital employee SSE must never serialize raw durable events');
assert.match(digitalEmployeeSource, /items:\s*publicWorkflowValue\(filtered\)/,
  'digital employee work-items require a final recursive public projection');

const publicDemoPath = path.resolve(process.cwd(), 'public/demo/trend-videos-47.json');
const publicDemo = JSON.parse(fs.readFileSync(publicDemoPath, 'utf8')) as { items?: Array<Record<string, unknown>> };
assert.equal(publicDemo.items?.length, 47, 'the sanitized public demo dataset must remain complete');
for (const item of publicDemo.items || []) {
  assert.equal('tenantId' in item, false, 'public static demo records must not expose source tenant identifiers');
  assert.equal('collectionId' in item, false, 'public static demo records must not expose datastore identifiers');
  assert.match(String(item.id || ''), /^demo\d{11}$/);
  const analysis = JSON.parse(String(item.aiAnalysis || '{}')) as Record<string, unknown>;
  for (const key of Object.keys(analysis)) {
    assert.doesNotMatch(key, /(?:error|crawlerOps|sharedFrom|proxy|token|secret|path)/i,
      `public static demo analysis contains internal field ${key}`);
  }
  assert.doesNotMatch(JSON.stringify(item), /(?:\/Users\/|[A-Za-z]:\\\\|--proxy\b|cookies-from-browser|yt[_-]dlp|127\.0\.0\.1:\d+)/i,
    'public static demo records must not contain developer paths, proxy commands, or crawler diagnostics');
}

console.log('TikTok audit gating, social-state fail-closed reads, provider deadlines, and public demo sanitization passed');
