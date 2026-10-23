import { LayoutGrid, Film, FileText, Image as ImageIcon, Play, Sparkles } from 'lucide-react';
import { type TtsStyleOptions } from '../../lib/studioApi';
import { type Clip } from './studioSourceMaterial';
import { IMAGE_DELIVERABLE_LABELS, type ImageDeliverable } from '../../../shared/imageCreativePlanning';
import type { StepId, StudioStage, VideoTheme, MaterialFolder, Bgm, Voice, LanguageTtsSettings, SocialAccount, ModeCard } from './studioWorkspaceContracts.js';

export const STEPS: { id: StepId; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: 'mode',     label: '选模式',  icon: LayoutGrid, hint: '选择生成起点与全局参数' },
  { id: 'script',   label: '分镜与声音', icon: FileText, hint: '先确认可执行分镜，再选择口播、字幕与配音' },
  { id: 'material', label: '选素材',  icon: Film,       hint: '按脚本挑选并排序片段' },
  { id: 'cover',    label: '封面',     icon: ImageIcon,  hint: '生成封面候选并选定标题' },
  { id: 'preview',  label: '素材成片预览', icon: Play,       hint: '确认成片并进入发布' },
];

export const VIDEO_STAGES: StudioStage[] = [
  { id: 'setup', label: '设置', icon: LayoutGrid, hint: '模式与内容', steps: ['mode'] },
  { id: 'storyboard', label: '脚本与声音', icon: FileText, hint: '口播、翻译、配音、字幕与配乐', steps: ['script'] },
  { id: 'deliver', label: '成片制作', icon: Play, hint: '素材匹配、封面与合成', steps: ['material', 'cover', 'preview'] },
];

export const POSTER_STAGES: StudioStage[] = [
  { id: 'setup', label: '设置', icon: LayoutGrid, hint: '模式与内容', steps: ['mode'] },
  { id: 'storyboard', label: '制作', icon: ImageIcon, hint: '选择图文素材', steps: ['material'] },
  { id: 'deliver', label: '完成', icon: Sparkles, hint: '预览与发布', steps: ['poster'] },
];

export const DEFAULT_VIDEO_CONVERSION_GOAL = '引导通过 Messenger 联系';

export const VIDEO_THEMES: VideoTheme[] = [
  { id: 'buyer_pain', title: '买家痛点', description: '从采购顾虑或使用难题切入，再用产品证据回答。', painPoint: '买家难以快速判断产品是否适合自己的市场与采购需求', conversionGoal: '私信说明目标市场与需求', requires: ['product'] },
  { id: 'product_proof', title: '产品实证', description: '用规格、包装、细节和真实素材建立判断依据。', painPoint: '仅凭产品主图无法确认实物、规格和包装细节', conversionGoal: '索取完整产品资料', requires: ['product', 'material'] },
  { id: 'use_case', title: '使用场景', description: '围绕一个具体场景展示产品如何被使用或呈现。', painPoint: '买家看不出产品在真实场景中的使用方式', conversionGoal: '咨询适用方案', requires: ['material'] },
  { id: 'supplier_capability', title: '供应能力', description: '用工厂、质检、产能或交付证据降低供应风险。', painPoint: '买家担心批量供货、质量稳定性和交付可靠性', conversionGoal: '提交数量并确认供应方案', requires: ['factory'] },
  { id: 'customization', title: '定制能力', description: '展示已确认的包装、品牌或规格定制能力。', painPoint: '买家不确定产品能否适配自己的品牌和渠道', conversionGoal: '发送定制需求', requires: ['product'] },
  { id: 'comparison', title: '选型对比', description: '按统一维度比较不同产品或方案，帮助买家选型。', painPoint: '相似产品看起来接近，买家难以判断适用差异', conversionGoal: '说明需求并获取选型建议', requires: ['comparison'] },
  { id: 'customer_case', title: '客户案例', description: '用已授权的客户问题、过程和结果建立信任。', painPoint: '买家缺少相似客户的合作与落地参考', conversionGoal: '索取相关案例资料', requires: ['case'] },
  { id: 'trend', title: '趋势热点', description: '用有来源的市场变化切入，再连接到企业产品证据。', painPoint: '买家需要判断当前趋势是否值得进入或备货', conversionGoal: '获取趋势对应的产品方案', requires: ['trend'] },
];

export const POSTER_STEPS: { id: StepId; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: 'mode',     label: '选模式',   icon: LayoutGrid, hint: '确认图文生成渠道、平台和产品' },
  { id: 'material', label: '选产品/素材', icon: ImageIcon,  hint: '确认产品并选择产品图、工厂图、包装图和证书图' },
  { id: 'poster',   label: '图文生成', icon: Sparkles,   hint: '一次生成海报图、配文和承接话术' },
];

export const COVER_STEP_INDEX = STEPS.findIndex(s => s.id === 'cover');

export const FOLDERS: MaterialFolder[] = [
  { id: 'recommend', name: '当前选择', count: 0 },
  { id: 'all',     name: '全部素材',   count: 0 },
  { id: 'generated', name: '我的生成', count: 0 },
  { id: 'hot',     name: '爆款素材',   count: 0 },
  { id: 'upload',  name: '本地素材',   count: 0 },
  { id: 'presenter', name: '真人口播', count: 0 },
  { id: 'product', name: '产品主图',   count: 0 },
  { id: 'factory', name: '工厂实拍',   count: 0 },
  { id: 'scene',   name: '使用场景',   count: 0 },
  { id: 'model',   name: '模特出镜',   count: 0 },
  { id: 'detail',  name: '细节特写',   count: 0 },
];

