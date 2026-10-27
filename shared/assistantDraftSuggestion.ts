import { readableAssistantReply } from './assistantReadableReply.js';

export type AssistantDraftSuggestion = { label: string; draft: string };

function quotedProduct(context: string, hint: string): string {
  const candidates = [...context.matchAll(/[“「"]([^”」"\n]{2,48})[”」"]/gu)].map(match => match[1].trim());
  const keyword = hint.replace(/SKU|信息|补录|模板|产品/giu, '').trim();
  return candidates.find(value => keyword && value.includes(keyword)) || '';
}

function productInformationTemplate(product: string): AssistantDraftSuggestion {
  const target = product || '该产品';
  return {
    label: `补录${target}信息`,
    draft: `请帮我核对并补录以下产品信息；空白项保持待确认，不要自行补编：\n\n产品名称：${product}\n英文名称：\n规格 / 色号：\n类目：\n价格与币种：\n起订量：\n核心卖点（最多 3 条）：\n成分或材质依据：\n资质与适用市场：\n禁用表述：\n主视觉图或资料附件：\n其他说明：`,
  };
}

function productAssetTemplate(): AssistantDraftSuggestion {
  return {
    label: '补充产品实拍素材',
    draft: '请根据以下信息检查素材是否足以继续内容制作；没有填写或没有附件的部分请明确标为待补，不要自动启动制作：\n\n产品名称：\n素材用途：\n已添加附件：请在输入框下方添加产品实拍视频或高清图片\n画面内容：\n授权范围：\n补充说明：',
  };
}

/** Convert model follow-ups into editable composer drafts; never grants execution authority. */
export function assistantDraftSuggestion(raw: string, context = ''): AssistantDraftSuggestion {
  const cleaned = readableAssistantReply(raw).replace(/^\s*(?:[-*•·]|\d+[.、)])\s*/u, '').trim();
  if (/上传|补充/u.test(cleaned) && /实拍|素材|图片|视频/u.test(cleaned)) return productAssetTemplate();
  if (/英文版/u.test(cleaned) && /补录模板/u.test(cleaned)) {
    return { label: '生成英文版产品补录模板', draft: '请根据已确认的中文产品字段生成英文版产品信息补录模板；未确认项保持空白并标为待确认，不要翻译或补编不存在的价格、成分、资质和功效。' };
  }
  if (/补录模板|补录.*(?:信息|资料)|完善.*(?:信息|资料)/u.test(cleaned)) {
    const hint = cleaned.match(/(?:起草|补录|完善)(.+?)(?:的信息|信息|资料|补录模板)/u)?.[1]?.replace(/SKU/giu, '').trim() || '';
    return productInformationTemplate(quotedProduct(context, hint) || hint);
  }
  const label = cleaned
    .replace(/^(?:确认)?是否(?:需要我)?(?:立即)?/u, '')
    .replace(/是否存在/gu, '有无')
    .replace(/[？?。]+$/u, '')
    .trim() || '继续处理';
  const draft = /^(?:请|帮我|查看|生成|检查|分析|补充|修改|确认|打开|继续)/u.test(label) ? label : `请${label}`;
  return { label, draft };
}
