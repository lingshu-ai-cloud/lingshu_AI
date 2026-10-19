import test from 'node:test';import assert from 'node:assert/strict';
import {downloadVideoForAnalysis} from './videos.js';
import {DownloadBudget} from '../lib/downloadExecution.js';
test('scoped public download disables paid actors and cookie fallback even when ambient settings enable them',async t=>{
 const names=['APIFY_TOKEN','APIFY_YOUTUBE_VIDEO_FALLBACK_ENABLED','VIDEO_DOWNLOAD_USE_SERVER_COOKIES','YT_DLP_COOKIES_FROM_BROWSER','YT_DLP_COOKIE_FILES'];const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 Object.assign(process.env,{APIFY_TOKEN:'must-not-call-paid',APIFY_YOUTUBE_VIDEO_FALLBACK_ENABLED:'1',VIDEO_DOWNLOAD_USE_SERVER_COOKIES:'1',YT_DLP_COOKIES_FROM_BROWSER:'chrome',YT_DLP_COOKIE_FILES:'/must-not-read-cookie-file'});
 t.after(()=>{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}});
 let network=0,executions=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('no provider allowed');});
 await assert.rejects(downloadVideoForAnalysis({sourceUrl:'https://www.youtube.com/shorts/abc123',title:'public',platform:'youtube',allowPaidFallback:false,allowCookieFallback:false},(async(_file:string,args:readonly string[])=>{executions++;assert(!args.includes('--cookies-from-browser'));assert(!args.includes('--cookies'));throw Error('anonymous public download unavailable');}) as never,new DownloadBudget(10000)));
 assert(executions>0);assert.equal(network,0,'no Apify provider request despite ambient token');
});
