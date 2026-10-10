import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

// Real browser + production handoff helpers; controlled navigation shell, not the full App.
// Fail closed: no backend routes, non-local requests, or browser-side mutations are permitted.
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const employeeSource = await readFile(new URL('../src/components/DigitalEmployeePage.tsx', import.meta.url), 'utf8');
assert.match(appSource, /<Activity[^>]+mode=\{page === 'digitalEmployees' \? 'visible' : 'hidden'\}/);
assert.match(employeeSource, /const \[productionPeriod, setProductionPeriod\].*useState<OverviewPeriod>\("week"\)/);
assert.match(employeeSource, /setSelectedTaskId\(returnContext.taskId\)/);
const fixture = `import React,{Activity,useEffect,useState} from 'react';
import{createRoot}from'react-dom/client';
import{dispatchDigitalEmployeeDeepLink,consumeDigitalEmployeeReturnContext}from'/src/lib/digitalEmployees.ts';
window.audit={dispatch:dispatchDigitalEmployeeDeepLink,consume:consumeDigitalEmployeeReturnContext};
function Production(){const[task,setTask]=useState('task-original');const[date,setDate]=useState('2026-09-14');return <section data-testid="production" style={{height:300,overflowY:'scroll'}}><select aria-label="任务" value={task} onChange={e=>setTask(e.target.value)}><option>task-original</option><option>task-other</option></select><input aria-label="日期" type="date" value={date} onChange={e=>setDate(e.target.value)}/><div style={{height:1400}}>local fixture content</div></section>}
function Shell(){const[page,setPage]=useState('digitalEmployees');useEffect(()=>{const handle=e=>setPage(e.detail.page);window.addEventListener('lingshu:navigate',handle);return()=>window.removeEventListener('lingshu:navigate',handle)},[]);return <><Activity mode={page==='digitalEmployees'?'visible':'hidden'}><Production/></Activity>{page!=='digitalEmployees'&&<div data-testid="business">{page}</div>}<button onClick={()=>setPage('digitalEmployees')}>返回</button></>};createRoot(document.getElementById('root')).render(<Shell/>);`;
const sourceHashes = Object.fromEntries(await Promise.all(['src/App.tsx','src/components/DigitalEmployeePage.tsx','src/lib/digitalEmployees.ts'].map(async file=>[file,createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')])));
const evidence = { sourceHashes, scope: 'Local Chrome; production handoff functions; controlled React Activity shell; no backend/full App acceptance', results: [], gaps: [] };
let vite; let browser;
try {
  const chrome = process.env.AGENT_CARD_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  await access(chrome);
  vite = await createServer({ configFile:false, plugins:[react(),{
    name:'agent-card-chrome-local-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
      if(req.url!=='/agent-card-chrome')return next();
      const compiled=await transformWithEsbuild(fixture,'agent-card-chrome-fixture.tsx',{loader:'tsx',jsx:'automatic'});
      const html=await server.transformIndexHtml('/agent-card-chrome',`<html><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`);
      res.setHeader('Content-Type','text/html');res.end(html);
    });}
  }],server:{host:'127.0.0.1',port:0,hmr:false}});
  await vite.listen();
  const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  browser=await chromium.launch({executablePath:chrome,headless:true});
  evidence.chromeVersion=browser.version();
  const page=await browser.newPage(); const errors=[]; const blocked=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const request=route.request();const url=new URL(request.url());
    if(url.origin!==origin||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())){
      blocked.push({url:request.url(),method:request.method()});return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${origin}/agent-card-chrome`);
  await page.getByLabel('任务').selectOption('task-other');
  await page.getByLabel('日期').fill('2026-08-31');
  await page.getByTestId('production').evaluate(element=>element.scrollTop=700);
  const before=await page.getByTestId('production').evaluate(element=>element.scrollTop);
  const links=[
    ['publication_execution','smartAssets','publish'],['stock_reuse','smartAssets','create'],['cross_week_material','smartAssets','create'],
    ['knowledge_quote_gap','enterprise',undefined],['publication_recovery','smartAssets','publish'],['messenger_instagram_recovery','accountManagement',undefined],
    ['whatsapp_recovery','accountManagement',undefined],['sales_handoff','conversion',undefined],['content_production','smartAssets','create'],
    ['manual_material','smartAssets','create'],['customer_runtime','conversion',undefined],
  ];
  for(const [kind,destination,view] of links){
    // Destinations are explicit audit inputs, not assertions of production card routing.
    const link={page:destination,...(view?{view}:{}),runId:'run-audit',taskId:'task-other',businessRef:{taskKey:kind,deliveryId:'delivery-audit'}};
    await page.evaluate(link=>window.audit.dispatch(link),link);
    await page.getByTestId('business').waitFor();
    const stored=await page.evaluate(()=>({returnContext:JSON.parse(sessionStorage.getItem('digitalEmployee.returnContext')),link:JSON.parse(sessionStorage.getItem('digitalEmployee.businessDeepLink'))}));
    assert.equal(stored.link.workflowRunId,'run-audit');assert.equal(stored.link.workflowTaskId,'task-other');
    assert.equal(stored.returnContext.openedPage,destination);assert.equal(stored.returnContext.deliveryId,'delivery-audit');
    await page.getByRole('button',{name:'返回',exact:true}).click();
    assert.equal(await page.getByLabel('任务').inputValue(),'task-other');assert.equal(await page.getByLabel('日期').inputValue(),'2026-08-31');
    assert.equal(await page.getByTestId('production').evaluate(element=>element.scrollTop),before);
    const consumed=await page.evaluate(()=>[window.audit.consume(),window.audit.consume()]);
    assert.equal(consumed[0].taskId,'task-other');assert.equal(consumed[1],null);
    evidence.results.push({kind,destination,view:view||null,retained:{task:'task-other',date:'2026-08-31',scrollTop:before}});
  }
  await page.evaluate(()=>window.audit.dispatch({page:'conversion',runId:'run-audit',taskId:'task-other',businessRef:{taskKey:'customer_runtime'}}));
  const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('digitalEmployee.returnContext')));
  for(const field of ['productionPeriod','startsAt','endsAt','scrollTop'])assert.equal(Object.hasOwn(saved,field),false);
  await page.reload();await page.getByTestId('production').waitFor();
  const afterReload={task:await page.getByLabel('任务').inputValue(),date:await page.getByLabel('日期').inputValue(),scrollTop:await page.getByTestId('production').evaluate(element=>element.scrollTop)};
  assert.deepEqual(afterReload,{task:'task-original',date:'2026-09-14',scrollTop:0});
  evidence.gaps.push({id:'RETURN-RELOAD-DATE-SCROLL',finding:'Persisted production return context has no date/range/scroll fields; controlled remount resets these. Full App reload behavior is unverified.',persistedKeys:Object.keys(saved),controlledReload:afterReload});
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  console.log(JSON.stringify(evidence,null,2));
  if(process.argv.includes('--strict-return-position'))process.exitCode=1;
} finally {await browser?.close();await vite?.close();}
