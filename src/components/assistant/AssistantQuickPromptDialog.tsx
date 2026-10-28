import { useState } from 'react';
import { Alert, AutoComplete, Input, InputNumber, Select } from 'antd';
import { LsFlowDialog } from '../ui/LsExperiencePrimitives';
import { homeQuickPrompt } from '../../lib/assistantQueryQuickPrompts';

export default function AssistantQuickPromptDialog({ kind, onClose, onPrompt }: { kind: 'industry' | 'rates' | 'trade'; onClose: () => void; onPrompt: (text: string) => void }) {
  const [market, setMarket] = useState('');
  const [industry, setIndustry] = useState(''), [base, setBase] = useState('美元'), [quote, setQuote] = useState('人民币');
  const [country, setCountry] = useState('中国'), [year, setYear] = useState<number | null>(new Date().getFullYear() - 1);
  const [hs, setHs] = useState(''), [flow, setFlow] = useState('出口'), [error, setError] = useState('');
  const submit = () => { try { onPrompt(homeQuickPrompt(kind, { industry, market, base, quote, country, year: year ?? undefined, hs, flow })); onClose(); } catch (error) { setError((error as Error).message); } };
  const title = kind === 'industry' ? '查看行业资讯' : kind === 'rates' ? '查询参考汇率' : '查询国家贸易数据';
  const currencies = ['美元', '人民币', '欧元', '英镑', '日元', '港币', '澳元', '加元', '新加坡元', '迪拉姆', '沙特里亚尔'].map(value => ({ value, label: value }));
  return <LsFlowDialog open title={title} current={0} steps={[{ title: '填写查询条件' }, { title: '填入对话' }]}
    okText="填入输入框" cancelText="取消" onOk={submit} onCancel={onClose}>
    {error && <Alert className="mb-4" type="error" title={error}/>}
    <div className="space-y-4">
      {kind === 'industry' && <><label className="block">关注的行业<Input aria-label="关注的行业" className="mt-2" maxLength={60} placeholder="例如：美妆原料、家具、消费电子" value={industry} onChange={event => setIndustry(event.target.value)}/></label><label className="block">目标市场<AutoComplete aria-label="目标市场" className="mt-2 w-full" options={['全球', '北美', '美国', '加拿大', '欧盟', '英国', '德国', '法国', '日本', '韩国', '东南亚', '中东', '澳大利亚'].map(value => ({ value }))} filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())} placeholder="选择或输入目标市场" value={market} onChange={setMarket}/></label></>}
      {kind === 'rates' && <div className="grid grid-cols-2 gap-3"><label>原币种<Select aria-label="原币种" className="mt-2 w-full" options={currencies} value={base} onChange={setBase}/></label><label>目标币种<Select aria-label="目标币种" className="mt-2 w-full" options={currencies} value={quote} onChange={setQuote}/></label></div>}
      {kind === 'trade' && <>
        <label className="block">统计国家<Select aria-label="统计国家" className="mt-2 w-full" value={country} onChange={setCountry} options={['中国', '美国', '英国', '德国', '法国', '印度', '日本', '韩国', '越南', '沙特', '阿联酋', '澳大利亚', '加拿大', '巴西'].map(value => ({ value, label: value }))}/></label>
        <div className="grid grid-cols-2 gap-3"><label>统计年份<InputNumber aria-label="统计年份" className="mt-2 w-full" min={2000} max={new Date().getFullYear()} value={year} onChange={setYear}/></label><label>贸易方向<Select aria-label="贸易方向" className="mt-2 w-full" value={flow} onChange={setFlow} options={['进口', '出口'].map(value => ({ value, label: value }))}/></label></div>
        <label className="block">HS编码<Input aria-label="HS编码" className="mt-2" placeholder="输入2、4或6位编码" maxLength={6} value={hs} onChange={event => setHs(event.target.value)}/></label>
      </>}
    </div>
  </LsFlowDialog>;
}
