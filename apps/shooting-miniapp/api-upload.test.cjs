const test = require('node:test')
const assert = require('node:assert/strict')
const { loadApi } = require('./test-support/native-api.cjs')

test('real upload API accepts an omitted progress callback and posts bytes', async () => {
  let bytes
  const api = loadApi({ getStorageSync: () => 'test-token', getFileSystemManager: () => ({ readFile: ({ success, length }) => queueMicrotask(() => success({ data: new ArrayBuffer(length) })) }), request: options => { bytes = options.data; options.success({ statusCode: 201, data: { material: { id: 'm1' } } }) } })
  assert.equal((await api.uploadVideo({ tempFilePath: 'fake-video', size: 3 })).id, 'm1')
  assert.equal(bytes.byteLength, 3)
})

test('owned image uses authenticated download and external public image never receives credentials', async () => {
  const calls = []
  const api = loadApi({ getStorageSync: () => 'test-token', downloadFile: options => { calls.push(options); options.success({ statusCode: 200, tempFilePath: 'wxfile://image' }) } })
  assert.equal(await api.cacheImage('http://127.0.0.1:8896/media/tenants/tenant/image.png?assetToken=signed'), 'wxfile://image')
  assert.equal(calls[0].header.Authorization, 'Bearer test-token')
  assert.equal(await api.cacheImage('https://external.invalid/image.png'), 'https://external.invalid/image.png')
  assert.equal(calls.length, 1)
  await assert.rejects(api.downloadPrivate('/media/../other'), /下载地址无效/)
})

test('native mock translation uses the existing preview contract and production does not send local origin', async () => {
  const calls = [], wx = { getStorageSync: () => 'test-token', request: options => { calls.push(options); options.success({ statusCode: 200, data: { translatedText: 'Hello' } }) } }
  await loadApi(wx).translateCustomerReply('你好', '英语', 'mock-buyer')
  assert.equal(calls[0].header.Origin, 'http://127.0.0.1:5191')
  assert.equal(calls[0].data.customerId, 'mock-buyer')
  assert.equal(calls[0].data.manualRequest, true)
  await loadApi(wx, { apiBase: 'https://service.invalid', localPreviewOrigin: 'http://127.0.0.1:5191' }).translateText('Hello', 'English', '简体中文', 'real-buyer')
  assert.equal(calls[1].header.Origin, undefined)
  assert.equal(calls[1].data.manualRequest, undefined)
})
