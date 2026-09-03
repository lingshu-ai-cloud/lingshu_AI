import fs from 'node:fs';
import path from 'node:path';

export type RenderOutputResolution =
  | { ok: true; filePath: string }
  | { ok: false; reason: 'missing' | 'forbidden' };

export function resolveTenantRenderOutput(outputDirectory: string, requestedPath: string): RenderOutputResolution {
  const outputDir = path.resolve(outputDirectory);
  const filePath = path.resolve(requestedPath);
  if (path.dirname(filePath) !== outputDir) return { ok: false, reason: 'forbidden' };

  const rootStat = fs.lstatSync(outputDir, { throwIfNoEntry: false });
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) return { ok: false, reason: 'missing' };
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!stat) return { ok: false, reason: 'missing' };
  if (stat.isSymbolicLink() || !stat.isFile() || path.extname(filePath).toLowerCase() !== '.mp4') {
    return { ok: false, reason: 'forbidden' };
  }
  const outputRoot = fs.realpathSync(outputDir);
  const realFilePath = fs.realpathSync(filePath);
  if (path.dirname(realFilePath) !== outputRoot) return { ok: false, reason: 'forbidden' };
  return { ok: true, filePath: realFilePath };
}
