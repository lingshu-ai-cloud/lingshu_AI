type ImageBytes = { bytes: Buffer; mimeType: string };

/** Resolve only already stored, tenant-owned image-post pixels. No collection or remote URL fetch. */
export async function readStoredImagePostReference(tenantId: string, route: string, ports: {
  readRecord: (id: string) => Promise<Record<string, unknown> | null>;
  download: (key: string) => Promise<ImageBytes | null>;
  readFile: (id: string, filename: string) => Promise<ImageBytes | null>;
}): Promise<ImageBytes | null> {
  const match = route.match(/^\/api\/overseas\/videos\/([a-zA-Z0-9_-]+)\/(?:thumbnail|image\/(\d+))$/);
  if (!match) return null;
  const record = await ports.readRecord(match[1]!);
  if (!record || String(record.tenantId || record.tenant_id || '') !== tenantId) return null;
  let analysis: Record<string, unknown>;
  try { analysis = typeof record.aiAnalysis === 'string' ? JSON.parse(record.aiAnalysis) : record.aiAnalysis as Record<string, unknown>; }
  catch { return null; }
  if (!analysis || analysis.contentFormat !== 'image') return null;
  const isThumbnail = match[2] === undefined;
  const index = isThumbnail ? 0 : Number(match[2]);
  const keys = Array.isArray(analysis.imageObjectKeys) ? analysis.imageObjectKeys : [];
  if (!Number.isSafeInteger(index) || index < 0 || index >= 10) return null;
  const key = isThumbnail ? analysis.thumbnailObjectKey || keys[0] : keys[index];
  if (typeof key === 'string' && key.trim()) {
    const stored = await ports.download(key).catch(() => null);
    if (stored?.bytes.length && stored.mimeType.startsWith('image/')) return stored;
  }
  if (isThumbnail && typeof record.thumbnailFile === 'string' && record.thumbnailFile) {
    const stored = await ports.readFile(match[1]!, record.thumbnailFile);
    if (stored?.bytes.length && stored.mimeType.startsWith('image/')) return stored;
  }
  return null;
}
