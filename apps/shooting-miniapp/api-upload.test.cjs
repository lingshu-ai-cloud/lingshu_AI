const test = require('node:test')
const assert = require('node:assert/strict')
const { loadApi } = require('./test-support/native-api.cjs')

test('real upload API accepts an omitted progress callback and posts bytes', async () => {
  let bytes
  const api = loadApi({ getStorageSync: () => 'test-token', getFileSystemManager: () => ({ readFile: ({ success, length }) => queueMicrotask(() => success({ data: new ArrayBuffer(length) })) }), request: options => { bytes = options.data; options.success({ statusCode: 201, data: { material: { id: 'm1' } } }) } })
  assert.equal((await api.uploadVideo({ tempFilePath: 'fake-video', size: 3 })).id, 'm1')
  assert.equal(bytes.byteLength, 3)
})

test('owned images use authenticated bytes on devices without downloadFile and external images never receive credentials', async () => {
  const calls = [], files = []
  const api = loadApi({ getStorageSync: () => 'test-token', env: { USER_DATA_PATH: 'wxfile://usr' },
    request: options => { calls.push(options); options.success({statusCode:200,header:{'Content-Type':'image/png'},data:new ArrayBuffer(3)}) },
    getFileSystemManager: () => ({writeFile: options => {files.push(options);options.success()}}),
    downloadFile: () => { throw Error('downloadFile unavailable on device') },
  })
  const local = await api.cacheImage('http://127.0.0.1:8896/media/tenants/tenant/image.png?assetToken=signed')
  assert.match(local, /^wxfile:\/\/usr\/lingshu-image-[a-f0-9]+\.png$/)
  assert.equal(calls[0].header.Authorization, 'Bearer test-token')
  assert.equal(calls[0].responseType, 'arraybuffer')
  assert.equal(files[0].data.byteLength,3)
  assert.equal(await api.cacheImage('https://external.invalid/image.png'), 'https://external.invalid/image.png')
  assert.equal(calls.length, 1)
  await assert.rejects(api.downloadPrivate('/media/../other'), /下载地址无效/)
})

test('image HTTP failures and non-image responses are reported instead of cached as successful images', async () => {
  const api=loadApi({getStorageSync:()=> 'token',request:o=>o.success({statusCode:404})})
  await assert.rejects(api.cacheImage('/media/missing.png'), /HTTP 404/)
  const html=loadApi({getStorageSync:()=> 'token',request:o=>o.success({statusCode:200,header:{'content-type':'text/html'},data:new ArrayBuffer(5)})})
  await assert.rejects(html.cacheImage('/media/login.png'), /不是图片/)
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
