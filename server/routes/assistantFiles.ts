import { Router, type RequestHandler } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { requireAuth, enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';
import { renderAssistantFile, type AssistantFileInput } from '../assistant/renderFile.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type Metadata = { id: string; name: string; mimeType: string; size: number; sha256: string };
export function createAssistantFilesRouter(options: { root?: string; authorize?: RequestHandler; render?: typeof renderAssistantFile } = {}) {
  const router = Router(); router.use(options.authorize || requireAuth);
  const directory = (locals: AuthLocals) => path.join(options.root || process.env.ASSISTANT_FILES_ROOT || path.join(process.cwd(), 'data/assistant-files'), hash(locals.tenantId), hash(locals.userId));
  router.post('/', enforceSupportSessionReadOnly, async (req, res) => {
    try {
      const { tenantId, userId } = res.locals as AuthLocals;
      if (!tenantId || !userId) { res.status(401).json({ message: '请先登录。' }); return; }
      const body = req.body;
      if (!body || !['pdf', 'jpg'].includes(body.format) || typeof body.content !== 'string' || !body.content.trim() || body.content.length > 16000 || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 160) { res.status(400).json({ message: '文件标题或内容不完整，正文最多16000字。' }); return; }
      const input: AssistantFileInput = { format: body.format, title: body.title.trim(), content: body.content.trim(), diagram: body.diagram === true };
      const id = hash(JSON.stringify([tenantId, userId, input])); const dir = directory(res.locals as AuthLocals);
      const existing = await fs.readFile(path.join(dir, `${id}.json`), 'utf8').then(value => JSON.parse(value) as Metadata).catch(() => null);
      if (existing && await fs.access(path.join(dir, `${id}.bin`)).then(() => true).catch(() => false)) { res.json({ file: existing }); return; }
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      if ((await fs.readdir(dir)).filter(name => name.endsWith('.json')).length >= 100) { res.status(409).json({ message: '已保存文件达到上限，请联系管理员归档后重试。' }); return; }
      const bytes = await (options.render || renderAssistantFile)(input);
      const valid = input.format === 'pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : bytes[0] === 255 && bytes[1] === 216;
      if (!valid || bytes.length > 12 * 1024 * 1024) throw new Error('文件生成失败，输出格式无效或体积过大。');
      const file: Metadata = { id, name: `${input.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').slice(0, 100)}.${input.format}`, mimeType: input.format === 'pdf' ? 'application/pdf' : 'image/jpeg', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      const temp = path.join(dir, `${id}.${randomUUID()}.tmp`);
      await fs.writeFile(temp, bytes, { mode: 0o600 }); await fs.rename(temp, path.join(dir, `${id}.bin`));
      const metadataTemp = path.join(dir, `${id}.${randomUUID()}.json.tmp`);
      await fs.writeFile(metadataTemp, JSON.stringify(file), { mode: 0o600 });
      await fs.rename(metadataTemp, path.join(dir, `${id}.json`));
      res.status(201).json({ file });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const safe = /^(?:文件生成正在排队|文件渲染服务未配置|图片内容过长|文件生成失败)/u.test(message) ? message : '文件未生成，渲染服务暂时不可用，请重试。';
      console.error('[assistant-files] generation failed', error);
      res.status(503).json({ message: safe });
    }
  });
  router.get('/:id/:content?', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    if (!tenantId || !userId) { res.sendStatus(401); return; }
    if (!/^[a-f0-9]{64}$/.test(req.params.id)) { res.sendStatus(404); return; }
    try {
      const dir = directory(res.locals as AuthLocals);
      const file: Metadata = JSON.parse(await fs.readFile(path.join(dir, `${req.params.id}.json`), 'utf8'));
      res.setHeader('Cache-Control', 'private, no-store');
      if (!req.params.content) { res.json({ file }); return; }
      if (req.params.content !== 'content') { res.sendStatus(404); return; }
      const bytes = await fs.readFile(path.join(dir, `${req.params.id}.bin`));
      res.setHeader('Content-Type', file.mimeType); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`); res.send(bytes);
    } catch { res.status(404).json({ message: '文件不存在或不属于当前用户，请重新生成。' }); }
  });
  return router;
}
export const assistantFilesRouter = createAssistantFilesRouter();
