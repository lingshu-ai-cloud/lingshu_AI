import { parseWorkbook } from './productImport';
const MAX_TEXT = 80000;
export function validateProductDiscoveryFileSize(name: string, size: number): void {
  const limitMB = /\.pdf$/i.test(name) ? 50 : 10;
  if (size > limitMB * 1024 * 1024) throw new Error(`产品文件不能超过 ${limitMB}MB`);
}
export async function readProductDiscoveryFile(file: File): Promise<string> {
  validateProductDiscoveryFileSize(file.name, file.size);
  let text = '';
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 100) throw new Error('请上传不超过100页的产品资料');
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += `\n第${i}页\n` + content.items.map(item => 'str' in item ? item.str : '').join(' ');
        if (text.length > MAX_TEXT) throw new Error('资料文字过多，请按产品方向拆分后上传');
      }
    } finally { await task.destroy(); }
    if (text.replace(/第\d+页|\s/g, '').length < 20) throw new Error('此PDF没有可读取的文字，请上传文字版PDF、Excel或文本文件');
  } else if (/\.(xlsx?|csv)$/i.test(file.name)) {
    const sheets = await parseWorkbook(file);
    text = sheets.map(sheet => `工作表：${sheet.name}\n${sheet.rows.map(row => row.join(' | ')).join('\n')}`).join('\n');
  } else if (/\.txt$/i.test(file.name)) text = await file.text();
  else throw new Error('支持 PDF、Excel、CSV、TXT 产品资料');
  if (!text.trim()) throw new Error('文件中没有可读取的产品资料');
  if (text.length > MAX_TEXT) throw new Error('资料文字过多，请按产品方向拆分后上传');
  return text.replace(/\u0000/g, '');
}
