import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import {
  acknowledgeStartupAnnouncement,
  createStartupHubRecord,
  deleteStartupLeadChatImport,
  deleteStartupCompanyDocument,
  readStartupHubSnapshot,
  resolveStartupCompanyDocument,
  resolveStartupLeadChatImport,
  saveStartupCompanyDocument,
  saveStartupLeadChatImport,
  updateStartupCompany,
  updateStartupHubRecord,
} from '../startupHub/store.js';
import type { StartupCompanyDocumentCategory, StartupHubRecordKind } from '../../shared/startupHub.js';

export const startupHubRouter = Router();
const KINDS = new Set<StartupHubRecordKind>(['tasks', 'taxRecords', 'announcements', 'products', 'productDocuments', 'productReviews', 'developmentTasks', 'apiEndpoints', 'logSources', 'issues', 'resources', 'deployments', 'members', 'decisions', 'sops', 'sopRuns', 'capabilities', 'leads', 'leadActivities']);
const DOCUMENT_CATEGORIES = new Set<StartupCompanyDocumentCategory>(['license', 'articles', 'tax', 'bank', 'contract', 'hr', 'ip', 'other']);
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_CHAT_IMPORT_BYTES = 10 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
};
const ALLOWED_DOCUMENT_MIME = new Set(Object.values(MIME_BY_EXTENSION));
const CHAT_MIME_BY_EXTENSION: Record<string, string> = { '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json' };

function localPreview(req: Request, res: Response, next: NextFunction): void {
  const address = req.socket.remoteAddress || '';
  const loopback = address === '127.0.0.1' || address === '::1' || address.endsWith('127.0.0.1');
  if (process.env.NODE_ENV !== 'production' && loopback && req.header('x-startup-hub-preview') === 'local-preview') {
    Object.assign(res.locals, { tenantId: 'local-preview', userId: 'local-preview-user', dataAuthority: 'local' });
    next();
    return;
  }
  void requireAuth(req, res, next);
}

function kind(value: string): StartupHubRecordKind {
  if (!KINDS.has(value as StartupHubRecordKind)) throw new Error('Unsupported collection');
  return value as StartupHubRecordKind;
}

function sendError(response: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Request failed';
  response.status(message === 'Record not found' ? 404 : 400).json({ error: 'startup_hub_request_failed', message });
}

function safeDocumentName(value: unknown): string {
  return String(value || '').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 180);
}

function documentMime(name: string, declared: unknown): string | null {
  const normalized = String(declared || '').split(';', 1)[0].trim().toLowerCase();
  if (ALLOWED_DOCUMENT_MIME.has(normalized)) return normalized;
  return MIME_BY_EXTENSION[path.extname(name).toLowerCase()] || null;
}

function chatMime(name: string, declared: unknown): string | null {
  const extensionMime = CHAT_MIME_BY_EXTENSION[path.extname(name).toLowerCase()];
  if (!extensionMime) return null;
  const normalized = String(declared || '').split(';', 1)[0].trim().toLowerCase();
  if (normalized && !['text/plain', 'text/csv', 'application/json', 'application/octet-stream'].includes(normalized)) return null;
  return extensionMime;
}

async function inspectChatImport(filePath: string, mimeType: string): Promise<{ messageCount: number; startedAt?: string; endedAt?: string }> {
  const source = await fs.readFile(filePath, 'utf8');
  let messageCount = source.split(/\r?\n/).filter(line => line.trim()).length;
  if (mimeType === 'application/json') {
    try {
      const parsed = JSON.parse(source) as unknown;
      if (Array.isArray(parsed)) messageCount = parsed.length;
      else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { messages?: unknown[] }).messages)) messageCount = (parsed as { messages: unknown[] }).messages.length;
    } catch {
      throw new Error('JSON 聊天记录格式无效');
    }
  } else if (mimeType === 'text/csv' && messageCount > 0) {
    messageCount -= 1;
  }
  const timestamps = [...source.matchAll(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/g)]
    .map(match => new Date(match[0].replaceAll('/', '-')).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return {
    messageCount: Math.max(0, messageCount),
    startedAt: timestamps.length ? new Date(timestamps[0]).toISOString() : undefined,
    endedAt: timestamps.length ? new Date(timestamps[timestamps.length - 1]).toISOString() : undefined,
  };
}

startupHubRouter.use(localPreview);

startupHubRouter.get('/snapshot', async (_request, response) => {
  const { tenantId } = response.locals as AuthLocals;
  try { response.json({ snapshot: await readStartupHubSnapshot(tenantId) }); } catch (error) { sendError(response, error); }
});

startupHubRouter.put('/company', async (request, response) => {
  const { tenantId, userId } = response.locals as AuthLocals;
  try { response.json({ company: await updateStartupCompany(tenantId, userId, request.body) }); } catch (error) { sendError(response, error); }
});

