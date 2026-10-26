import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { chromium } from 'playwright-core';

const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await access(chrome);
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{App}from'antd';
import AssistantCreationPortalCard from '/src/components/assistant/AssistantCreationPortalCard.tsx';
import{assistantScenarioIntake}from'/src/lib/assistantScenarioIntake.ts';
import{useAssistantStore}from'/src/stores/assistantStore.ts';import'/src/index.css';
const scenario=new URLSearchParams(location.search).get('scenario')||'calendar';
const prompt=scenario==='campaign'?'为活动准备内容':scenario==='hook'?'选定一个开场':'查看本周发布日历';
const portal=assistantScenarioIntake(prompt);if(scenario.startsWith('calendar'))portal.calendarDate='2099-01-05';
useAssistantStore.getState().setMessages('business',[{role:'assistant',content:'本地冒烟',creationPortal:portal}]);
function Smoke(){const current=useAssistantStore(s=>s.threads.business.messages.find(m=>m.creationPortal?.id===portal.id)?.creationPortal);return <App><AssistantCreationPortalCard portal={current||portal}/></App>}
createRoot(document.getElementById('root')).render(<Smoke/>);`;
const requirements={source:'assistant_scene_confirmation',scenario:'campaign',groupId:'smoke',itemId:'main',plannedPublishAt:'2099-01-05T10:00:00.000Z',products:[{id:'product',name:'样品杯'}]};
const task={taskId:'smoke-task',version:'1',status:'draft',runId:null,mode:'instant',brief:{title:'活动内容',objective:'介绍样品杯',markets:[],languages:['zh'],platforms:['tiktok'],formats:['short_video'],dueAt:'2099-01-04T10:00:00.000Z',specialRequirements:JSON.stringify(requirements),productRef:'样品杯'},packageSelection:[],readiness:{complete:false,missing:[]},sourceCount:0,knowledgeSourceCount:0,materialSourceCount:0,artifactCount:0,approvedArtifactCount:0,deliveryPackageCount:0,publicationCount:0,metricSubmissionCount:0,createdAt:'2099-01-01T00:00:00.000Z',updatedAt:'2099-01-01T00:00:00.000Z'};
let vite,browser;
try {
  vite=await createServer({configFile:false,logLevel:'error',plugins:[react(),tailwind(),{name:'assistant-scene-smoke',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/assistant-scenes-smoke')return next();const compiled=await transformWithEsbuild(entry,'assistant-scenes-smoke.tsx',{loader:'tsx',jsx:'automatic'});res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/assistant-scenes-smoke',`<html><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`));});}}],server:{host:'127.0.0.1',port:0,hmr:false}});
  await vite.listen();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  browser=await chromium.launch({executablePath:chrome,headless:true});
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const page=await browser.newPage({viewport});const errors=[],writes=[],weeklyWrites=[];let smokeMode='ordinary',weeklyPublish='2099-01-05T10:00:00.000Z';page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/overseas/**',async route=>{const request=route.request(),url=new URL(request.url());
      const goal={id:'goal',title:'本周',startsAt:'2099-01-05',endsAt:'2099-01-11'};
      const weekly={id:'weekly-1',contentId:'weekly-content',origin:'weekly_plan',title:'周任务视频',platform:'tiktok',accountId:'account',accountLabel:'演示账号',productName:'样品杯',status:'planned',plannedPublishDate:weeklyPublish.slice(0,10),updatedAt:'2099-01-01T00:00:00.000Z',contentPlan:{publishAt:weeklyPublish,deliverBy:'2099-01-04T10:00:00.000Z'}};
      if(url.pathname==='/api/overseas/digital-employees/overview')return route.fulfill({json:{goals:smokeMode==='weekly'?[goal]:[],goal:smokeMode==='weekly'?goal:null,contentQueue:{sourceStatus:'available',items:smokeMode==='weekly'?[weekly]:[]}}});
      if(url.pathname==='/api/overseas/digital-employees/goals/goal/publication-schedule/weekly-content'&&request.method()==='PATCH'){const body=request.postDataJSON();weeklyWrites.push(body);weeklyPublish=body.scheduledAt;return route.fulfill({json:{goals:[goal],goal,contentQueue:{sourceStatus:'available',items:[{...weekly,contentPlan:{...weekly.contentPlan,publishAt:weeklyPublish}}]}}});}
      if(url.pathname==='/api/overseas/starter-198/social-content/tasks'&&request.method()==='GET')return route.fulfill({json:{items:smokeMode==='weekly'?[]:[task],page:1,perPage:100,totalItems:smokeMode==='weekly'?0:1,totalPages:smokeMode==='weekly'?0:1}});
      if(url.pathname==='/api/overseas/starter-198/social-content/tasks/smoke-task'&&request.method()==='PATCH'){
        const body=request.postDataJSON();writes.push(body);assert.equal(body.expectedVersion,task.version);task.brief.specialRequirements=body.changes.specialRequirements;task.version='2';return route.fulfill({json:{task:{...task,sources:[],artifacts:[],deliveryPackages:[],publications:[],metricSubmissions:[]}}});
      }
      if(url.pathname==='/api/overseas/studio/material-products')return route.fulfill({json:{items:[{id:'product',name:'样品杯'}]}});
      if(url.pathname==='/api/overseas/studio/materials')return route.fulfill({json:{items:[],total:0,status:'ready'}});
      return route.fulfill({status:404,json:{error:'undeclared_smoke_api'}});
    });
    await page.goto(`${origin}/assistant-scenes-smoke?scenario=campaign`);
    await page.getByRole('region',{name:'为活动准备内容'}).waitFor();
    await page.getByRole('textbox',{name:'活动口播卖点'}).fill('样品杯适合展会介绍');
    await page.getByRole('button',{name:'确认素材与卖点'}).click();
    await page.getByRole('textbox',{name:'活动名称'}).waitFor();
    await page.goto(`${origin}/assistant-scenes-smoke?scenario=hook`);
    await page.getByRole('region',{name:'选择开场片段'}).waitFor();
    await page.getByRole('button',{name:'上传自己的片段'}).waitFor();
    await page.goto(`${origin}/assistant-scenes-smoke?scenario=calendar`);
    await page.getByText('活动内容',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'调整发布时间'}).first().click();
    await page.getByText('原计划：').waitFor();
    await page.getByRole('textbox',{name:'新的发布时间'}).fill('2099-01-06 18:00');
    await page.getByRole('textbox',{name:'新的发布时间'}).press('Enter');
    await page.getByRole('button',{name:'确认调整'}).click();
    await page.waitForFunction(()=>document.body.textContent.includes('2099/1/6')||document.body.textContent.includes('2099-01-06'));
    assert.equal(writes.length,1);assert.equal(JSON.parse(writes[0].changes.specialRequirements).groupId,'smoke');
    smokeMode='weekly';
    await page.goto(`${origin}/assistant-scenes-smoke?scenario=calendar-weekly`);
    await page.getByText('周任务视频',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'调整发布时间'}).first().click();
    await page.getByRole('textbox',{name:'新的发布时间'}).fill('2099-01-06 18:00');
    await page.getByRole('textbox',{name:'新的发布时间'}).press('Enter');
    await page.getByRole('button',{name:'确认调整'}).click();
    await page.waitForFunction(()=>document.body.textContent.includes('2099/1/6')||document.body.textContent.includes('2099-01-06'));
    assert.equal(weeklyWrites.length,1);assert.equal(weeklyWrites[0].scheduledAt,'2099-01-06T10:00:00.000Z');
    assert.deepEqual(errors,[]);
    const width=await page.evaluate(()=>document.documentElement.scrollWidth);assert.ok(width<=viewport.width+2,`horizontal overflow at ${viewport.width}: ${width}`);
    console.log(`assistant scene browser smoke passed at ${viewport.width}px: campaign input, hook picker, ordinary and weekly calendar reschedule`);
    await page.close();task.version='1';task.brief.specialRequirements=JSON.stringify(requirements);
  }
}finally{await browser?.close();await vite?.close();}
