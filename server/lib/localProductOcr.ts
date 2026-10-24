import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { createWorker, OEM, PSM } from 'tesseract.js';

export const LOCAL_PRODUCT_OCR_LIMITS = { maxEncodedBytes: 6 * 1024 * 1024, maxPixels: 12_000_000, maxOutputChars: 80_000, timeoutMs: 45_000 } as const;
type LanguagePackage = { code: string; gzip: boolean; langPath: string };
const require = createRequire(import.meta.url);

function languagePackages(): LanguagePackage[] {
  return [require('@tesseract.js-data/chi_sim'), require('@tesseract.js-data/eng')] as LanguagePackage[];
}

function localLanguageDirectory(): string {
  const target = path.join(os.tmpdir(), 'lingshu-tesseract-data-v1');
  fs.mkdirSync(target, { recursive: true });
  for (const language of languagePackages()) {
    const source = path.join(language.langPath, `${language.code}.traineddata.gz`);
    const destination = path.join(target, `${language.code}.traineddata.gz`);
    if (!fs.existsSync(source)) throw new Error(`missing local OCR language:${language.code}`);
    if (!fs.existsSync(destination) || fs.statSync(destination).size !== fs.statSync(source).size) fs.copyFileSync(source, destination);
  }
  return target;
}

export function localProductOcrReadiness() {
  try {
    const packages = languagePackages();
    const missing = packages.filter(item => !fs.existsSync(path.join(item.langPath, `${item.code}.traineddata.gz`))).map(item => item.code);
    if (missing.length) return { ready: false as const, code: 'local_ocr_languages_missing', detail: `missing:${missing.join(',')}`, languages: packages.map(item => item.code) };
    localLanguageDirectory();
    return { ready: true as const, code: 'local_ocr_ready', detail: 'bundled tesseract.js languages:chi_sim,eng', languages: packages.map(item => item.code) };
  } catch {
    return { ready: false as const, code: 'local_ocr_bundle_unavailable', detail: 'bundled tesseract.js or local language data is missing', languages: [] as string[] };
  }
}

type LocalOcrWord = { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } };

type LocalOcrWorker = Awaited<ReturnType<typeof createWorker>>;
async function createLocalOcrWorker(): Promise<LocalOcrWorker> {
  const worker = await createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, { langPath: localLanguageDirectory(), gzip: true, cacheMethod: 'none' });
  try { await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK }); return worker; }
  catch (error) { await worker.terminate(); throw error; }
}
async function recognizeDataWithWorker(worker: LocalOcrWorker, bytes: Buffer): Promise<{ text?: string; words?: LocalOcrWord[]; blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: LocalOcrWord[] }> }> }> }> {
  let timeout: NodeJS.Timeout | undefined;
  const result = await Promise.race([worker.recognize(bytes), new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('LOCAL_OCR_TIMEOUT')), LOCAL_PRODUCT_OCR_LIMITS.timeoutMs);
  })]).finally(() => { if (timeout) clearTimeout(timeout); });
  return result.data as unknown as { text?: string; words?: LocalOcrWord[]; blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: LocalOcrWord[] }> }> }> };
}
async function recognizeDataWithBundledTesseract(bytes: Buffer) {
  const worker = await createLocalOcrWorker();
  try { return await recognizeDataWithWorker(worker, bytes); }
  finally { await worker.terminate(); }
}

async function normalizedOcrInput(input: { bytes: Buffer; mimeType: string }) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.mimeType)) throw new Error('OCR_IMAGE_TYPE_UNSUPPORTED');
  if (!input.bytes.length || input.bytes.length > LOCAL_PRODUCT_OCR_LIMITS.maxEncodedBytes) throw new Error('OCR_IMAGE_SIZE_LIMIT');
  const metadata = await sharp(input.bytes, { limitInputPixels: LOCAL_PRODUCT_OCR_LIMITS.maxPixels }).metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > LOCAL_PRODUCT_OCR_LIMITS.maxPixels) throw new Error('OCR_IMAGE_PIXEL_LIMIT');
  const readiness = localProductOcrReadiness();
  if (!readiness.ready) throw Object.assign(new Error(readiness.detail), { code: readiness.code });
  const normalized = await sharp(input.bytes, { limitInputPixels: LOCAL_PRODUCT_OCR_LIMITS.maxPixels }).rotate()
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).grayscale().normalize().png().toBuffer();
  const normalizedMetadata = await sharp(normalized).metadata();
  return { normalized, width: normalizedMetadata.width || 1, height: normalizedMetadata.height || 1 };
}

export async function recognizeProductImageLocally(input: { bytes: Buffer; mimeType: string }, options: { recognize?: (bytes: Buffer) => Promise<string> } = {}) {
  const { normalized } = await normalizedOcrInput(input);
  const text = options.recognize ? await options.recognize(normalized)
    : String((await recognizeDataWithBundledTesseract(normalized)).text || '');
  return text.replace(/\u0000/g, '').slice(0, LOCAL_PRODUCT_OCR_LIMITS.maxOutputChars).trim();
}

/** A single audit may inspect every decoded frame without restarting Tesseract
 * for each image. The caller owns this worker and must close it in finally. */
export async function createLocalProductOcrSession() {
  const worker = await createLocalOcrWorker();
  let closed = false;
  return {
    async recognize(input: { bytes: Buffer; mimeType: string }): Promise<string> {
      if (closed) throw new Error('LOCAL_OCR_SESSION_CLOSED');
      const { normalized } = await normalizedOcrInput(input);
      const text = String((await recognizeDataWithWorker(worker, normalized)).text || '');
      return text.replace(/\u0000/g, '').slice(0, LOCAL_PRODUCT_OCR_LIMITS.maxOutputChars).trim();
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await worker.terminate();
    },
  };
}

export async function recognizeProductImageTokensLocally(input: { bytes: Buffer; mimeType: string }) {
  const { normalized, width, height } = await normalizedOcrInput(input);
  const data = await recognizeDataWithBundledTesseract(normalized);
  const words = data.words || (data.blocks || []).flatMap(block => (block.paragraphs || [])
    .flatMap(paragraph => (paragraph.lines || []).flatMap(line => line.words || [])));
  return words.flatMap(word => {
    const box = word.bbox, text = String(word.text || '').replace(/\u0000/g, '').trim();
    if (!box || !text) return [];
    const x = Math.max(0, Math.min(1, box.x0 / width)), y = Math.max(0, Math.min(1, box.y0 / height));
    const right = Math.max(x, Math.min(1, box.x1 / width)), bottom = Math.max(y, Math.min(1, box.y1 / height));
    if (right <= x || bottom <= y) return [];
    return [{ text: text.slice(0, 500), bbox: { x, y, width: right - x, height: bottom - y },
      confidence: Math.max(0, Math.min(1, Number(word.confidence || 0) / 100)) }];
  }).slice(0, 80);
}