startupHubRouter.post('/documents/file', async (request, response) => {
  const { tenantId, userId } = response.locals as AuthLocals;
  const name = safeDocumentName(request.query.name);
  const category = String(request.query.category || '') as StartupCompanyDocumentCategory;
  const expiryDate = String(request.query.expiryDate || '').trim() || undefined;
  const mimeType = documentMime(name, request.query.mimeType || request.header('content-type'));
  if (!name || !DOCUMENT_CATEGORIES.has(category) || !mimeType) {
    response.status(400).json({ error: 'invalid_document', message: '文件名称、分类或格式不符合要求' });
    return;
  }
  const declaredLength = Number(request.header('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES) {
    response.status(413).json({ error: 'document_too_large', message: '单个文件不能超过 20 MB' });
    return;
  }
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'startup-hub-document-'));
  const temporaryFile = path.join(temporaryDirectory, randomUUID());
  let bytes = 0;
  const digest = createHash('sha256');
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_DOCUMENT_BYTES) {
        callback(Object.assign(new Error('document too large'), { code: 'DOCUMENT_TOO_LARGE' }));
        return;
      }
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(request, limiter, createWriteStream(temporaryFile, { flags: 'wx', mode: 0o600 }));
    if (!bytes) throw new Error('文件内容为空');
    const document = await saveStartupCompanyDocument(tenantId, userId, {
      sourcePath: temporaryFile,
      name,
      category,
      mimeType,
      sizeBytes: bytes,
      sha256: digest.digest('hex'),
      expiryDate,
    });
    response.status(201).json({ document });
  } catch (error) {
    const tooLarge = (error as NodeJS.ErrnoException).code === 'DOCUMENT_TOO_LARGE';
    if (tooLarge) response.status(413).json({ error: 'document_too_large', message: '单个文件不能超过 20 MB' });
    else sendError(response, error);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

startupHubRouter.get('/documents/:id/content', async (request, response) => {
  const { tenantId } = response.locals as AuthLocals;
  try {
    const { document, filePath } = await resolveStartupCompanyDocument(tenantId, request.params.id);
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader('Content-Length', String(document.sizeBytes));
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`);
    response.setHeader('Cache-Control', 'private, no-store');
    createReadStream(filePath).on('error', error => sendError(response, error)).pipe(response);
  } catch (error) {
    sendError(response, error);
  }
});

startupHubRouter.delete('/documents/:id', async (request, response) => {
  const { tenantId } = response.locals as AuthLocals;
  try {
    await deleteStartupCompanyDocument(tenantId, request.params.id);
    response.status(204).end();
  } catch (error) {
    sendError(response, error);
  }
});

startupHubRouter.post('/lead-chats/file', async (request, response) => {
  const { tenantId, userId } = response.locals as AuthLocals;
  const name = safeDocumentName(request.query.name);
  const leadId = String(request.query.leadId || '').trim();
  const mimeType = chatMime(name, request.query.mimeType || request.header('content-type'));
  if (!name || !leadId || !mimeType) {
    response.status(400).json({ error: 'invalid_chat_import', message: '请选择线索，并上传 TXT、CSV 或 JSON 文件' });
    return;
  }
  const declaredLength = Number(request.header('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CHAT_IMPORT_BYTES) {
    response.status(413).json({ error: 'chat_import_too_large', message: '聊天记录文件不能超过 10 MB' });
    return;
  }
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'startup-hub-lead-chat-'));
  const temporaryFile = path.join(temporaryDirectory, randomUUID());
  let bytes = 0;
  const digest = createHash('sha256');
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_CHAT_IMPORT_BYTES) return callback(Object.assign(new Error('chat import too large'), { code: 'CHAT_IMPORT_TOO_LARGE' }));
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(request, limiter, createWriteStream(temporaryFile, { flags: 'wx', mode: 0o600 }));
    if (!bytes) throw new Error('聊天记录文件为空');
    const inspected = await inspectChatImport(temporaryFile, mimeType);
    const chatImport = await saveStartupLeadChatImport(tenantId, userId, {
      sourcePath: temporaryFile, leadId, name, mimeType, sizeBytes: bytes, sha256: digest.digest('hex'), ...inspected,
    });
    response.status(201).json({ chatImport });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'CHAT_IMPORT_TOO_LARGE') response.status(413).json({ error: 'chat_import_too_large', message: '聊天记录文件不能超过 10 MB' });
    else sendError(response, error);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

startupHubRouter.get('/lead-chats/:id/content', async (request, response) => {
  const { tenantId } = response.locals as AuthLocals;
  try {
    const { chatImport, filePath } = await resolveStartupLeadChatImport(tenantId, request.params.id);
    response.setHeader('Content-Type', chatImport.mimeType);
    response.setHeader('Content-Length', String(chatImport.sizeBytes));
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(chatImport.name)}`);
    response.setHeader('Cache-Control', 'private, no-store');
    createReadStream(filePath).on('error', error => sendError(response, error)).pipe(response);
  } catch (error) { sendError(response, error); }
});

startupHubRouter.delete('/lead-chats/:id', async (request, response) => {
  const { tenantId } = response.locals as AuthLocals;
  try { await deleteStartupLeadChatImport(tenantId, request.params.id); response.status(204).end(); }
  catch (error) { sendError(response, error); }
});

startupHubRouter.post('/:kind', async (request, response) => {
  const { tenantId, userId } = response.locals as AuthLocals;
  try { response.status(201).json({ record: await createStartupHubRecord(tenantId, userId, kind(request.params.kind), request.body) }); } catch (error) { sendError(response, error); }
});

startupHubRouter.post('/announcements/:id/acknowledge', async (request, response) => {
  const { tenantId, userId } = response.locals as AuthLocals;
  try { response.json({ record: await acknowledgeStartupAnnouncement(tenantId, userId, request.params.id) }); } catch (error) { sendError(response, error); }
});

startupHubRouter.patch('/:kind/:id', async (request, response) => {
  const { tenantId, userId } = response.locals as AuthLocals;
  try { response.json({ record: await updateStartupHubRecord(tenantId, userId, kind(request.params.kind), request.params.id, request.body) }); } catch (error) { sendError(response, error); }
});
