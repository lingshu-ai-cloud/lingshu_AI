import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { initialHistoryAccountDefinitions } from './InitialOperatingPlanDialog';
const source=fs.readFileSync('src/components/InitialOperatingPlanDialog.tsx','utf8');
test('recommendation exposes concrete deliverables and deferred account binding',()=>{for(const term of ['推荐经营计划','确认计划并开始制作','调整计划','预算上限','目标市场','Agent 工作排期','待绑定账号','条（母版适配）'])assert(source.includes(term));});
test('established profile shows optional historic collection without publication authorization',()=>{for(const term of ['历史平台账号链接','账号入库并发起采集','不会授权真实发布'])assert(source.includes(term));});
test('recommendation uses the shared accessible dialog primitive',()=>{assert.match(source,/<LsFlowDialog[\s\S]*onCancel=\{onBack\}[\s\S]*keyboard=\{!busy\}[\s\S]*closable=\{!busy\}/);});
test('historic collection is restricted to platforms confirmed in the plan',()=>{
 assert.deepEqual(initialHistoryAccountDefinitions('https://www.youtube.com/@factory', ['youtube']), [{url:'https://www.youtube.com/@factory',platform:'youtube'}]);
 assert.throws(()=>initialHistoryAccountDefinitions('https://www.tiktok.com/@factory', ['youtube']), /本周已选平台/);
});
