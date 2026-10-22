import express from 'express';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createCustomerBatchesRouter } from '../server/routes/customerBatches.js';
import { createCustomerBatchService } from '../server/customerService/customerBatchService.js';
import type { DataStore, Record_ } from '../server/storage/datastore.js';
const rows:Record<string,Record_[]>={workflow_runs:[{id:'browser-run',tenant_id:'fixture',goal_id:'goal',status:'running'}],weekly_goals:[{id:'goal',tenant_id:'fixture',starts_at:'2026-10-19',ends_at:'2026-10-25'}],workflow_tasks:[{id:'seg',tenant_id:'fixture',run_id:'browser-run',task_key:'customer_segmentation',agent_role:'customer'}]};let seq=0;
const store:DataStore={getById:async<T>(c:string,id:string)=>(rows[c]?.find(r=>r.id===id)??null) as T|null,list:async<T>(c:string,q:any={})=>{const all=(rows[c]||[]).filter(r=>Object.entries(q.where||{}).every(([k,v])=>r[k]===v));return{items:all as T[],totalItems:all.length,totalPages:1,page:1,perPage:250};},create:async<T>(c:string,p:Record<string,unknown>)=>{const row={id:`fixture${++seq}`,...p} as Record_;(rows[c]??=[]).push(row);return row as T;},update:async(c,id,p)=>{const row=rows[c]?.find(r=>r.id===id);if(!row)return false;Object.assign(row,p);return true;},delete:async()=>false};
const at=Date.now()-1000;
const service=createCustomerBatchService(store,{read:async()=>[{id:'buyer-a',tenantId:'fixture',name:'隔离测试客户 A',source:'messenger',accountId:'a',accountHash:'account-proof',timeline:[{id:'m-a',actor:'buyer',body:'Please send samples',timestamp:at}]},{id:'buyer-b',tenantId:'fixture',name:'隔离测试客户 B',source:'messenger',accountId:'a',accountHash:'account-proof',timeline:[{id:'m-b',actor:'buyer',body:'Hello',timestamp:at}]}],classify:async turns=>turns.some(t=>t.body.includes('samples'))?[{tag:'索取样品',messageId:'m-a',excerpt:'Please send samples'}]:[]});
const vite=await createServer({configFile:false,root:process.cwd(),plugins:[react(),tailwindcss()],server:{middlewareMode:true,fs:{allow:[process.cwd()]}},appType:'custom'});
const app=express();app.use(express.json());app.use('/api/overseas/customer-batches',createCustomerBatchesRouter(service,(_req,res,next)=>{res.locals.tenantId='fixture';res.locals.userId='fixture-owner';res.locals.browserReadRole='customer_service';next();}));
app.get('/__customer-batch-fixture',async(_req,res)=>{res.type('html').send(await vite.transformIndexHtml('/__customer-batch-fixture',`<!doctype html><html><meta charset="utf-8"><title>客服批量管理隔离验收</title><body><main style="padding:24px;max-width:1200px;margin:auto"><h1>客服批量管理隔离验收</h1><p>仅内存客户与存储，不连接实际客户账号。</p><div id="root"></div></main><script type="module" src="/scripts/customerBatchBrowserEntry.tsx"></script></body></html>`));});

app.use(vite.middlewares);
const server=app.listen(Number(process.env.CUSTOMER_FIXTURE_PORT||0),'127.0.0.1',()=>{const a=server.address() as {port:number};console.log(`CUSTOMER_BROWSER_FIXTURE=http://127.0.0.1:${a.port}/__customer-batch-fixture`);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();void vite.close().then(()=>process.exit(0));});
