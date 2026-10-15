const { apiBase } = require('../config')
const { httpFailure } = require('./request-policy')
const TOKEN_KEY = 'overseas_token'

function base() {
  const value = String(apiBase || '').replace(/\/$/, '')
  const secure = /^https:\/\//.test(value)
  const loopback = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(value)
  if (!secure && !loopback) throw new Error('请配置 HTTPS 服务地址；本地联调仅允许 127.0.0.1 或 localhost')
  return value
}

function token() { return wx.getStorageSync(TOKEN_KEY) || '' }
function clearToken() { wx.removeStorageSync(TOKEN_KEY) }
function assetUrl(value) {
  const url = String(value || '')
  if (/^https:\/\//.test(url)) return url
  return url.startsWith('/') ? base() + url : url
}

function request(path, method = 'GET', data, authorized = true) {
  const requestToken = authorized ? token() : ''
  return new Promise((resolve, reject) => {
    wx.request({
      url: base() + '/api/overseas/' + path,
      method,
      data,
      header: { 'Content-Type': 'application/json', ...(requestToken ? { Authorization: 'Bearer ' + requestToken } : {}) },
      success(res) {
        if (res.statusCode === 401 && requestToken && token() === requestToken) clearToken()
        if (res.statusCode < 200 || res.statusCode >= 300) { const failure = httpFailure(res.statusCode, res.data); const message = failure.stale ? '这项待办已更新，请刷新最新内容' : failure.message; const error = new Error(message + '（HTTP ' + failure.status + '）'); Object.assign(error, failure, { message: error.message }); return reject(error) }
        if (!res.data || typeof res.data !== 'object') return reject(new Error('服务器未返回接口数据，请检查服务版本（HTTP ' + res.statusCode + '）'))
        resolve(res.data)
      },
      fail(err) { reject(new Error(err.errMsg || '网络连接失败')) }
    })
  })
}

async function login(email, password) {
  const result = await request('auth/login', 'POST', { email, password }, false)
  if (!result.token) throw new Error('登录失败')
  wx.setStorageSync(TOKEN_KEY, result.token)
  // `/auth/me` includes the server-authoritative product profile. Keeping the
  // login response free of client-side plan inference also works for accounts
  // whose product access changes independently of their subscription label.
  return request('auth/me')
}

function uploadVideo(file, onProgress) {
  const query = [
    ['name', file.name || 'mobile-shoot.mp4'], ['folder', 'social'], ['type', 'video'],
    ['duration', String(file.duration || 0)], ['width', String(file.width || 0)],
    ['height', String(file.height || 0)], ['mimeType', file.mimeType || 'video/mp4'], ['sourceType', 'local-upload']
  ].map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&')
  return new Promise((resolve, reject) => {
    // 与网页端共用 application/octet-stream 上传接口。小程序请求需先组装 ArrayBuffer。
    const fs = wx.getFileSystemManager()
    const chunkSize = 1024 * 1024
    const chunks = []
    let offset = 0
    function readNext() {
      if (offset >= file.size) {
        const bytes = new Uint8Array(file.size)
        let position = 0
        chunks.forEach(chunk => { bytes.set(new Uint8Array(chunk), position); position += chunk.byteLength })
        wx.request({
          url: base() + '/api/overseas/studio/materials/file?' + query,
          method: 'POST', data: bytes.buffer,
          header: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + token() },
          success(res) {
            if (res.statusCode === 401) clearToken()
            if (res.statusCode < 200 || res.statusCode >= 300 || !res.data || !res.data.material) return reject(new Error((res.data && res.data.error) || '素材上传失败'))
            onProgress(100)
            resolve(res.data.material)
          },
          fail(err) { reject(new Error(err.errMsg || '素材上传失败')) }
        })
        return
      }
      const length = Math.min(chunkSize, file.size - offset)
      fs.readFile({ filePath: file.tempFilePath, position: offset, length, success(res) {
        chunks.push(res.data)
        offset += length
        onProgress(Math.min(30, Math.floor(offset / file.size * 30)))
        readNext()
      }, fail(err) { reject(new Error(err.errMsg || '读取视频失败')) } })
    }
    readNext()
  })
}

module.exports = {
  token, clearToken, login, uploadVideo, assetUrl,
  me: () => request('auth/me'),
  products: async () => {
    const profile = await request('enterprise/profile')
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || !profile.products || typeof profile.products !== 'object') throw new Error('企业知识库返回异常，请稍后重试')
    const items = profile.products.items || []
    if (!Array.isArray(items)) throw new Error('企业产品资料格式异常，请稍后重试')
    return { items: items.filter(item => item && typeof item.name === 'string' && item.name.trim()).map((item, index) => ({ id: String(item.id || item.sku || item.name + '-' + index), name: item.name.trim() })) }
  },
  createTask: data => request('studio/shooting-tasks', 'POST', data),
  tasks: () => request('studio/shooting-tasks'),
  studioProject: id => request('studio/projects/' + encodeURIComponent(id)),
  attach: (id, materialId) => request('studio/shooting-tasks/' + encodeURIComponent(id) + '/uploads', 'POST', { uploadedMaterialIds: [materialId] })
}

module.exports.request = request
module.exports.chat = messages => new Promise((resolve, reject) => {
  wx.request({ url: base() + '/api/overseas/strategy/chat', method: 'POST', data: { messages, deepThinking: false }, timeout: 120000, dataType: 'text', responseType: 'text', header: { 'Content-Type':'application/json', Authorization:'Bearer '+token() },
    success(res) { if (res.statusCode === 401) clearToken(); if (res.statusCode !== 200) return reject(new Error('助手请求失败（HTTP '+res.statusCode+'）')); let answer = ''; let failure = ''; String(res.data).split('\n').forEach(line => { if (!line.startsWith('data: ') || line.includes('[DONE]')) return; try { const event = JSON.parse(line.slice(6)); if (event.text) answer += event.text; if (event.error) failure = event.error } catch (_) {} }); if (failure) reject(new Error(failure)); else if (answer) resolve(answer); else reject(new Error('助手未返回回答，请重试')) }, fail(e) { reject(new Error(e.errMsg || '助手连接失败')) }
  })
})

module.exports.command = body => request('starter-198/commands', 'POST', body);
module.exports.customers = () => request('customers')
module.exports.sendCustomerMessage = (customerId, body, requestId) => request('customers/' + encodeURIComponent(customerId) + '/outbox', 'POST', { body, requestId })
module.exports.translateText = (text, source, target) => request('plugins/translate/run', 'POST', { text, source, target })
module.exports.translateCustomerReply = (text, target) => module.exports.translateText(text, '简体中文', target)
module.exports.recommendCustomerReply = (customer, instruction) => request('agents/conversion/draft', 'POST', {
  customerId: customer.id,
  language: customer.language || 'English',
  stage: customer.stage || '',
  timeline: customer.timeline || [],
  message: customer.preview || '',
  intent: 'reply',
  instruction: instruction || '',
  manualRequest: true
})
