import { Router } from 'express';
import { localProductOcrReadiness, recognizeProductImageLocally } from '../lib/localProductOcr.js';

export const productDocumentOcrRouter = Router();

productDocumentOcrRouter.get('/readiness', async (_req, res) => res.json(await localProductOcrReadiness()));
productDocumentOcrRouter.post('/', async (req, res) => {
  const mimeType = String(req.body?.mimeType || '');
  const encoded = String(req.body?.dataBase64 || '');
  if (!encoded || encoded.length > 8_400_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) {
    res.status(413).json({ ok: false, code: 'OCR_IMAGE_SIZE_LIMIT', error: 'OCR 页面图片过大或编码无效' }); return;
  }
  try {
    const text = await recognizeProductImageLocally({ bytes: Buffer.from(encoded, 'base64'), mimeType });
    res.json({ ok: true, text, source: 'local_tesseract', needsReview: true });
  } catch (error) {
    const code = String((error as { code?: string })?.code || (error as Error)?.message || 'LOCAL_OCR_FAILED');
    res.status(code.startsWith('local_ocr_') ? 423 : code.includes('LIMIT') ? 413 : 422)
      .json({ ok: false, code, error: code === 'local_ocr_unavailable' || code === 'local_ocr_languages_missing'
        ? '本地 OCR 未就绪：需要安装 Tesseract OCR，并包含 chi_sim、eng 语言包' : '扫描页 OCR 失败，请检查页面清晰度或拆分文档' });
  }
});
