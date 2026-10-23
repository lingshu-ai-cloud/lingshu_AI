import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AdSourceFileEvidence } from '../../shared/adSourceLifecycle.js';

export type HistoryFileRoots = { objectRoot?: string; mediaRoot?: string; materialsFile?: string };
type FileInput = { id: string; root?: string; key: string; prefix: string; sha256?: string; size?: number };
export async function fingerprintHistoryFile(input: FileInput): Promise<AdSourceFileEvidence> {
  const result: AdSourceFileEvidence = { id: input.id, state: 'unavailable', expectedSha256: /^[a-f0-9]{64}$/.test(input.sha256 || '') ? input.sha256! : null, actualSha256: null,
    expectedSize: Number.isSafeInteger(input.size) && Number(input.size) > 0 ? input.size! : null, actualSize: null, note: '未配置原企业文件只读根目录或文件记录无效。' };
  if (!input.root || !path.isAbsolute(input.root) || !input.key.startsWith(input.prefix)
    || input.key.includes('\\') || input.key.split('/').some(p => !p || p === '.' || p === '..')) return result;
  let handle: fs.FileHandle | undefined;
  try {
    const root = await fs.realpath(input.root), file = await fs.realpath(path.resolve(root, input.key));
    const tenantRoot = path.resolve(root, input.prefix);
    if (!file.startsWith(`${tenantRoot}${path.sep}`)) return { ...result, note: '原文件路径超出授权企业根目录，未读取。' };
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > 110 * 1024 * 1024) return { ...result, note: '原文件类型或大小超出核验范围，未计算指纹。' };
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { size += chunk.length; if (size > 110 * 1024 * 1024) throw new Error('size limit'); hash.update(chunk); }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || size !== before.size) return { ...result, note: '原文件在读取期间发生变化，不能认定核验通过。' };
    result.actualSha256 = hash.digest('hex'); result.actualSize = size;
    if (result.expectedSha256 && result.expectedSha256 !== result.actualSha256 || result.expectedSize !== null && result.expectedSize !== size) return { ...result, state: 'mismatch', note: '原始字节指纹或大小与持久化版本不一致；禁止关联广告报告。' };
    return { ...result, state: result.expectedSha256 ? 'verified' : 'fingerprinted', note: result.expectedSha256 ? '原始文件 SHA-256 与持久化版本一致；此结论不是投放/审批通过。' : '已计算当前原文件 SHA-256，但缺少历史冻结指纹；不能认定历史版本一致或已投放。' };
  } catch (error) { return { ...result, state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable', note: (error as NodeJS.ErrnoException).code === 'ENOENT' ? '原企业记录所指文件不存在；不改用其他目录、其他企业或沙盒素材。' : '原文件暂不可读，指纹核验未知；不视为零投放。' }; }
  finally { await handle?.close(); }
}

export async function readHistoryImageMaterials(roots: HistoryFileRoots, tenantId: string, outputs: unknown[]): Promise<AdSourceFileEvidence[]> {
  if (!roots.materialsFile) return [{ id: 'image-outputs', state: 'unavailable', expectedSha256: null, actualSha256: null, expectedSize: null, actualSize: null, note: '图片原企业素材目录未配置，不能从输出 URL 推断文件。' }];
  try {
    const handle = await fs.open(roots.materialsFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    let rows: unknown;
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error('invalid material file'); rows = JSON.parse(await handle.readFile('utf8')); }
    finally { await handle.close(); }
    if (!Array.isArray(rows)) throw new Error('invalid material collection');
    const results: AdSourceFileEvidence[] = [];
    for (const raw of outputs) {
      const output = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const id = typeof output.id === 'string' ? output.id : 'unknown-output';
      const matches = rows.filter(r => r.tenantId === tenantId && typeof output.materialId === 'string' && r.id === output.materialId);
      if (matches.length !== 1) { results.push({ id, state: 'unavailable', expectedSha256: null, actualSha256: null, expectedSize: null, actualSize: null, note: '输出未唯一对应原企业素材记录，不按名称、URL 或其他企业素材猜测。' }); continue; }
      const r = matches[0], objectKey = typeof r.objectKey === 'string' ? r.objectKey : '';
      const key = objectKey || (typeof r.file === 'string' ? r.file : '');
      results.push(await fingerprintHistoryFile({ id, root: objectKey ? roots.objectRoot : roots.mediaRoot, key,
        prefix: objectKey ? `materials/tenants/${Buffer.from(tenantId).toString('base64url')}/` : `tenants/${tenantId}/`, sha256: r.contentSha256, size: r.sizeBytes }));
    }
    return results;
  } catch { return [{ id: 'image-outputs', state: 'unavailable', expectedSha256: null, actualSha256: null, expectedSize: null, actualSize: null, note: '图片原企业素材目录不可读或结构异常；不视为无素材。' }]; }
}
