import { socialImageRectOverlapRatio, type SocialImageLayerGraph, type SocialImageNormalizedRect } from '../../shared/contracts/socialImageLayerGraph.js';

const rectValid = (rect: SocialImageNormalizedRect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
  && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
  && rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001;

export function socialImageLayerGraphIssues(graph: SocialImageLayerGraph): string[] {
  const issues: string[] = [];
  if (graph.schemaVersion !== 'social-image-layer-graph.v1') issues.push('图层图版本无效');
  if (!Number.isInteger(graph.canvas.width) || !Number.isInteger(graph.canvas.height) || graph.canvas.width < 320 || graph.canvas.height < 320) issues.push('画布尺寸无效');
  if (!graph.templateId.trim()) issues.push('缺少模板标识');
  if (!graph.layers.length) issues.push('图层为空');
  const ids = new Set<string>();
  for (const layer of graph.layers) {
    if (!layer.id.trim() || ids.has(layer.id)) issues.push(`图层标识重复或为空：${layer.id || '(empty)'}`);
    ids.add(layer.id);
    if (!rectValid(layer.rect)) issues.push(`图层区域无效：${layer.id}`);
    if ((layer.kind === 'product' || layer.kind === 'logo') && !layer.sourceAssetId) issues.push(`${layer.kind} 图层缺少企业资产：${layer.id}`);
    if ((layer.kind === 'text' || layer.kind === 'cta') && !String(layer.content || '').trim()) issues.push(`文字图层内容为空：${layer.id}`);
    if (layer.opacity !== undefined && (layer.opacity < 0 || layer.opacity > 1)) issues.push(`图层透明度无效：${layer.id}`);
    if (layer.mask) {
      if (layer.kind !== 'overlay') issues.push(`非覆盖图层不能携带蒙版：${layer.id}`);
      if (layer.mask.color && !/^#[0-9a-f]{6}$/i.test(layer.mask.color)) issues.push(`蒙版颜色无效：${layer.id}`);
      if (layer.mask.points?.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) issues.push(`蒙版坐标无效：${layer.id}`);
      if (layer.mask.feather !== undefined && (!Number.isFinite(layer.mask.feather) || layer.mask.feather < 0 || layer.mask.feather > 1)) issues.push(`蒙版羽化无效：${layer.id}`);
      if (layer.mask.cornerRadius !== undefined && (!Number.isFinite(layer.mask.cornerRadius) || layer.mask.cornerRadius < 0 || layer.mask.cornerRadius > 1)) issues.push(`蒙版圆角无效：${layer.id}`);
      if (layer.mask.angle !== undefined && (!Number.isFinite(layer.mask.angle) || Math.abs(layer.mask.angle) > 360)) issues.push(`蒙版角度无效：${layer.id}`);
    }
  }
  const products = graph.layers.filter(layer => layer.kind === 'product');
  const foreground = graph.layers.filter(layer => ['overlay', 'text', 'cta', 'logo', 'badge'].includes(layer.kind));
  for (const product of products) {
    for (const layer of foreground) {
      if (layer.zIndex <= product.zIndex) continue;
      const overlap = socialImageRectOverlapRatio(product.rect, layer.rect);
      if (overlap > 0.12) issues.push(`前景图层 ${layer.id} 与产品 ${product.id} 重叠 ${(overlap * 100).toFixed(1)}%，超过 12%`);
    }
  }
  return [...new Set(issues)];
}

export function assertSocialImageLayerGraph(graph: SocialImageLayerGraph): void {
  const issues = socialImageLayerGraphIssues(graph);
  if (issues.length) throw new Error(issues.join('；'));
}
