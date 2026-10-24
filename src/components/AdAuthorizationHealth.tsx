export type AdAuthorization = {
  status: 'healthy' | 'expiring' | 'expired' | 'revoked' | 'missing_permissions' | 'unknown';
  reasonCode: string;
  expiresAt?: string;
  dataAccessExpiresAt?: string;
  grantedScopes?: string[];
  checkedAt?: string;
};
const labels: Record<AdAuthorization['status'], string> = {
  healthy: '授权有效', expiring: '授权即将到期，请重新授权', expired: '授权已到期，请重新授权',
  revoked: '授权已撤销，请重新授权', missing_permissions: '授权权限不足，请核对账户权限后重新授权', unknown: '授权状态待检查',
};
function date(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
}
export default function AdAuthorizationHealth({ authorization }: { authorization?: AdAuthorization }) {
  const state = authorization?.status || 'unknown';
  const expiry = date(authorization?.expiresAt), accessExpiry = date(authorization?.dataAccessExpiresAt);
  return <small role="status">
    {labels[state] || labels.unknown}
    {expiry && ` · 凭证到期 ${expiry}`}{accessExpiry && ` · 数据访问到期 ${accessExpiry}`}
    {date(authorization?.checkedAt) && ` · 检查于 ${date(authorization?.checkedAt)}`}
  </small>;
}
