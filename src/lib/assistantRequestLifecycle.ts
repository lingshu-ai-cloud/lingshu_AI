/** Client-side response isolation only; never grants API authorization. */
export function sameAssistantRequestIdentity(
  original: string | null,
  current: string | null,
  scope: { userId: string; tenantId: string },
): boolean {
  if (!original || !current) return false;
  if (original === current) return true;
  const principal = (token: string) => {
    try {
      const encoded = token.startsWith('local-demo.v1.') ? token.split('.')[2] : token.split('.')[1];
      const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(decodeURIComponent(Array.from(atob(normalized), char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')));
      const userId = claims.sub ?? claims.id;
      const tenantId = claims.tenantId ?? claims.tenant_id;
      if (userId !== scope.userId || (tenantId && tenantId !== scope.tenantId)) return null;
      return JSON.stringify([userId, tenantId ?? '', claims.iss ?? '', claims.aud ?? '', claims.collectionId ?? '', claims.role ?? '', claims.supportAccess ?? null]);
    } catch { return null; }
  };
  const identity = principal(original);
  return identity !== null && identity === principal(current);
}

/** Bound both first-byte and between-chunk waiting; clean timers on every exit. */
export async function withAssistantIdleTimeout<T>(operation: Promise<T>, controller: AbortController, timeoutMs = 45_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('回答等待时间较长，已保留收到的内容。请发送“继续”或稍后重试。'));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
