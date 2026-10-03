import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

const fixture = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import DigitalHumanRequirementsEditor from '/src/components/studio/DigitalHumanRequirementsEditor.tsx';
const initial={workflow:'viral_replication',method:'reenact',replicationMode:'sentence_first_frame',contentConfirmed:true,action:'挥手',scene:'展厅',preserve:'产品',reference:{videoUrl:'/reference.mp4',start:0,end:1,originalText:'Hi boss',derivativeAuthorized:false,cues:[{id:'hi-boss:0-1',start:0,end:1,originalText:'Hi boss',targetText:'你好老板',shotIds:['s1'],personShot:true,compositionClusterId:'front-medium',sourceFirstFrame:{time:0,materialId:'old-frame'},targetFirstFrame:{materialId:'old-target',state:'ready'},generatedClip:{materialId:'old-clip',state:'ready'}}]}};
function App(){const[value,setValue]=useState(initial);window.readRequirements=()=>value;return <DigitalHumanRequirementsEditor value={value} plan={{state:'needs_input',executable:false,reasons:[],steps:[],provider:null}} referenceMaterials={[{id:'factory',name:'企业工厂视频'}]} onChange={setValue}/>};createRoot(document.getElementById('root')).render(<App/>);`;
let vite; let browser;
try {
  vite = await createServer({ configFile: false, plugins: [react(), { name: 'cue-split-fixture', configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (req.url !== '/cue-split-test') return next();
    const compiled = await transformWithEsbuild(fixture, 'fixture.tsx', { loader: 'tsx', jsx: 'automatic' });
    const html = await server.transformIndexHtml('/cue-split-test', `<html><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`);
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  }); } }], server: { host: '127.0.0.1', port: 0, hmr: false } });
  await vite.listen();
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; await access(chrome);
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/cue-split-test`);
  await page.getByLabel('句 1 物理镜头切点').fill('0.10');
  await page.getByRole('button', { name: '按物理镜头拆分' }).click();
  let state = await page.evaluate(() => window.readRequirements());
  assert.equal(state.reference.cues.length, 2);
  assert.deepEqual(state.reference.cues.map(cue => [cue.start, cue.end]), [[0, 0.1], [0.1, 1]]);
  assert.equal(state.contentConfirmed, false);
  for (const cue of state.reference.cues) {
    assert.equal(cue.originalText, ''); assert.equal(cue.targetText, ''); assert.equal(cue.personShot, undefined);
    assert.equal(cue.sourceFirstFrame, undefined); assert.equal(cue.targetFirstFrame, undefined); assert.equal(cue.generatedClip, undefined);
    assert.equal(cue.compositionClusterId, undefined);
  }
  const articles = page.locator('[aria-label="原片逐句与分镜映射"] article');
  await articles.nth(0).getByLabel('原片对应语句').fill('开场货架');
  await articles.nth(0).getByLabel('句 1 镜头类型').selectOption('non_person');
  await articles.nth(0).getByLabel('句 1 非人物替换素材').selectOption('factory');
  await articles.nth(1).getByLabel('原片对应语句').fill('工厂画面');
  await articles.nth(1).getByLabel('句 2 镜头类型').selectOption('person');
  await articles.nth(1).getByLabel('本片对应语句').fill('欢迎参观工厂');
  assert.match(await articles.nth(1).getByRole('alert').innerText(), /0\.90 秒不会提交付费生成/);
  state = await page.evaluate(() => window.readRequirements());
  assert.deepEqual(state.reference.cues.map(cue => [cue.personShot, cue.originalText, cue.targetText]), [[false, '开场货架', ''], [true, '工厂画面', '欢迎参观工厂']]);
  assert.equal(state.reference.cues[0].nonPersonMaterialId, 'factory');
  assert.equal(state.reference.originalText, '开场货架\n工厂画面');
  assert.deepEqual(errors, []);
  console.log('Digital-human cue split UI passed: split, stale output invalidation, classification, material and speech assignment.');
} finally { await browser?.close(); await vite?.close(); }
