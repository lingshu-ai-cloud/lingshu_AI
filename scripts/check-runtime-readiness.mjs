import { pathToFileURL } from 'node:url';

// Runtime readiness uses status, separately from the weekly production gate.
export async function checkRuntimeReadiness(url, { timeoutMs = 4000, maxBytes = 262144 } = {}) {
  let target;
  try { target = new URL(url); } catch { throw new Error('invalid_url'); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('invalid_url');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
      || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) {
    throw new Error('invalid_limits');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, {
      signal: controller.signal, redirect: 'manual', headers: { Accept: 'application/json' },
    });
    if (response.status !== 200) throw new Error('http_status');
    const mediaType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(mediaType)) {
      throw new Error('content_type');
    }
    const length = response.headers.get('content-length');
    if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new Error('response_too_large');
    if (!response.body) throw new Error('invalid_json');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error('response_too_large');
      chunks.push(chunk);
    }
    let report;
    try { report = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('invalid_json'); }
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!object(report) || typeof report.status !== 'string' || !Array.isArray(report.issues)
        || !['all', 'web', 'worker'].includes(report.role) || !object(report.capabilities)
        || !object(report.build) || !['commitSha', 'version', 'startedAt'].every(key =>
          typeof report.build[key] === 'string' && report.build[key].length > 0)) {
      throw new Error('invalid_schema');
    }
    if (report.status !== 'ready' || report.issues.length !== 0) throw new Error('not_ready');
    return report;
  } catch (error) {
    controller.abort();
    const safeCodes = ['http_status', 'content_type', 'response_too_large', 'invalid_json', 'invalid_schema', 'not_ready'];
    throw new Error(safeCodes.includes(error?.message) ? error.message : 'request_failed');
  } finally {
    clearTimeout(timer);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    console.error('Runtime readiness failed: expected one URL argument');
    process.exitCode = 1;
  } else {
    try {
      await checkRuntimeReadiness(process.argv[2]);
      console.log('Runtime readiness passed');
    } catch (error) {
      console.error(`Runtime readiness failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
