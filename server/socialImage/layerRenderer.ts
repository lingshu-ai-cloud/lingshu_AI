import sharp from 'sharp';
import type { SocialImageLayer, SocialImageLayerGraph } from '../../shared/contracts/socialImageLayerGraph.js';
import { assertSocialImageLayerGraph } from './layerGraphValidation.js';

const escapeXml = (value: string) => value.replace(/[<>&"']/g, character => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
}[character]!));

function pixelRect(layer: SocialImageLayer, graph: SocialImageLayerGraph) {
  return {
    left: Math.round(layer.rect.x * graph.canvas.width),
    top: Math.round(layer.rect.y * graph.canvas.height),
    width: Math.max(1, Math.round(layer.rect.width * graph.canvas.width)),
    height: Math.max(1, Math.round(layer.rect.height * graph.canvas.height)),
  };
}

function wrapText(content: string, maxCharacters: number, maxLines: number): string[] {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) return [];
  const tokens = /[\u3400-\u9fff]/.test(compact) ? [...compact] : compact.split(' ');
  const joiner = /[\u3400-\u9fff]/.test(compact) ? '' : ' ';
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    const next = line ? `${line}${joiner}${token}` : token;
    if (next.length <= maxCharacters || !line) line = next;
    else { lines.push(line); line = token; }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(joiner).length;
  if (consumed < compact.length && lines.length) lines[lines.length - 1] = `${lines.at(-1)!.replace(/[.…]+$/, '')}…`;
  return lines;
}

function textLayerSvg(layer: SocialImageLayer, width: number, height: number): Buffer {
  const isHeadline = layer.styleToken === 'luxury-serif-display';
  const isCta = layer.kind === 'cta';
  const fontSize = Math.max(18, Math.round(height * (isHeadline ? .31 : isCta ? .38 : .20)));
  const lineHeight = Math.round(fontSize * 1.18);
  const maxLines = Math.max(1, Math.floor((height - 18) / lineHeight));
  const maxCharacters = Math.max(4, Math.floor(width / (fontSize * (/[㐀-鿿]/.test(layer.content || '') ? .95 : .58))));
  const lines = wrapText(layer.content || '', maxCharacters, maxLines);
  const family = isHeadline ? 'Georgia, Times New Roman, serif' : 'Arial, PingFang SC, sans-serif';
  const fill = isHeadline || isCta ? '#f5d58a' : '#f7f1e3';
  const tspans = lines.map((line, index) => `<tspan x="${isCta ? width / 2 : 4}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join('');
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${isCta ? `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${Math.round(height / 2)}" fill="rgba(8,8,8,.62)" stroke="#cba85c" stroke-width="2"/>` : ''}
    <text x="${isCta ? width / 2 : 4}" y="${Math.max(fontSize, Math.round((height - Math.max(1, lines.length) * lineHeight) / 2 + fontSize))}" text-anchor="${isCta ? 'middle' : 'start'}" font-family="${family}" font-size="${fontSize}" font-weight="${isHeadline ? 700 : 500}" fill="${fill}">${tspans}</text>
  </svg>`);
}

export async function connectedBorderToAlpha(input: Buffer): Promise<Buffer> {
  const image = sharp(input).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const cornerIndexes = [0, width - 1, (height - 1) * width, height * width - 1];
  const background = [0, 1, 2].map(channel => Math.round(cornerIndexes.reduce((sum, index) => sum + data[index * channels + channel]!, 0) / cornerIndexes.length));
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0; let tail = 0;
  const nearBackground = (index: number) => {
    const offset = index * channels;
    const distance = Math.sqrt([0, 1, 2].reduce((sum, channel) => sum + (data[offset + channel]! - background[channel]!) ** 2, 0));
    return distance < 52;
  };
  const seed = (index: number) => { if (!visited[index] && nearBackground(index)) { visited[index] = 1; queue[tail++] = index; } };
  for (let x = 0; x < width; x += 1) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { seed(y * width); seed(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width; const y = Math.floor(index / width);
    for (const next of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]) {
      if (next >= 0 && !visited[next] && nearBackground(next)) { visited[next] = 1; queue[tail++] = next; }
    }
  }
  for (let index = 0; index < visited.length; index += 1) if (visited[index]) data[index * channels + 3] = 0;
  return sharp(data, { raw: info }).png().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
}

function fullCanvasSvg(graph: SocialImageLayerGraph): Buffer {
  const { width, height } = graph.canvas;
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#050505"/><stop offset=".48" stop-color="#241508"/><stop offset="1" stop-color="#050403"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="#e8bf63" stop-opacity=".7"/><stop offset="1" stop-color="#9a5d16" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <ellipse cx="78%" cy="32%" rx="42%" ry="38%" fill="url(#glow)" opacity=".75"/>
    <path d="M0 ${height * .78} C ${width * .25} ${height * .69}, ${width * .65} ${height * .9}, ${width} ${height * .75} L ${width} ${height} L0 ${height}Z" fill="#b9812d" opacity=".18"/>
  </svg>`);
}

