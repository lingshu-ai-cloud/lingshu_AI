
import type { ModeCard, StudioScriptGenerationValidation } from './studioWorkspaceContracts.js';

export function validateStudioScriptGenerationInput(input: {
  mode: ModeCard['id'];
  language: string;
  productInfo: string;
  productLabel: string;
  selectedMaterialCount: number;
  hasReferenceAnalysis: boolean;
  duration: number;
}): StudioScriptGenerationValidation {
  if (!input.language.trim()) return { ok: false, code: 'language_required', message: '企业中心尚未配置首选输出语言或主要业务语言，请先完成语言配置。' };
  if (!Number.isFinite(input.duration) || input.duration <= 0) return { ok: false, code: 'duration_invalid', message: '请先设置大于 0 秒的成片时长。' };
  if (!input.productInfo.trim() || !input.productLabel.trim()) return { ok: false, code: 'product_required', message: '请先在第一步选择企业中心产品，再生成脚本。' };
  if (input.mode === 'material' && input.selectedMaterialCount <= 0) return { ok: false, code: 'material_required', message: '请先明确选择本次要使用的真实视频或图片，脚本才会按画面生成。' };
  if (input.mode === 'clone' && !input.hasReferenceAnalysis) return { ok: false, code: 'reference_required', message: '当前草稿缺少真实对标逐镜分析，请返回灵感中心完成全片分析后再生成。' };
  return { ok: true };
}

export function studioAgentSourceLabel(source?: string): string {
  const normalized = String(source || '').trim();
  if (normalized === 'inspiration_analysis') return '灵感中心 · 爆款视频分析';
  if (normalized === 'inspiration_image_post') return '灵感中心 · 爆款图文分析';
  if (normalized === 'material_library' || normalized === 'material_segment_analysis') return '素材库';
  if (normalized === 'seedance_video') return 'AI 视频创作';
  if (normalized === 'agent_memory' || normalized === 'content_memory_recommendation') return '智能推荐 · 内容策略';
  return '手动创建';
}
