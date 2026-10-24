const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const scope = { module:{ exports:{} }, encodeURIComponent }
vm.runInNewContext(fs.readFileSync(__dirname + '/lib/content-task.js', 'utf8'), scope)
const model = scope.module.exports

test('content task presentation keeps exact artifact versions and delivery receipt', () => {
  const card = model.present({ contentTaskId:'task-1', cardVersion:'9', overallState:'needs_approval',
    progress:{ mode:'units', completed:0, total:1 }, cost:null, knownItems:[], defaultedItems:[],
    artifacts:[{ artifactId:'artifact-1', version:'3', status:'review_required', kind:'social_image', previewAvailable:true }],
    deliveryReceipts:[] })
  assert.equal(card.currentArtifact.artifactId, 'artifact-1')
  assert.equal(card.currentArtifact.version, '3')
  assert.equal(card.currentArtifact.reviewable, true)
  assert.equal(card.canPackage, false)
})

test('approved artifacts enable packaging while ready receipt exposes only server download route', () => {
  const approved = model.present({ overallState:'completed', progress:{mode:'none'}, knownItems:[], defaultedItems:[],
    artifacts:[{artifactId:'artifact-1',version:'4',status:'approved',kind:'video',previewAvailable:true}], deliveryReceipts:[] })
  assert.deepEqual(approved.approvedArtifactIds, ['artifact-1'])
  assert.equal(approved.canPackage, true)
  const delivered = model.present({ ...approved, deliveryReceipts:[{packageId:'package-1',status:'ready',downloadHref:'/api/overseas/starter-198/social-content/delivery-packages/package-1/download'}] })
  assert.equal(delivered.canPackage, false)
  assert.equal(delivered.readyReceipt.packageId, 'package-1')
})

test('mutation paths and idempotency keys are stable for one exact version', () => {
  assert.equal(model.artifactDecisionPath('task a','artifact/1'), 'starter-198/social-content/tasks/task%20a/artifacts/artifact%2F1/decision')
  const first = model.operationKey('approved','task-1','artifact-1','3')
  assert.equal(first, model.operationKey('approved','task-1','artifact-1','3'))
  assert.notEqual(first, model.operationKey('approved','task-1','artifact-1','4'))
  assert.match(first, /^[a-z0-9:_-]{8,200}$/i)
})
