// 复制为 config.js，填入现有服务的 HTTPS 地址。不要把密钥写进小程序。
module.exports = { apiBase: 'https://YOUR_EXISTING_DOMAIN' }

// 仅回环联调时可填写后端既有白名单 Origin，例如 localPreviewOrigin: 'http://127.0.0.1:5191'。
// 预览翻译/推荐仍要求已登录的本地身份、模拟客户 ID 和人工触发，不用于真实渠道发送。
