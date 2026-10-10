import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer, transformWithEsbuild} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright-core';

// Fixture schema: {api:{'/api/...':JSON},cases:[{channel,cardId,openButtonName,
// prepare:[{selector,value}],positionKey}]}. No production API is reachable.
// This mounts the real App and both real pages, never a navigation control shell.
const file = process.env.AGENT_CALENDAR_AUDIT_FIXTURES || new URL('./fixtures/agent-calendar-return-api.json',import.meta.url);
const fixtures = JSON.parse(await readFile(file, 'utf8'));
const evidence = {scope:'Real App / DigitalEmployeePage / ConversionPage in local Chrome; intercepted read-only fixtures',results:[],gaps:[],blocked:[],errors:[]};
evidence.sourceHashes = Object.fromEntries(await Promise.all(['src/App.tsx','src/components/DigitalEmployeePage.tsx','src/components/ConversionPage.tsx'].map(async path => [path,createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex')])));
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import App from '/src/App.tsx';import DigitalEmployeePage from '/src/components/DigitalEmployeePage.tsx';import ConversionPage from '/src/components/ConversionPage.tsx';import{readAgentCalendarReturnContext,restoreAgentCalendarReturnContext}from'/src/lib/agentCalendarReturnContext.ts';import{restorableProductionDetail}from'/src/lib/productionNavigation.ts';import'/src/index.css';window.audit={read:readAgentCalendarReturnContext,restore:restoreAgentCalendarReturnContext,historyDetail:restorableProductionDetail,modules:[typeof DigitalEmployeePage,typeof ConversionPage]};createRoot(document.getElementById('root')).render(<App/>);`;
let vite, browser;
try {
  const executablePath = process.env.AGENT_CARD_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  await access(executablePath);
  vite = await createServer({configFile:false,logLevel:'error',plugins:[react(),tailwind(),{name:'real-app-calendar-audit',configureServer(server){server.middlewares.use(async(req,res,next)=>{
    if (!req.url?.startsWith('/agent-calendar-audit')) return next();
    const compiled=await transformWithEsbuild(entry,'audit.tsx',{loader:'tsx',jsx:'automatic'});
    const html=await server.transformIndexHtml('/agent-calendar-audit',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`);
    res.setHeader('Content-Type','text/html');res.end(html);
  });}}],server:{host:'127.0.0.1',port:0,hmr:false}});
  await vite.listen();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  browser=await chromium.launch({executablePath,headless:true});evidence.chromeVersion=browser.version();
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(10000);
  page.on('pageerror',error=>evidence.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')evidence.errors.push(message.text());});
  await page.addInitScript(()=>{if(!localStorage.getItem('overseas_token'))localStorage.setItem('overseas_token','read-only-audit');});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin||!['GET','HEAD'].includes(request.method())){evidence.blocked.push({url:url.href,method:request.method()});return route.abort();}
    if(url.pathname.startsWith('/api/')){
      const key=url.pathname+url.search;
      if(Object.hasOwn(fixtures.api,key))return route.fulfill({json:fixtures.api[key]});
      if(Object.hasOwn(fixtures.api,url.pathname))return route.fulfill({json:fixtures.api[url.pathname]});
      evidence.blocked.push({url:key,method:request.method(),reason:'undeclared read fixture'});
      return route.fulfill({status:503,json:{error:'audit_fixture_missing'}});
    }
    return route.continue();
  });
  await page.goto(`${origin}/agent-calendar-audit?page=digitalEmployees`);
  await page.waitForFunction(()=>window.audit?.modules?.every(value=>value==='function'));
  evidence.realAppRendered=true; evidence.realProductionModulesImported=true;
  for(const channel of (process.env.AGENT_CALENDAR_AUDIT_CHANNEL?[process.env.AGENT_CALENDAR_AUDIT_CHANNEL]:['whatsapp','messenger','instagram'])){
    const scenario=fixtures.cases.find(value=>value.channel===channel);
    if(!scenario){evidence.gaps.push(`${channel}: no declared real weekly calendar/API fixture`);continue;}
    try {
      await page.evaluate(()=>{localStorage.setItem('overseas_token','read-only-audit');sessionStorage.clear();});
      await page.goto(`${origin}/agent-calendar-audit?page=digitalEmployees`);
      for(const step of scenario.prepare||[]){const locator=page.locator(step.selector);if(step.value!==undefined)await locator.selectOption(step.value);else await locator.click();}
      const accountFilter=page.getByRole('region',{name:'智能经营账号列表'}).locator('button[aria-pressed]').nth(1);
      await accountFilter.click();
      assert.equal(await accountFilter.getAttribute('aria-pressed'),'true');
      const selectedFilterText=await accountFilter.innerText();
      const card=page.locator(`[data-agent-calendar-card-id=${JSON.stringify(scenario.cardId)}]`);
      await card.waitFor({state:'visible',timeout:15000});
      const calendar=page.locator('[data-agent-calendar-position-key]').filter({has:card});
      const positionKey=await calendar.getAttribute('data-agent-calendar-position-key');
      const horizontal=calendar.locator('.overflow-x-auto').first();
      await horizontal.evaluate(node=>{node.scrollLeft=170;});
      let left=await horizontal.evaluate(node=>node.scrollLeft);
      assert(left>0,'actual calendar must scroll horizontally');
      await calendar.evaluate(node=>{let current=node.parentElement;while(current&&current.scrollHeight<=current.clientHeight)current=current.parentElement;if(!current)throw Error('No actual production vertical scroller');current.setAttribute('data-audit-vertical-scroller','true');});
      const viewport=page.locator('[data-audit-vertical-scroller]').first();
      await viewport.evaluate(node=>{node.scrollTop=250;});
      let top=await viewport.evaluate(node=>node.scrollTop);
      assert(top>0,'actual production main must scroll vertically');
      const dateText=await calendar.locator('.mb-5').first().innerText();
      const assertPosition=async()=>{
        await page.waitForFunction(({left,top})=>{const calendar=document.querySelector('[data-agent-calendar-position-key]');const scroll=calendar?.querySelector('.overflow-x-auto');let main=calendar?.parentElement;while(main&&main.scrollHeight<=main.clientHeight)main=main.parentElement;return scroll?.scrollLeft===left&&main?.scrollTop===top;},{left,top},{timeout:15000});
        assert.equal(await horizontal.evaluate(node=>node.scrollLeft),left);
        assert.equal(await viewport.evaluate(node=>node.scrollTop),top);
        assert.equal(await calendar.locator('.mb-5').first().innerText(),dateText);
      };
      await card.click();
      left=await horizontal.evaluate(node=>node.scrollLeft);top=await viewport.evaluate(node=>node.scrollTop);
      assert(left>0&&top>0,'capture source DOM at navigation time must have nonzero horizontal and vertical scroll');
      await page.getByRole('button',{name:scenario.openButtonName,exact:true}).click();
      if(scenario.entryButtonName){const entry=scenario.entrySelector?page.locator(scenario.entrySelector):page;await entry.getByRole('button',{name:scenario.entryButtonName,exact:true}).click();}
      await page.waitForURL(/page=conversion/);
      const chat=page.getByTestId('conversation-chat-thread');
      await chat.locator('p.text-sm.font-black').filter({hasText:new RegExp(`^${channel} local buyer$`)}).waitFor({state:'visible'});
      const chatBounds=await chat.boundingBox();assert(chatBounds&&chatBounds.width>0&&chatBounds.height>0,'actual conversation must occupy visible space');
      await chat.getByText('Please review Widget',{exact:true}).waitFor({state:'visible'});
      assert.equal(await page.getByRole('dialog').count(),0,'navigation must dismiss source details');
      await page.goBack();await card.waitFor({state:'visible'});
      await assertPosition();
      const before=await page.evaluate(()=>window.audit.read());
      assert(before);assert.equal(before.calendar.positionKey,positionKey);assert.equal(before.calendar.cardId,scenario.cardId);
      assert.equal(await page.getByRole('dialog').count(),0,'Back must not reopen prior detail');
      assert.equal(await card.getAttribute('aria-current'),'true');
      assert.equal(await accountFilter.getAttribute('aria-pressed'),'true');assert.equal(await accountFilter.innerText(),selectedFilterText);
      await page.reload();await card.waitFor({state:'visible'});
      await calendar.evaluate(node=>{let current=node.parentElement;while(current&&current.scrollHeight<=current.clientHeight)current=current.parentElement;if(current)current.setAttribute('data-audit-vertical-scroller','true');});
      await assertPosition();
      const refreshed=await page.evaluate(()=>window.audit.read());
      assert.deepEqual(refreshed.calendar,before.calendar,'refresh preserves date offset and exact source card');
      assert.deepEqual(refreshed.states,before.states,'refresh preserves package and filters');
      assert.equal(await accountFilter.getAttribute('aria-pressed'),'true');assert.equal(await accountFilter.innerText(),selectedFilterText);
      assert.notEqual(before.calendar.offset,0,'date offset must be changed by real UI');
      assert.equal(before.states['digitalEmployee.workspace'].selectedAccountId,'fixture-content-account','fixture account filter must be the explicitly selected account');
      assert.deepEqual(refreshed.scroll,before.scroll,'refresh preserves horizontal and vertical positions');
      assert.equal(await page.getByRole('dialog').count(),0,'refresh must not reopen old details');
      await page.evaluate(()=>{localStorage.setItem('overseas_token','changed-tenant');window.dispatchEvent(new Event('overseas-auth-token-changed'));});
      assert.notEqual((await page.evaluate(()=>window.audit.read()))?.id,before.id,'login drift rejects the previous calendar snapshot');
      assert.equal(await page.evaluate(()=>window.audit.historyDetail(history.state)),null,'login drift rejects task history');
      await page.evaluate(()=>{localStorage.setItem('overseas_token','read-only-audit');window.dispatchEvent(new Event('overseas-auth-token-changed'));});
      evidence.results.push({channel,chatBounds,actualConversation:`${channel} local buyer`,positionKey,calendar:before.calendar,states:before.states,scroll:before.scroll,actualDOMScroll:{left,top},dateText,selectedFilterText,history:true,refresh:true,identityDrift:true});
    }catch(error){evidence.gaps.push(`${channel}: ${error.message}`);console.error(`${channel}: ${error.message}`);console.error(JSON.stringify(await page.evaluate(()=>({context:window.audit.read(),scrollers:Array.from(document.querySelectorAll('*')).filter(node=>node.scrollLeft||node.scrollTop).map(node=>({tag:node.tagName,classes:node.className,left:node.scrollLeft,top:node.scrollTop}))})),null,2));await page.screenshot({path:`work/agent-calendar-audit-${channel}.png`});console.error((await page.locator('body').innerText()).slice(0,6000));}
  }
  assert.equal(evidence.results.length,3,'all three actual channels must pass');
  assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blocked,[]);assert.deepEqual(evidence.gaps,[]);
}catch(error){evidence.gaps.push(error.message);process.exitCode=1;}
finally{await browser?.close();await vite?.close();console.log(JSON.stringify(evidence,null,2));}
