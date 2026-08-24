export function whatsappWindowState(lastBuyerMessageAt: number | undefined, now = Date.now()): {
  status: 'open' | 'closed' | 'unknown';
  closesAt?: string;
  templateRequired: boolean;
} {
  if (!lastBuyerMessageAt) return { status: 'unknown', templateRequired: true };
  const closesAt = lastBuyerMessageAt + 24 * 60 * 60 * 1000;
  return {
    status: now <= closesAt ? 'open' : 'closed',
    closesAt: new Date(closesAt).toISOString(),
    templateRequired: now > closesAt,
  };
}
