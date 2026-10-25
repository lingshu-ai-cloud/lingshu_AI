import type { RequestHandler } from 'express';
import { withAssistantPreviewInformation } from '../../scripts/customer-preview-ai-scope.mjs';
import { localPreviewRequestRejection } from '../auth/authIdentityHelpers.js';

/** Explicit opt-in for authenticated loopback preview questions; no channels or task actions. */
export const previewInformationScope: RequestHandler = (req, res, next) => {
  if (process.env.LINGSHU_LOCAL_PREVIEW !== '1') { next(); return; }
  if (process.env.NODE_ENV !== 'development' || process.env.ASSISTANT_PREVIEW_REAL_QUERIES !== '1'
    || res.locals.dataAuthority !== 'local' || localPreviewRequestRejection(req.headers.origin, req.socket.remoteAddress)) {
    res.status(403).json({ error: 'assistant_preview_real_queries_not_enabled' }); return;
  }
  const status = Reflect.get(globalThis, Symbol.for('lingshu.customerIsolationStatus'));
  if (typeof status !== 'function' || !status().installed) { res.status(503).json({ error: 'customer_isolation_guard_missing' }); return; }
  void withAssistantPreviewInformation(() => new Promise<void>(resolve => {
    const complete = () => { res.off('finish', complete); res.off('close', complete); resolve(); };
    res.once('finish', complete); res.once('close', complete);
    next();
  })).then(({ audit }) => {
    console.info('[assistant-preview-information]', JSON.stringify(audit));
  }).catch(() => { if (!res.headersSent) res.status(503).json({ error: 'assistant_preview_query_failed' }); });
};
