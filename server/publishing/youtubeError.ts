export function readableYouTubeError(error: any): string {
  const oauthError = error?.response?.data?.error;
  const oauthDescription = error?.response?.data?.error_description;
  const apiMessage = error?.response?.data?.error?.message;
  const reason = error?.response?.data?.error?.errors?.[0]?.reason;
  if (oauthError === 'invalid_grant') return '授权凭据无效或已过期。请重新登录 YouTube 授权，或联系服务顾问协助处理。';
  if (oauthError === 'invalid_client') return '授权应用配置不匹配。请联系服务顾问确认平台应用配置。';
  if (String(oauthDescription ?? '').toLowerCase().includes('bad request')) return 'Google 拒绝了本次授权参数。请重新授权，或联系服务顾问协助处理。';
  if (reason === 'insufficientPermissions') return '当前 YouTube 授权缺少上传权限，请重新连接账号并勾选 youtube.upload 权限';
  if (reason === 'accessNotConfigured') return '当前 Google Cloud 项目还没有启用 YouTube Data API v3，请先启用后再重试。';
  if (reason === 'quotaExceeded') return 'YouTube API 配额不足，今天暂时无法继续上传';
  if (error?.message === 'No channel found') return '这个 Google 账号没有可用的 YouTube 频道，请先登录 YouTube 创建频道后再连接。';
  if (error?.message === '保存 YouTube 账号失败') return 'YouTube 账号验证成功，但保存到数据库失败。请确认 PocketBase 已创建 youtube_accounts 表。';
  return oauthDescription || apiMessage || error?.message || 'YouTube 请求失败';
}
