/** Keep a concise provider diagnostic without forwarding credentials or URLs. */
export function safeMetaIssueText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/https?:\/\/[^\s<>]+/gi, '[链接]')
    .replace(/EAA[A-Za-z0-9_-]{20,}/g, '[已隐藏]')
    .replace(/(?:access_token|client_secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '[已隐藏]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
}
