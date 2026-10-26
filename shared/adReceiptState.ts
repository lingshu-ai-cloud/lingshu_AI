/** Only successful, resource-scoped receipts establish the expected switch state. */
export function adReceiptState(receipts: Array<{ action?: unknown; status?: unknown; connectionId?: unknown; resourceId?: unknown; createdAt?: unknown }>, connectionId: string, resourceId: string) {
  const scoped = receipts.filter(r => r.connectionId === connectionId && r.resourceId === resourceId)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const pending = scoped.some(r => ['UNKNOWN', 'EXECUTING', 'PROVIDER_ACCEPTED'].includes(String(r.status)));
  const latest = scoped.find(r => r.status === 'VERIFIED' && ['create', 'activate', 'resume', 'pause'].includes(String(r.action)));
  return { pending, expected: latest ? ['activate', 'resume'].includes(String(latest.action)) ? 'ACTIVE' : 'PAUSED' : null, action: latest?.action };
}
