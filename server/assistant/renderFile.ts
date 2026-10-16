import fs from 'node:fs';
import { chromium } from 'playwright-core';

export type AssistantFileInput = { title: string; content: string; format: 'pdf' | 'jpg'; diagram?: boolean };
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function assistantFileHtml(input: AssistantFileInput) {
  const lines = input.content.replace(/^```(?:copy|text|markdown|md)?\s*$/gm, '').split('\n').map(line => line.trim()).filter(Boolean);
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('|') && line.endsWith('|')) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].startsWith('|') && lines[index].endsWith('|')) {
        const row = lines[index].slice(1, -1).split('|').map(cell => cell.trim().replace(/\*\*/g, ''));
        if (!row.every(cell => /^:?-{3,}:?$/.test(cell))) rows.push(row);
        index++;
      }
      index--;
      blocks.push(`<table>${rows.map((row, rowIndex) => `<tr>${row.map(cell => `<${rowIndex ? 'td' : 'th'} dir="auto">${escape(cell)}</${rowIndex ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`);
      continue;
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) blocks.push(`<h2>${escape(heading[1])}</h2>`);
    else blocks.push(`<p dir="auto">${escape(line.replace(/\*\*/g, ''))}</p>`);
  }
  const body = blocks.join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'"><style>
    @page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;color:#171717;background:white;font:16px/1.7 Arial,'PingFang SC','Noto Sans CJK SC',sans-serif;overflow-wrap:anywhere}
    h1{font-size:28px;line-height:1.4;margin:0 0 22px}h2{font-size:20px;line-height:1.5;margin:24px 0 12px;break-after:avoid}p{white-space:pre-wrap;margin:10px 0;orphans:3;widows:3}footer{font-size:12px;color:#52525b;margin-top:24px;border-top:1px solid #d4d4d8;padding-top:10px}
    .image{width:1120px;padding:48px}.diagram p{border:1px solid #d4d4d8;border-left:4px solid #2563eb;border-radius:8px;padding:16px 20px;margin:16px 0;break-inside:avoid}.diagram h2{color:#2563eb}
    .diagram h2:not(:first-of-type)::before{content:'↓';display:block;color:#71717a;margin:12px 0}
    table{border-collapse:collapse;width:100%;font-size:14px;margin:16px 0;table-layout:fixed}td,th{border:1px solid #d4d4d8;padding:9px;vertical-align:top;text-align:start}th{background:#f5f5f5}tr{break-inside:avoid}
  </style></head><body class="${input.format === 'jpg' ? 'image' : ''} ${input.diagram ? 'diagram' : ''}"><h1>${escape(input.title)}</h1>${body}<footer>灵枢 AI · 根据本次会话整理${input.diagram ? ' · 业务示意图，非地理导航地图' : ''} · 未核验的信息以正文标注为准</footer></body></html>`;
}

let rendering = 0;
export async function renderAssistantFile(input: AssistantFileInput): Promise<Buffer> {
  if (rendering >= 2) throw new Error('文件生成正在排队，请稍后重试。');
  rendering++;
  try {
    const executablePath = [process.env.AGENT_BROWSER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(file => file && fs.existsSync(file));
    if (!executablePath) throw new Error('文件渲染服务未配置，请联系管理员配置浏览器渲染器。');
    const browser = await chromium.launch({ executablePath, headless: true, timeout: 15_000, chromiumSandbox: true });
    const timer = setTimeout(() => { void browser.close(); }, 30_000);
    try {
      const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 1120, height: 900 }, deviceScaleFactor: 1.5 });
      await page.route('**/*', route => route.abort());
      await page.setContent(assistantFileHtml(input), { waitUntil: 'load', timeout: 10_000 });
      await page.evaluate(() => document.fonts.ready);
      if (input.format === 'pdf') return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      const height = await page.locator('body').evaluate(element => element.scrollHeight);
      if (height > 16000) throw new Error('图片内容过长，请缩小范围或改为PDF。');
      return await page.screenshot({ type: 'jpeg', quality: 92, fullPage: true });
    } finally { clearTimeout(timer); await browser.close(); }
  } finally { rendering--; }
}
