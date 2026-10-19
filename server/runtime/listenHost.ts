/** Explicit overrides are intentionally limited to literal loopback addresses.
 * The unset case preserves the deployed listener's historical behavior. */
export function resolveListenHost(value: string | undefined): '0.0.0.0' | '127.0.0.1' | '::1' {
  if (value === undefined) return '0.0.0.0';
  if (value === '127.0.0.1' || value === '::1') return value;
  throw new Error('LINGSHU_LISTEN_HOST must be a literal loopback address (127.0.0.1 or ::1)');
}
