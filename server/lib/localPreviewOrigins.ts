const DEFAULT_LOCAL_PREVIEW_ORIGINS = [
  'http://127.0.0.1:5177',
  'http://localhost:5177',
  'http://[::1]:5177',
];

export function localPreviewOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const configured = String(env.LINGSHU_LOCAL_PREVIEW_ORIGINS || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  const origins = configured.length ? configured : DEFAULT_LOCAL_PREVIEW_ORIGINS;
  return new Set(origins.filter(origin => {
    try {
      const url = new URL(origin);
      return url.protocol === 'http:' && url.origin === origin
        && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    } catch { return false; }
  }));
}
