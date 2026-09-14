/** Optional paid-test guard. Real upstream responses are never replaced. */
import fs from 'node:fs';
import path from 'node:path';
export function installAcceptanceBudget(root: string) {
  if (!/^\/(?:private\/)?tmp\/lingshu-e2e-[\w-]+$/.test(fs.realpathSync(root))) throw new Error('Isolated test directory required');
  const file = path.join(root, 'data/acceptance-gemini-usage.json');
  const ledger: any[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const qfile = path.join(root, 'data/acceptance-qwen-usage.json');
  const qledger: any[] = fs.existsSync(qfile) ? JSON.parse(fs.readFileSync(qfile, 'utf8')) : [];
  const tfile = path.join(root, 'data/acceptance-tts-usage.json');
  const tledger: any[] = fs.existsSync(tfile) ? JSON.parse(fs.readFileSync(tfile, 'utf8')) : [];
  const hfile = path.join(root, 'data/acceptance-heygen-usage.json');
  const hledger: any[] = fs.existsSync(hfile) ? JSON.parse(fs.readFileSync(hfile, 'utf8')) : [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === 'api.heygen.com' && url.pathname === '/v3/videos' && request.method === 'POST') {
      const body = await request.clone().json();
      // Reserve 2 yuan per short clip, in addition to previous-session spend.
      if (hledger.length >= 2 || String(body.script || '').length > 15 || body.resolution !== '720p') throw new Error('本轮数字人生成超出保守预算边界');
      const entry: any = { at: new Date().toISOString(), status: 'reserved', reservationCny: 2, audioDriven: Boolean(body.audio_asset_id) };
      hledger.push(entry); fs.writeFileSync(hfile, JSON.stringify(hledger, null, 2));
      try {
        const response = await original(request); const result = await response.clone().json();
        entry.httpStatus = response.status; entry.videoId = result.data?.id || result.data?.video_id; entry.status = response.ok ? 'submitted' : 'failed';
        fs.writeFileSync(hfile, JSON.stringify(hledger, null, 2)); return response;
      } catch (error) { entry.status = 'uncertain'; fs.writeFileSync(hfile, JSON.stringify(hledger, null, 2)); throw error; }
    }
    if (url.hostname === 'dashscope.aliyuncs.com' && url.pathname.endsWith('/multimodal-generation/generation')) {
      const body = await request.clone().json();
      const chars = String(body.input?.text || '').length;
      if (body.model !== 'qwen3-tts-flash' || chars > 500 || tledger.length >= 10) throw new Error('本轮配音超出预算边界');
      const entry: any = { at: new Date().toISOString(), model: body.model, chars, reservationCny: 0.04, status: 'reserved' };
      tledger.push(entry); fs.writeFileSync(tfile, JSON.stringify(tledger, null, 2));
      try {
        const response = await original(request);
        const result = await response.clone().json();
        entry.httpStatus = response.status; entry.usage = result.usage || null; entry.status = response.ok ? 'completed' : 'failed';
        fs.writeFileSync(tfile, JSON.stringify(tledger, null, 2)); return response;
      } catch (error) { entry.status = 'uncertain'; fs.writeFileSync(tfile, JSON.stringify(tledger, null, 2)); throw error; }
    }
    if (url.hostname === 'dashscope.aliyuncs.com' && url.pathname.endsWith('/chat/completions')) {
      const body = await request.clone().json();
      if (qledger.length >= 8 || body.model !== 'qwen-plus' || body.stream || JSON.stringify(body).length > 100000) throw new Error('本轮千问请求超出预算边界');
      body.enable_thinking = false;
      body.max_tokens = Math.min(body.max_tokens || 4096, 4096);
      const entry: any = { at: new Date().toISOString(), model: body.model, status: 'reserved', reservationCny: 0.1 };
      qledger.push(entry); fs.writeFileSync(qfile, JSON.stringify(qledger, null, 2));
      try {
        const response = await original(new Request(request, { body: JSON.stringify(body) }));
        const result = await response.clone().json();
        entry.httpStatus = response.status; entry.usage = result.usage || null;
        entry.output = result.choices?.[0]?.message?.content || '';
        entry.status = response.ok ? 'completed' : 'failed';
        fs.writeFileSync(qfile, JSON.stringify(qledger, null, 2)); return response;
      } catch (error) { entry.status = 'uncertain'; fs.writeFileSync(qfile, JSON.stringify(qledger, null, 2)); throw error; }
    }
    if (url.hostname !== 'generativelanguage.googleapis.com' || !url.pathname.includes(':generateContent')) return original(request);
    if (ledger.length >= 6) throw new Error('本轮Gemini调用次数预算已用完，请先核对账本');
    const body = await request.clone().json();
    if (!/\/models\/gemini-2\.5-flash(?:-preview-tts)?:generateContent$/.test(url.pathname)) throw new Error('本轮未授权该模型');
    if (JSON.stringify(body).length > 5_000_000) throw new Error('本轮请求超过保守预算输入上限');
    body.generationConfig = { ...body.generationConfig, maxOutputTokens: 4096 };
    if (!url.pathname.includes('tts')) body.generationConfig.thinkingConfig = { thinkingBudget: 512 };
    const entry: any = { at: new Date().toISOString(), model: url.pathname.split('/models/')[1], status: 'reserved', reservationUsd: 0.075 };
    ledger.push(entry); fs.writeFileSync(file, JSON.stringify(ledger, null, 2));
    try {
      const response = await original(new Request(request, { body: JSON.stringify(body) }));
      const result = await response.clone().json();
      entry.httpStatus = response.status; entry.usage = result.usageMetadata || null; entry.status = response.ok ? 'completed' : 'failed';
      fs.writeFileSync(file, JSON.stringify(ledger, null, 2));
      return response;
    } catch (error) { entry.status = 'uncertain'; fs.writeFileSync(file, JSON.stringify(ledger, null, 2)); throw error; }
  };
}
