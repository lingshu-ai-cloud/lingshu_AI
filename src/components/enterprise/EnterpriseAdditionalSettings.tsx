import { Collapse, Input } from 'antd';
import { BookOpen, Compass, Loader2, Megaphone, Upload } from 'lucide-react';
import { Field, OptionSelector } from './EnterpriseFormControls';
import { LANGUAGE_OPTIONS, MARKET_OPTIONS } from './enterpriseProfileNormalization';
import type { Profile } from './enterpriseProfileTypes';

const inputCls = 'w-full';
const textareaCls = 'w-full resize-y';
const BRAND_TONE_OPTIONS = ['专业可靠', '亲切自然', '简洁直接', '高端克制', '热情主动', '务实高效'];
const COMMUNICATION_STYLE_OPTIONS = ['专业', '轻松', '亲切', '正式'];

interface Props {
  profile: Profile;
  orderImporting: boolean;
  orderImportMessage: string;
  onFieldChange: (section: 'strategy' | 'brand' | 'agentLearning', field: string, value: string) => void;
  onKnowledgeChange: (value: string) => void;
  onImportOrderCsv: (file: File | null) => void | Promise<void>;
}

export default function EnterpriseAdditionalSettings({ profile, orderImporting, orderImportMessage, onFieldChange, onKnowledgeChange, onImportOrderCsv }: Props) {
  return (
  <div className="border-t border-border pt-5">
    <h3 className="mb-2 text-sm font-semibold text-text-primary">更多设置</h3>
    <Collapse
      ghost
      className="enterprise-advanced-collapse"
      items={[
        {
          key: 'strategy',
          label: <span className="inline-flex items-center gap-2 text-sm font-semibold"><Compass size={14} />经营策略</span>,
          children: <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="当前阶段目标"><Input className={inputCls} value={profile.strategy?.currentGoal ?? ''} onChange={e => onFieldChange('strategy', 'currentGoal', e.target.value)} /></Field>
            <Field label="本期重点产品"><Input className={inputCls} value={profile.strategy?.focusProducts ?? ''} onChange={e => onFieldChange('strategy', 'focusProducts', e.target.value)} /></Field>
            <Field label="重点市场"><OptionSelector value={profile.strategy?.focusMarkets ?? ''} options={MARKET_OPTIONS} onChange={value => onFieldChange('strategy', 'focusMarkets', value)} placeholder="选择重点市场" /></Field>
            <Field label="暂不经营市场"><OptionSelector value={profile.strategy?.excludedMarkets ?? ''} options={MARKET_OPTIONS} onChange={value => onFieldChange('strategy', 'excludedMarkets', value)} placeholder="选择暂不经营市场" /></Field>
            <Field label="最低利润率"><Input className={inputCls} value={profile.strategy?.minMargin ?? ''} onChange={e => onFieldChange('strategy', 'minMargin', e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="价格策略"><Input.TextArea className={textareaCls} rows={2} value={profile.strategy?.pricingStrategy ?? ''} onChange={e => onFieldChange('strategy', 'pricingStrategy', e.target.value)} /></Field></div>
          </div>,
        },
        {
          key: 'brand',
          label: <span className="inline-flex items-center gap-2 text-sm font-semibold"><Megaphone size={14} />品牌与语气</span>,
          children: <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="品牌名称"><Input className={inputCls} value={profile.brand.name ?? ''} onChange={e => onFieldChange('brand', 'name', e.target.value)} /></Field>
            <Field label="品牌调性关键词"><OptionSelector value={profile.brand.tone} options={BRAND_TONE_OPTIONS} onChange={value => onFieldChange('brand', 'tone', value)} placeholder="选择品牌调性" /></Field>
            <Field label="沟通风格"><OptionSelector value={profile.brand.style} options={COMMUNICATION_STYLE_OPTIONS} multiple={false} onChange={value => onFieldChange('brand', 'style', value)} placeholder="选择沟通风格" /></Field>
            <Field label="首选输出语言"><OptionSelector value={profile.brand.preferredLanguages ?? ''} options={LANGUAGE_OPTIONS} onChange={value => onFieldChange('brand', 'preferredLanguages', value)} placeholder="选择首选输出语言" /></Field>
            <Field label="核心卖点"><Input className={inputCls} value={profile.brand.usp} onChange={e => onFieldChange('brand', 'usp', e.target.value)} /></Field>
            <Field label="禁忌话题"><Input className={inputCls} value={profile.brand.taboos} onChange={e => onFieldChange('brand', 'taboos', e.target.value)} /></Field>
          </div>,
        },
        {
          key: 'learning',
          label: <span className="inline-flex items-center gap-2 text-sm font-semibold"><BookOpen size={14} />Agent 学习记录</span>,
          children: <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="已验证有效角度"><Input.TextArea className={textareaCls} rows={2} value={profile.agentLearning?.provenAngles ?? ''} onChange={e => onFieldChange('agentLearning', 'provenAngles', e.target.value)} /></Field>
            <Field label="低效角度 / 需降权"><Input.TextArea className={textareaCls} rows={2} value={profile.agentLearning?.weakAngles ?? ''} onChange={e => onFieldChange('agentLearning', 'weakAngles', e.target.value)} /></Field>
            <Field label="待确认推断"><Input.TextArea className={textareaCls} rows={2} value={profile.agentLearning?.pendingAssumptions ?? ''} onChange={e => onFieldChange('agentLearning', 'pendingAssumptions', e.target.value)} /></Field>
            <Field label="用户纠正偏好"><Input.TextArea className={textareaCls} rows={2} value={profile.agentLearning?.userCorrections ?? ''} onChange={e => onFieldChange('agentLearning', 'userCorrections', e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="自由填写"><Input.TextArea className={textareaCls} rows={4} value={profile.knowledge} onChange={e => onKnowledgeChange(e.target.value)} /></Field></div>
          </div>,
        },
        {
          key: 'orders',
          label: <span className="inline-flex items-center gap-2 text-sm font-semibold"><Upload size={14} />订单数据导入</span>,
          children: <div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">
              {orderImporting ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}上传订单 CSV
              <input type="file" accept=".csv,text/csv" className="hidden" disabled={orderImporting} onChange={e => { const file = e.target.files?.[0] || null; e.currentTarget.value = ''; void onImportOrderCsv(file); }} />
            </label>
            {orderImportMessage && <p className="mt-2 text-[11px] font-bold text-emerald-700">{orderImportMessage}</p>}
          </div>,
        },
      ]}
    />
  </div>
  );
}
