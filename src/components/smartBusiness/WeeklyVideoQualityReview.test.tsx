import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WeeklyTaskWorkspace } from '../../../shared/contracts/weeklyTaskWorkspace';
import WeeklyVideoQualityReview, { weeklyVideoQualityIdentity } from './WeeklyVideoQualityReview';

const workspace = {
  schemaVersion: 'weekly-task-workspace.v1', tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 1,
  executionTaskId: 'execution', runId: 'run', phase: 'blocked',
  runtime: { pendingMaterials: [], initialMaterialBlocks: [], preRunMaterialRequests: [], pauseReasons: [], completedWork: [],
    actualCost: { status: 'none', totalCny: null, evidenceRefs: [] },
    recovery: { jobId: 'job', jobStatus: 'blocked', jobAttempt: 1, taskAttempt: 1, taskMaximumAttempts: 3, providerReceipts: [] },
    checkpoints: [{ key: 'social.video_node_quality', inputHash: 'b'.repeat(64) }], nextActions: [],
    mayChargeAgain: { status: 'not_expected', reason: '检查使用现有媒体' },
    videoQuality: { mediaSha256: 'a'.repeat(64), qualityInputHash: 'b'.repeat(64), subtitleStatus: 'unknown', timelineStatus: 'passed',
      samples: [{ atSeconds: 1, frameSha256: 'c'.repeat(64), subtitlePresent: true, font: null, fontSize: null, color: null }] },
  },
} as unknown as WeeklyTaskWorkspace;

test('inspection identity isolates every task, package, run, media and quality checkpoint revision', () => {
  const first = weeklyVideoQualityIdentity(workspace);
  for (const key of ['tenantId', 'programId', 'packageId', 'packageVersion', 'executionTaskId', 'runId'] as const) {
    const changed = structuredClone(workspace); (changed as any)[key] = `${workspace[key]}-changed`;
    assert.notEqual(weeklyVideoQualityIdentity(changed), first, key);
  }
  for (const change of [
    (value: WeeklyTaskWorkspace) => { value.runtime.recovery.jobId = 'other'; },
    (value: WeeklyTaskWorkspace) => { value.runtime.videoQuality!.mediaSha256 = 'd'.repeat(64); },
    (value: WeeklyTaskWorkspace) => { value.runtime.videoQuality!.qualityInputHash = 'e'.repeat(64); },
    (value: WeeklyTaskWorkspace) => { value.runtime.videoQuality!.subtitleStatus = 'blocked'; },
    (value: WeeklyTaskWorkspace) => { value.runtime.videoQuality!.timelineStatus = 'unknown'; },
    (value: WeeklyTaskWorkspace) => { value.runtime.videoQuality!.samples[0]!.font = false; },
    (value: WeeklyTaskWorkspace) => { value.runtime.checkpoints[0]!.inputHash = 'f'.repeat(64); },
  ]) { const changed = structuredClone(workspace); change(changed); assert.notEqual(weeklyVideoQualityIdentity(changed), first); }
});

test('review exposes preview without a new acceptance gate and is honest about missing evidence', () => {
  const html = renderToStaticMarkup(<WeeklyVideoQualityReview workspace={workspace}/>);
  assert.match(html, /查看当前成片与抽样/); assert.match(html, /接受当前偏差并继续/);
  const absent = structuredClone(workspace); delete absent.runtime.videoQuality!.qualityInputHash; absent.runtime.videoQuality!.samples = [];
  const missing = renderToStaticMarkup(<WeeklyVideoQualityReview workspace={absent}/>);
  assert.match(missing, /缺少可核验的成片预览身份/); assert.match(missing, /没有可核验的字幕抽样图片/);
  assert.doesNotMatch(missing, /查看当前成片与抽样/); assert.match(missing, /接受当前偏差并继续/);
  const failed = structuredClone(workspace); failed.runtime.videoQuality!.timelineStatus = 'blocked';
  assert.doesNotMatch(renderToStaticMarkup(<WeeklyVideoQualityReview workspace={failed}/>), /接受当前偏差并继续/);
});

