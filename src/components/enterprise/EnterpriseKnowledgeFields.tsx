import { Alert, Empty, Input } from 'antd';
import { Building2, Globe2, Megaphone, ShieldCheck, Users, BookOpen } from 'lucide-react';
import { Field, KnowledgeCard, OptionSelector } from './EnterpriseFormControls';
import { LANGUAGE_OPTIONS, MARKET_OPTIONS } from './enterpriseProfileNormalization';
import type { Profile } from './enterpriseProfileTypes';
import type { KnowledgeView } from './enterpriseKnowledgeNavigation';

type Section = 'company' | 'brand' | 'operations' | 'customers' | 'agentLearning' | 'strategy';
export default function EnterpriseKnowledgeFields({ view, profile: p, onChange }: {
  view: KnowledgeView; profile: Profile; onChange: (section: Section, field: string, value: string) => void;
}) {
  const field = (section: Section, key: string, label: string, hint?: string, rows = 2) => <Field key={`${section}.${key}`} label={label} hint={hint}>
    <Input.TextArea rows={rows} value={String((p[section] as Record<string, unknown> | undefined)?.[key] ?? '')} onChange={e => onChange(section, key, e.target.value)} />
  </Field>;
  if (view === 'brand') return <KnowledgeCard icon={Megaphone} title="品牌表达" purpose="内容创作时复用已确认的品牌信息；可在首次需要品牌内容时补充。" completed={Boolean(p.brand.name)}>
    <div className="grid gap-x-6 md:grid-cols-2">
      {field('brand', 'name', '品牌名称', '没有独立品牌时可使用企业对外名称。', 1)}
      {field('brand', 'usp', '品牌核心优势', '仅填写可由实际产品或能力支持的优势。')}
      {field('brand', 'tone', '品牌语气', '例如专业、简洁、务实；可在使用中调整。')}
      {field('brand', 'style', '常用表达方式')}
      {field('brand', 'taboos', '宣传禁用表述', '例如未经证明的功效、绝对化承诺。')}
      <Field label="品牌输出语言"><OptionSelector value={p.brand.preferredLanguages || ''} options={LANGUAGE_OPTIONS} onChange={v => onChange('brand', 'preferredLanguages', v)} /></Field>
    </div>
  </KnowledgeCard>;
  if (view === 'credentials') return <KnowledgeCard icon={ShieldCheck} title="能力与资质" purpose="当内容、采购咨询或生产任务需要相关证明时再补充，无需首次全部填完。" completed={Boolean(p.company.capabilities || p.company.certifications)}>
    {field('company', 'capabilities', '工厂与企业能力', '实际生产、研发、质检、产能和服务能力，避免填写未经核实的数字。', 3)}
    {field('company', 'certifications', '企业资质与适用范围', '写明认证主体和覆盖范围；产品专属证书在对应产品档案维护。', 3)}
    {field('company', 'credentialEvidence', '证明资料索引', '记录证书名称、有效期或已持有的资料链接，文字记录不代表证明已核验。')}
    <Alert type="info" showIcon title="任务使用某项能力或资质前，仍需核对对应证明及适用范围。" />
  </KnowledgeCard>;
  if (view === 'market') return <KnowledgeCard id="enterprise-language-settings" icon={Globe2} title="目标市场与语言" purpose="新手配置先确认方向；未确定的信息可在开展具体工作时补充。" completed={Boolean(p.company.mainMarkets && p.company.primaryLanguages)}>
    <div className="grid gap-6 md:grid-cols-2">
      <Field label="主要市场"><OptionSelector value={p.company.mainMarkets} options={MARKET_OPTIONS} onChange={v => onChange('company', 'mainMarkets', v)} /></Field>
      <Field label="主要沟通语言"><OptionSelector value={p.company.primaryLanguages || ''} options={LANGUAGE_OPTIONS} onChange={v => onChange('company', 'primaryLanguages', v)} /></Field>
    </div>
    {field('strategy', 'excludedMarkets', '明确不经营的市场', '长期限制在此记录；本期重点市场在经营任务中选择。')}
  </KnowledgeCard>;
  if (view === 'buyers') return <KnowledgeCard icon={Users} title="买家画像" purpose="先记录希望服务谁，后续依据真实咨询与成交情况逐步修正。" completed={Boolean(p.customers?.targetProfiles)}>
    {field('customers', 'targetProfiles', '目标买家与典型需求', '如品牌采购、经销商、批发商；描述需求和适配产品。', 3)}
    <div className="grid gap-x-6 md:grid-cols-2">{field('customers', 'highValueSignals', '值得优先跟进的信号')}{field('customers', 'lowQualitySignals', '需要进一步核实的信号')}</div>
    <p className="text-xs text-text-muted">这些是企业的判断依据，具体客户的资料、订单和阶段仍在客户会话中维护。</p>
  </KnowledgeCard>;
  if (view === 'cooperation') return <KnowledgeCard icon={Building2} title="合作方式与通用条件" purpose="维护公司默认政策；某款产品有特殊条件时，在产品详情单独记录。" completed={Boolean(p.operations?.customization)}>
    {field('operations', 'customization', '合作方式与定制能力', '例如 OEM／ODM、批发、分销，以及可定制的项目。', 3)}
    {field('operations', 'logistics', '物流与服务范围', '可支持的交付方式、地区及需逐单核实的条件。')}
    <Alert showIcon type="info" title="价格、起订量和交期如有产品例外，以核对后的产品条件为准。" />
  </KnowledgeCard>;
  if (view === 'boundaries') return <KnowledgeCard icon={ShieldCheck} title="对外答复边界" purpose="在首次接待或涉及业务承诺时确认；保存知识不等于开启自动回复。" completed={Boolean(p.operations?.riskNotes)}>
    {field('operations', 'riskNotes', '需人工确认的事项', '例如具体报价、特定交期、未证实的认证和售后赔付。', 3)}
    <Alert type="warning" showIcon title="参考价格、议价底线及利润信息仅供内部使用" description="现有询价流程继续转人工报价。自动回复、转人工和通知设置从页面右上角进入。" />
  </KnowledgeCard>;
  if (view === 'learning') {
    const hasExperience = Boolean(p.agentLearning?.provenAngles || p.agentLearning?.weakAngles || p.agentLearning?.pendingAssumptions || p.agentLearning?.userCorrections || p.knowledge);
    return <KnowledgeCard icon={BookOpen} title="经营经验" purpose="使用中积累，保留适用产品、市场、平台及证据；待确认推断不能当成企业事实。" completed={hasExperience}>
      {!hasExperience && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="目前还没有沉淀记录，无需首次填写。可在实际使用后补充经验与证据。" />}
      <div className="grid gap-x-6 md:grid-cols-2">{field('agentLearning', 'provenAngles', '已验证的内容与销售经验', '注明依据、样本和适用范围。', 3)}{field('agentLearning', 'weakAngles', '效果不佳或不再采用的做法', undefined, 3)}{field('agentLearning', 'pendingAssumptions', '待确认推断', '仅作为待核实记录，不作为已确认事实使用。', 3)}{field('agentLearning', 'userCorrections', '用户纠正与偏好', undefined, 3)}</div>
      <Field label="历史补充记录" hint="保留原有自由填写资料，逐步整理到对应档案。"><Input.TextArea rows={3} value={p.knowledge} onChange={e => onChange('agentLearning', '__knowledge', e.target.value)} /></Field>
    </KnowledgeCard>;
  }
  return null;
}
