import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function socialLocalMediaHash(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}
/** Preserve the renderer's existing byte identity: temporary local media paths
 * become hashes, while other strings and all semantic fields stay unchanged. */
export async function stableSocialMediaInput(value: unknown): Promise<unknown> {
  if (typeof value === 'string' && path.isAbsolute(value) && existsSync(value)) {
    const stat = await fs.stat(value);
    if (stat.isFile()) return { mediaSha256: await socialLocalMediaHash(value) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(stableSocialMediaInput));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(
    Object.entries(value).map(async ([key, item]) => [key, await stableSocialMediaInput(item)] as const),
  ));
  return value;
}
