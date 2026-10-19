/** Process-local credentials for the opt-in task card. Never use the ordinary
 * local-demo audience or configured signing secret: those can be accepted by
 * the general application. A process restart intentionally revokes all cards. */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const WEEKLY_TASK_CARD_TOKEN_PREFIX = 'weekly-cta-card.v1.';
const AUDIENCE = 'lingshu-weekly-cta-only';

type Scope = { tenantId: string; userId: string; programId: string; packageId: string; packageVersion: number };
type Claims = Scope & { aud: typeof AUDIENCE; iat: number; exp: number; jti: string };

export function createWeeklyTaskCardTokenAuthority(scope: Scope) {
  const secret = randomBytes(32);
  const signature = (payload: string) => createHmac('sha256', secret).update(`v1.${payload}`).digest('base64url');
  return {
    issue(nowMs = Date.now()): string {
      const now = Math.floor(nowMs / 1000);
      const claims: Claims = { ...scope, aud: AUDIENCE, iat: now, exp: now + 15 * 60, jti: randomUUID() };
      const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
      return `${WEEKLY_TASK_CARD_TOKEN_PREFIX}${payload}.${signature(payload)}`;
    },
    verify(header: string | undefined, nowMs = Date.now()): boolean {
      const token = /^Bearer (\S+)$/.exec(header ?? '')?.[1];
      if (!token?.startsWith(WEEKLY_TASK_CARD_TOKEN_PREFIX)) return false;
      const compact = token.slice(WEEKLY_TASK_CARD_TOKEN_PREFIX.length);
      const split = compact.lastIndexOf('.');
      if (split <= 0) return false;
      const payload = compact.slice(0, split), supplied = Buffer.from(compact.slice(split + 1), 'utf8');
      const expected = Buffer.from(signature(payload), 'utf8');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
      try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Claims>;
        const now = Math.floor(nowMs / 1000);
        return claims.aud === AUDIENCE && claims.tenantId === scope.tenantId && claims.userId === scope.userId
          && claims.programId === scope.programId && claims.packageId === scope.packageId
          && claims.packageVersion === scope.packageVersion
          && Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp)
          && claims.iat! <= now + 60 && claims.exp! > now && claims.exp! > claims.iat!
          && claims.exp! - claims.iat! === 15 * 60
          && typeof claims.jti === 'string' && /^[0-9a-f-]{36}$/.test(claims.jti);
      } catch { return false; }
    },
  };
}
