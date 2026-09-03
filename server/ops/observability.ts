import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

type MetricLabels = Record<string, string | number | boolean>;
const counters = new Map<string, number>();
const gauges = new Map<string, number>();

function metricKey(name: string, labels: MetricLabels = {}): string {
  const labelText = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${String(value).replace(/["\\\n]/g, '_')}"`).join(',');
  return labelText ? `${name}{${labelText}}` : name;
}
export function incrementMetric(name: string, labels: MetricLabels = {}, value = 1): void {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + value);
}

export function setGauge(name: string, value: number, labels: MetricLabels = {}): void {
  gauges.set(metricKey(name, labels), value);
}

export function renderPrometheusMetrics(): string {
  const standard = [
    `process_uptime_seconds ${process.uptime()}`,
    `process_resident_memory_bytes ${process.memoryUsage().rss}`,
    `process_heap_used_bytes ${process.memoryUsage().heapUsed}`,
  ];
  return [...standard, ...[...counters, ...gauges].map(([key, value]) => `${key} ${value}`)].join('\n') + '\n';
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 2_000) : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    /password|secret|token|authorization|cookie|credential|api.?key/i.test(key) ? '[redacted]' : sanitize(item, depth + 1),
  ]));
}

export function structuredLog(level: 'debug' | 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const payload = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...sanitize(fields) as Record<string, unknown> });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
}

export function requestTelemetry(req: Request, res: Response, next: NextFunction): void {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  const requestId = /^[a-zA-Z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  const startedAt = performance.now();
  res.once('finish', () => {
    const durationMs = Math.round(performance.now() - startedAt);
    const routeGroup = req.path.split('/').slice(0, 5).join('/') || '/';
    incrementMetric('http_requests_total', { method: req.method, status: res.statusCode, route_group: routeGroup });
    incrementMetric('http_request_duration_ms_sum', { method: req.method, route_group: routeGroup }, durationMs);
    if (res.statusCode >= 400) structuredLog(res.statusCode >= 500 ? 'error' : 'warn', 'http.request.completed', {
      requestId, method: req.method, path: req.path, status: res.statusCode, durationMs,
    });
  });
  next();
}
