import fs from 'node:fs';
import { createHash } from 'node:crypto';

export async function sha256File(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const raw of fs.createReadStream(filePath)) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    sizeBytes += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}

export async function fileMatchesSha256(filePath: string, expectedSha256: string, expectedSize?: number): Promise<boolean> {
  if (!fs.existsSync(filePath)) return false;
  const actual = await sha256File(filePath);
  return actual.sha256 === expectedSha256 && (!Number.isFinite(expectedSize) || actual.sizeBytes === expectedSize);
}
