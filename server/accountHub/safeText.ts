const SENSITIVE_FIELD = /(?:password|passwd|passphrase|cookie|set[_-]?cookie|refresh[_-]?token|access[_-]?token|id[_-]?token|session(?:[_-]?(?:id|key|token))?|secret|credential|api[_-]?key|authorization|auth[_-]?json|private[_-]?key)/i;
const CREDENTIAL_ASSIGNMENT = /(?:password|passwd|passphrase|cookie|set[_-]?cookie|refresh[_-]?token|access[_-]?token|id[_-]?token|session(?:[_-]?(?:id|key|token))?|secret|credential|api[_-]?key|authorization|auth[_-]?json|private[_-]?key)["']?\s*[:=]/i;
const RAW_CREDENTIAL = /^(?:Bearer\s+\S+|Basic\s+\S+|sk-[A-Za-z0-9_-]{12,}|(?:eyJ[A-Za-z0-9_-]{8,}\.){2}[A-Za-z0-9_-]{8,})$/i;

function structuredCredential(value: string): boolean {
  const trimmed = value.trim();
  if ((!trimmed.startsWith('{') && !trimmed.startsWith('[')) || trimmed.length > 10_000) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const seen = new WeakSet<object>();
    const visit = (candidate: unknown): boolean => {
      if (!candidate || typeof candidate !== 'object') return false;
      if (seen.has(candidate)) return false;
      seen.add(candidate);
      if (Array.isArray(candidate)) return candidate.some(visit);
      return Object.entries(candidate).some(([key, child]) => SENSITIVE_FIELD.test(key) || visit(child));
    };
    return visit(parsed);
  } catch {
    return false;
  }
}

/** Conservative detector for credentials hidden inside otherwise allowed text fields. */
export function containsCredentialLikeText(value: string): boolean {
  const trimmed = value.trim();
  return RAW_CREDENTIAL.test(trimmed)
    || CREDENTIAL_ASSIGNMENT.test(trimmed)
    || structuredCredential(trimmed);
}

/** Plans/auth modes are labels, never arbitrary transport strings or JSON. */
export function isStrictSafeLabel(value: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N} ._+()/-]*$/u.test(value);
}

/** OTLP dimensions exported by the dashboard are intentionally identifier-like. */
export function isSafeTelemetryIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/+@-]*$/.test(value);
}