const chrome = process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('old acceptance response cannot mark another film accepted; preview objects are released on version change', {
  timeout: 90_000, skip: !existsSync(chrome) ? 'Set CHROME_EXECUTABLE to run the isolated browser interaction test' : false,
}, async () => {
  const { createServer, transformWithEsbuild } = await import('vite');
  const { chromium } = await import('playwright-core');
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'weekly-quality-ui-'));
  const source = `import {useState} from 'react';import {createRoot} from 'react-dom/client';import Review,{weeklyVideoQualityIdentity} from '/src/components/smartBusiness/WeeklyVideoQualityReview.tsx';
    const original=${JSON.stringify(workspace)};
    function App(){const [value,setValue]=useState(original);window.changeFilm=()=>setValue({...original,runtime:{...original.runtime,videoQuality:{...original.runtime.videoQuality,mediaSha256:'d'.repeat(64)}}});return <Review key={weeklyVideoQualityIdentity(value)} workspace={value}/>;}createRoot(document.getElementById('root')).render(<App/>);`;
  const compiled = await transformWithEsbuild(source, 'weekly-quality-fixture.tsx', { jsx: 'automatic' });
  const server = await createServer({ configFile: false, cacheDir, root: process.cwd(), logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'isolated-weekly-quality-fixture', resolveId(id) { if (id === 'virtual:weekly-quality-fixture') return '\0weekly-quality-fixture'; },
      load(id) { if (id === '\0weekly-quality-fixture') return compiled.code; },
      configureServer(vite) { vite.middlewares.use('/__weekly_quality_test.html', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/@id/__x00__weekly-quality-fixture"></script>'); }); } }],
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); const address = server.httpServer!.address(); assert.ok(address && typeof address === 'object');
    browser = await chromium.launch({ executablePath: chrome, headless: true }); const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('overseas_token', 'isolated-ui-token');
      const original = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      (window as any).mediaObjects = { created: [] as string[], revoked: [] as string[] };
      URL.createObjectURL = blob => { const url = original(blob); (window as any).mediaObjects.created.push(url); return url; };
      URL.revokeObjectURL = url => { (window as any).mediaObjects.revoked.push(url); revoke(url); };
    });
    let releaseAcceptance: (() => void) | undefined; const requests: string[] = [], acceptanceBodies: Array<Record<string, unknown>> = [];
    await page.route('**/api/**', async route => {
      const request = route.request(); requests.push(request.url());
      if (request.method() === 'POST') { acceptanceBodies.push(request.postDataJSON()); await new Promise<void>(resolve => { releaseAcceptance = resolve; }); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item: {} }) }); }
      else if (request.url().includes('frameSha256')) await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
      else await route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from('controlled invalid MP4 exercises honest playback failure') });
    });
    await page.goto(`http://127.0.0.1:${address.port}/__weekly_quality_test.html`);
    await page.getByRole('button', { name: '查看当前成片与抽样' }).click();
    await page.getByText('当前成片无法播放，请刷新重试。', { exact: true }).waitFor();
    await page.getByAltText('字幕抽样 1，1.00 秒').waitFor();
    await page.waitForFunction(() => (window as any).mediaObjects.created.length === 2);
    await page.getByRole('button', { name: '接受当前偏差并继续' }).click();
    await page.waitForTimeout(50); assert.ok(releaseAcceptance);
    await page.evaluate(() => (window as any).changeFilm());
    await page.getByRole('button', { name: '接受当前偏差并继续' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '接受当前偏差并继续' }).isEnabled(), true);
    await page.waitForFunction(() => (window as any).mediaObjects.revoked.length === 2);
    releaseAcceptance!(); await page.waitForTimeout(100);
    assert.equal(await page.getByText('已接受当前偏差，原任务正在恢复', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '接受当前偏差并继续' }).isEnabled(), true);
    await page.getByRole('button', { name: '接受当前偏差并继续' }).click();
    await page.waitForTimeout(50); assert.equal(acceptanceBodies[1]?.expectedMediaSha256, 'd'.repeat(64));
    releaseAcceptance!(); await page.getByText('已接受当前偏差，原任务正在恢复', { exact: true }).waitFor();
    assert.equal(requests.length, 4, 'only controlled film, frame and version-bound acceptance requests were issued');
  } finally { await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
});

test('subtitle failures have an explicit human confirmation while measured timeline failures do not',()=>{
  const value=structuredClone(workspace);value.runtime.videoQuality!.subtitleStatus='blocked';
  const html=renderToStaticMarkup(<WeeklyVideoQualityReview workspace={value}/>);
  assert.match(html,/确认字幕样式偏差并继续/);assert.match(html,/确认即表示接受当前字幕样式问题/);
  value.runtime.videoQuality!.timelineStatus='blocked';
  const blocked=renderToStaticMarkup(<WeeklyVideoQualityReview workspace={value}/>);
  assert.doesNotMatch(blocked,/确认字幕样式偏差并继续|接受当前偏差并继续/);
});
