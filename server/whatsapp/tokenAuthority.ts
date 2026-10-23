/** Zero from Meta means no scheduled expiration, not immunity to revocation. Missing data fails closed. */
export function whatsappTokenExpiry(authority: any, appId: string): string {
  if (authority?.is_valid !== true || String(authority.app_id) !== appId || !Array.isArray(authority.scopes)
    || !['whatsapp_business_management', 'whatsapp_business_messaging'].every(scope => authority.scopes.includes(scope)))
    throw Error('whatsapp_token_authority_invalid');
  const deadlines = [authority.expires_at, authority.data_access_expires_at];
  if (typeof authority.expires_at !== 'number' || deadlines.some(value => value !== undefined && (!Number.isFinite(value) || value < 0)))
    throw Error('whatsapp_token_expiry_unknown');
  const expiring = deadlines.filter((value): value is number => typeof value === 'number' && value > 0);
  const deadline = expiring.length ? Math.min(...expiring) * 1000 : 0;
  if (deadline && deadline <= Date.now()) throw Error('whatsapp_token_expired');
  if (deadline && !Number.isFinite(new Date(deadline).getTime())) throw Error('whatsapp_token_expiry_unknown');
  return deadline ? new Date(deadline).toISOString() : '';
}
