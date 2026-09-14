export function trialDay(activatedAt?: string | null): number | null {
  if (!activatedAt) return null;
  const start = new Date(activatedAt).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(1, Math.floor((Date.now() - start) / (24 * 3600 * 1000)) + 1);
}

export function accountStage(entry: {
  status?: string;
  activatedAt?: string | null;
  expiresAt?: string | null;
  rotatedAt?: string | null;
}): string {
  if (entry.status === 'admin') return '长期维护';
  if (entry.rotatedAt) return '已到期/已轮换密码';
  if (!entry.activatedAt) return '未激活';
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) return '已到期';
  return '试用中';
}
