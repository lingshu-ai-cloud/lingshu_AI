import '../server/loadEnvironment.js';
import { store } from '../server/storage/index.js';
import { runWithDataAuthority } from '../server/storage/dataAuthority.js';
await runWithDataAuthority('local', async()=>{const r=await store.list<any>('trend_videos',{where:{tenantId:'local_tenant_customer_1b2913131e2c46deab66172228c4df0a'},page:1,perPage:500});console.log(r.items.filter(x=>JSON.stringify(x).includes('yuchengcosmeticsfactory')).map(x=>({id:x.id,title:x.title,videoUrl:x.videoUrl,analysis:typeof x.aiAnalysis==='string'?JSON.parse(x.aiAnalysis):x.aiAnalysis})));});
