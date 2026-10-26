const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function page(api) {
  let definition
  vm.runInNewContext(fs.readFileSync(__dirname + '/packages/operator/conversation/index.js','utf8'), { Page: value => { definition=value }, require: id => id.endsWith('/api') ? api : {}, setTimeout, clearTimeout, wx: { showToast() {}, showModal() {} } })
  return { ...definition, data: { ...definition.data, customer: {id:'mock-buyer'}, customerId:'mock-buyer', targetLanguage:'英语', messages:[] }, setData(value) {Object.assign(this.data,value)} }
}

test('failed AI requests show an error with no invented recommendations', async () => {
  const p=page({recommendCustomerReply:async()=>{throw Error('provider unavailable')}})
  await p.loadRecommendations()
  assert.equal(p.data.recommendations.length,0); assert.ok(p.data.recommendationError); assert.equal(p.data.recommending,false)
})

test('partial recommendation success preserves one actual reply and does not fill a second', async () => {
  let count=0
  const p=page({recommendCustomerReply:async()=>{if(count++)throw Error('unavailable');return {draft:'Actual result',translatedDraft:'真实结果',generationSource:'provider_generated'} }})
  await p.loadRecommendations()
  assert.equal(p.data.recommendations.length,1); assert.equal(p.data.recommendations[0].body,'Actual result'); assert.ok(p.data.recommendationError)
})

test('degraded backend fallback is not labelled as a successful AI recommendation', async () => {
  const p=page({recommendCustomerReply:async()=>({draft:'fallback',generationSource:'degraded',status:'degraded'})})
  await p.loadRecommendations(); assert.equal(p.data.recommendations.length,0)
})

test('debounce window and translation failure both prevent sending original Chinese', async () => {
  let sends=0
  const p=page({translateCustomerReply:async()=>{throw Error('translation unavailable')},sendCustomerMessage:async()=>{sends++}})
  p.inputDraft({detail:{value:'请确认交期'}})
  await p.send(); assert.equal(sends,0); assert.equal(p.data.translating,true)
  clearTimeout(p.translationTimer); await p.translateDraft(p.data.draft,p.translationEpoch)
  assert.ok(p.data.translationError); await p.send(); assert.equal(sends,0); assert.equal(p.data.draft,'请确认交期')
  p.onUnload()
})

test('only a translation for the exact latest draft is sent, and stale responses cannot replace it', async () => {
  let resolveOld, sent
  const p=page({translateCustomerReply:body=>body==='旧问题'?new Promise(resolve=>{resolveOld=resolve}):Promise.resolve({translatedText:'New question'}),sendCustomerMessage:async(_id,body)=>{sent=body;return {localPreview:true}}})
  p.inputDraft({detail:{value:'旧问题'}}); clearTimeout(p.translationTimer)
  const old=p.translateDraft('旧问题',p.translationEpoch)
  p.inputDraft({detail:{value:'新问题'}}); clearTimeout(p.translationTimer)
  await p.translateDraft('新问题',p.translationEpoch)
  resolveOld({translatedText:'Old question'}); await old
  assert.equal(p.data.translatedDraft,'New question')
  await p.send(); assert.equal(sent,'New question'); assert.equal(p.data.messages[0].note,'新问题')
  p.onUnload()
})

test('empty translation never authorizes sending and a successful retry can recover', async () => {
  let text='', sends=0
  const p=page({translateCustomerReply:async()=>({translatedText:text}),sendCustomerMessage:async()=>{sends++;return {}}})
  p.data.draft='确认数量'; await p.translateDraft(p.data.draft); await p.send(); assert.equal(sends,0)
  text='Confirm quantity'; p.retryTranslation(); clearTimeout(p.translationTimer)
  await p.translateDraft(p.data.draft,p.translationEpoch); await p.send(); assert.equal(sends,1)
  p.onUnload()
})

test('late history translation does not erase a message sent while it was running', async () => {
  let finish
  const p=page({translateText:()=>new Promise(resolve=>{finish=resolve})})
  p.data.messages=[{id:'old',body:'Hello'}]
  const translating=p.fillMessageTranslations(p.data.messages,'English','mock-buyer')
  p.data.messages.push({id:'new',body:'Recently sent'})
  finish({translatedText:'你好'}); await translating
  assert.equal(p.data.messages.length,2); assert.equal(p.data.messages[0].note,'你好'); assert.equal(p.data.messages[1].id,'new')
})
