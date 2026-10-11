const test = require('node:test');
const assert = require('node:assert/strict');
const { fieldValue, buildPayload, options } = require('./action-form.cjs');
test('numeric authorization rejects empty, coercible objects, nonfinite and bounds but accepts explicit zero', () => {
  const field = {key:'cap',label:'费用上限',type:'number',min:0,max:10};
  for (const value of ['', ' ', null, undefined, false, [], {}, Infinity, 'bad', -1, 11]) assert.throws(() => fieldValue(field, value));
  assert.equal(fieldValue(field, '0'), 0);
  assert.equal(fieldValue({...field,min:-5}, '-2'), -2);
});
test('selection IDs are trimmed and deduplicated and reject missing or ineligible identifiers', () => {
  const field = {key:'sceneIds',label:'分镜',type:'scenes',allowedIds:['s1','s2']};
  assert.deepEqual(fieldValue(field,[' s1 ','s1','s2']),['s1','s2']);
  for (const value of [[], [''], [null], [{}], ['s3']]) assert.throws(() => fieldValue(field,value));
});
test('payload preserves version, drops unknown input, normalizes fields and fails disabled actions', () => {
  const option = {payload:{repairPlanVersion:'v2'},fields:[{id:'note',label:'意见',required:true,maxLength:4}]};
  assert.deepEqual(buildPayload(option,{note:' 好 ',evil:'x'}),{repairPlanVersion:'v2',note:'好'});
  assert.throws(()=>buildPayload(option,{note:''}));
  assert.throws(()=>buildPayload(option,{note:'12345'}));
  assert.throws(()=>buildPayload({...option,enabled:false},{note:'好'}));
  assert.throws(()=>buildPayload({fields:[{type:'text'}]},{}));
  assert.equal(options({actionOptions:[{enabled:false}]} )[0].disabled,true);
});
test('HTTPS receipt rejects absent host, whitespace and insecure protocol', () => {
  const field={key:'url',label:'发布链接',type:'url',required:true};
  for(const value of ['', 'http://x', 'https://', 'https:///path', 'https://x/a b']) assert.throws(()=>fieldValue(field,value));
  assert.equal(fieldValue(field,' https://example.com/a?q=b '),'https://example.com/a?q=b');
});
test('generated web and native payloads follow the same source', async () => {
  const web = await import('./action-form.mjs');
  const nativeBox={module:{exports:{}}}; require('node:vm').runInNewContext(require('node:fs').readFileSync(__dirname+'/../apps/shooting-miniapp/lib/action-form.js','utf8'),nativeBox); const native=nativeBox.module.exports;
  const option={payload:{version:'7'},fields:[{key:'cap',type:'number',min:0},{key:'sceneIds',type:'scenes'}]};
  const input={cap:'2',sceneIds:['s1','s1']};
  assert.equal(JSON.stringify(web.buildPayload(option,input)),JSON.stringify(native.buildPayload(option,input)));
});

test('actual approval consumers use shared validators',()=>{const fs=require('node:fs');const approval=fs.readFileSync(__dirname+'/../src/components/assistant/AssistantDecisionCenter.tsx','utf8');const rework=fs.readFileSync(__dirname+'/../src/components/socialContent/SocialSceneReworkPanel.tsx','utf8');assert.match(approval,/note: fieldValue/);assert.match(rework,/preview\(scope\(\), availability, fieldValue/);assert.match(rework,/confirm\(status, cost, fieldValue/);assert.match(rework,/max: admissionPreview.quote.maximumOriginalBudgetCny/);});