function maskLayerSvg(layer: SocialImageLayer, width: number, height: number): Buffer {
  const mask = layer.mask;
  if (!mask) return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="32" fill="#070707" fill-opacity="${layer.opacity ?? .72}" stroke="#d3aa59" stroke-opacity=".34"/></svg>`);
  const color = mask.color || '#070707';
  const opacity = layer.opacity ?? .72;
  const blur = Math.round(Math.max(0, Math.min(1, mask.feather || 0)) * Math.min(width, height) * .08);
  const filter = blur ? `<filter id="soft"><feGaussianBlur stdDeviation="${blur}"/></filter>` : '';
  const filterRef = blur ? ' filter="url(#soft)"' : '';
  let shape = '';
  if (mask.shape === 'ellipse') shape = `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${color}" fill-opacity="${opacity}"${filterRef}/>`;
  else if (mask.shape === 'polygon' && mask.points?.length) {
    const points = mask.points.map(point => `${Math.round(((point.x - layer.rect.x) / layer.rect.width) * width)},${Math.round(((point.y - layer.rect.y) / layer.rect.height) * height)}`).join(' ');
    shape = `<polygon points="${points}" fill="${color}" fill-opacity="${opacity}"${filterRef}/>`;
  } else if (mask.shape === 'linear_gradient') {
    const radians = ((mask.angle || 0) * Math.PI) / 180;
    const x = Math.cos(radians), y = Math.sin(radians);
    const x1 = 50 - x * 50, y1 = 50 - y * 50, x2 = 50 + x * 50, y2 = 50 + y * 50;
    shape = `<defs><linearGradient id="mask-gradient" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%"><stop stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#mask-gradient)"${filterRef}/>`;
  } else {
    const radius = mask.shape === 'rounded_rectangle' ? Math.round(Math.min(width, height) * Math.max(0, Math.min(1, mask.cornerRadius ?? .12))) : 0;
    shape = `<rect width="100%" height="100%" rx="${radius}" fill="${color}" fill-opacity="${opacity}"${filterRef}/>`;
  }
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${filter}${shape}</svg>`);
}

export async function renderSocialImageLayerGraph(input: {
  graph: SocialImageLayerGraph;
  assets: Map<string, Buffer>;
}): Promise<{ bytes: Buffer; mimeType: 'image/png' }> {
  assertSocialImageLayerGraph(input.graph);
  const graph = input.graph;
  const canvas = sharp({ create: { width: graph.canvas.width, height: graph.canvas.height, channels: 4, background: '#050505' } });
  const composites: Array<{ input: Buffer; left: number; top: number }> = [{ input: fullCanvasSvg(graph), left: 0, top: 0 }];
  for (const layer of [...graph.layers].sort((a, b) => a.zIndex - b.zIndex)) {
    if (layer.kind === 'background' || layer.kind === 'decoration') continue;
    const rect = pixelRect(layer, graph);
    if (layer.kind === 'overlay') {
      const overlay = maskLayerSvg(layer, rect.width, rect.height);
      composites.push({ input: overlay, left: rect.left, top: rect.top });
    } else if (layer.kind === 'text' || layer.kind === 'cta') {
      composites.push({ input: textLayerSvg(layer, rect.width, rect.height), left: rect.left, top: rect.top });
    } else if (layer.kind === 'product' || layer.kind === 'logo') {
      const source = layer.sourceAssetId ? input.assets.get(layer.sourceAssetId) : undefined;
      if (!source) throw new Error(`缺少图层企业资产：${layer.id}`);
      const transparent = layer.kind === 'product' ? await connectedBorderToAlpha(source) : source;
      const fitted = await sharp(transparent).resize(rect.width, rect.height, { fit: layer.fit || 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      composites.push({ input: fitted, left: rect.left, top: rect.top });
    }
  }
  return { bytes: await canvas.composite(composites).png({ compressionLevel: 9 }).toBuffer(), mimeType: 'image/png' };
}
