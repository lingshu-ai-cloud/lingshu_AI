const { apiBase } = require('../config')
const TOKEN_KEY = 'overseas_token'

function base() {
  const value = String(apiBase || '').replace(/\/$/, '')
  if (!/^https:\/\//.test(value)) throw new Error('请先配置现有服务的 HTTPS 地址')
  return value
}

function token() { return wx.getStorageSync(TOKEN_KEY) || '' }
function clearToken() { wx.removeStorageSync(TOKEN_KEY) }

function request(path, method = 'GET', data, authorized = true) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: base() + '/api/overseas/' + path,
      method,
      data,
      header: { 'Content-Type': 'application/json', ...(authorized && token() ? { Authorization: 'Bearer ' + token() } : {}) },
      success(res) {
        if (res.statusCode === 401) clearToken()
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(((res.data && res.data.error) || (res.statusCode === 404 ? '当前服务器未提供此功能接口' : res.statusCode === 401 ? '登录已过期，请退出后重新登录' : '请求失败')) + '（HTTP ' + res.statusCode + '）'))
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
  return result
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
  token, clearToken, login, uploadVideo,
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
  attach: (id, materialId) => request('studio/shooting-tasks/' + encodeURIComponent(id) + '/uploads', 'POST', { uploadedMaterialIds: [materialId] })
}