export const POSTER_FOLDERS: MaterialFolder[] = [
  { id: 'recommend', name: '素材推荐', count: 0 },
  { id: 'all', name: '全部图文素材', count: 0 },
  { id: 'generated', name: '我的生成', count: 0 },
  { id: 'hot', name: '爆款图文参考', count: 0 },
  { id: 'upload', name: '我的上传', count: 0 },
  { id: 'product', name: '产品主图', count: 0 },
  { id: 'factory', name: '工厂实拍', count: 0 },
  { id: 'packaging', name: '包装定制', count: 0 },
  { id: 'certificate', name: '证书资质', count: 0 },
  { id: 'scene', name: '使用场景', count: 0 },
  { id: 'brand', name: '品牌视觉', count: 0 },
];

export const POSTER_MATERIAL_GROUPS = [
  { id: 'product', title: '产品主图', desc: '瓶身/包装/套装/产品矩阵，建议 1-4 张', folders: ['product'] },
  { id: 'factory', title: '工厂背书', desc: '产线、灌装、质检、仓储、团队实拍', folders: ['factory'] },
  { id: 'proof', title: '包装/证书', desc: '私标包装、认证证书、检测报告、资质墙', folders: ['packaging', 'certificate'] },
  { id: 'scene', title: '场景/品牌', desc: '使用场景、成分氛围、品牌色和 Logo 参考', folders: ['scene', 'brand'] },
  { id: 'hot', title: '爆款参考', desc: '仅用于拆解画风、结构、CTA，不直接复制承诺', folders: ['hot'] },
] as const;

export const CLIPS: Clip[] = [];

export const BGMS: Bgm[] = [];

export const VOICES: Voice[] = [
  { id: 'v1', name: 'Emma（女声 · 柔美）', tag: '亲和' },
  { id: 'v2', name: 'James（男声 · 沉稳）', tag: '浑厚' },
  { id: 'v3', name: 'Sara（女声 · 温暖）',  tag: '治愈' },
];

export const TTS_PRESETS: Array<{ id: TtsStyleOptions['preset']; label: string; emotion: string; intensity: number; speed: number }> = [
  { id: 'tiktok_excited', label: 'TikTok 激动种草', emotion: '兴奋惊喜', intensity: 90, speed: 1.12 },
  { id: 'authentic_review', label: '真实体验分享', emotion: '自然可信', intensity: 68, speed: 1 },
  { id: 'professional_b2b', label: '外贸专业介绍', emotion: '专业笃定', intensity: 48, speed: 0.94 },
  { id: 'warm_story', label: '温柔故事感', emotion: '温暖治愈', intensity: 60, speed: 0.9 },
  { id: 'urgent_cta', label: '紧迫转化 CTA', emotion: '紧迫有力', intensity: 82, speed: 1.08 },
];

export const DEFAULT_TTS_SETTINGS: LanguageTtsSettings = {
  volume: 1,
  preset: 'authentic_review',
  emotion: '自然可信',
  emotionIntensity: 68,
  speed: 1,
  pauseStyle: 'natural',
  pronunciationText: 'MOQ=M O Q\nOEM=O E M\nODM=O D M',
};

export const ACCOUNTS: SocialAccount[] = [
  { id: 'a1', platform: 'TikTok',    handle: '@yiwu_home',     color: '#010101' },
  { id: 'a2', platform: 'Instagram', handle: '@yiwu.official', color: '#c13584' },
  { id: 'a3', platform: 'YouTube',   handle: 'Yiwu Trading',   color: '#ff0000' },
];

export const IMAGE_DELIVERABLE_OPTIONS: Array<{ id: ImageDeliverable; title: string; desc: string }> = [
  { id: 'product_hero', title: IMAGE_DELIVERABLE_LABELS.product_hero, desc: '突出产品外观，适合官网、目录和主图' },
  { id: 'social_poster', title: IMAGE_DELIVERABLE_LABELS.social_poster, desc: '产品、卖点与行动号召合成一张海报' },
  { id: 'carousel_cover', title: IMAGE_DELIVERABLE_LABELS.carousel_cover, desc: '为多图内容生成第一张注意力封面' },
  { id: 'scenario_visual', title: IMAGE_DELIVERABLE_LABELS.scenario_visual, desc: '把精准产品放入可信使用或陈列场景' },
  { id: 'product_infographic', title: IMAGE_DELIVERABLE_LABELS.product_infographic, desc: '用结构化信息说明产品与已核实卖点' },
];

export const POSTER_STYLES = [
  { id: 'oem-factory', label: 'B2B 产品说明风' },
  { id: 'promo', label: '促销招商风' },
  { id: 'holiday', label: '节日营销风' },
  { id: 'premium', label: '高端品牌风' },
] as const;

export const VIDEO_MODE_DRAFT_TITLES: Record<ModeCard['id'], string> = {
  material: '素材库智能生成',
  clone: '爆款复刻',
  product: '产品信息生成',
};

export const draftTitleForMode = (mode: ModeCard['id'], sourceTitle = '') =>
  `${VIDEO_MODE_DRAFT_TITLES[mode]}${sourceTitle.trim() ? ` · ${sourceTitle.trim()}` : ''}`;

export const RATIOS = ['9:16', '1:1', '16:9'];

export const POSTER_RATIOS = ['1:1', '4:5'];
