import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Loader2, Save } from 'lucide-react';
import type { Page } from '../../pageRegistry';
import type { SocialPlatform, SocialProgramRoute } from '../../../shared/contracts/socialProgram';
import { useSocialProgram } from '../../contexts/SocialProgramContext';
import SocialProgramPageFrame from './SocialProgramPageFrame';

const PLATFORMS: Array<{ value: SocialPlatform; label: string }> = [
  { value: 'tiktok', label: 'TikTok' }, { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' }, { value: 'facebook', label: 'Facebook' },
  { value: 'douyin', label: '抖音' }, { value: 'xiaohongshu', label: '小红书' },
];

export default function SocialSetupPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { activeProgram, createProgram, updateActiveProgram, mutating, loading } = useSocialProgram();
  const [brandName, setBrandName] = useState('');
  const [businessLine, setBusinessLine] = useState('');
  const [market, setMarket] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [route, setRoute] = useState<SocialProgramRoute>('cold_start');
  const [platforms, setPlatforms] = useState<SocialPlatform[]>([]);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!activeProgram) return;
    setBusinessLine(activeProgram.businessLine || '');
    setTargetAudience(activeProgram.targetAudience);
    setRoute(activeProgram.route || 'cold_start');
    setPlatforms(activeProgram.candidatePlatforms);
    setNotice('');
  }, [activeProgram?.programId, activeProgram?.version]);

  const togglePlatform = (platform: SocialPlatform) => setPlatforms(current => current.includes(platform)
    ? current.filter(item => item !== platform)
    : [...current, platform]);

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setNotice('');
    try {
      await createProgram({ brandName, businessLine, market, targetAudience, route, candidatePlatforms: platforms });
      setNotice('项目已保存到服务端。请继续确认基础资料和账号矩阵。');
    } catch { /* context shows the server error */ }
  };

  const saveExisting = async (confirmFoundation = false) => {
    if (!activeProgram) return;
    setNotice('');
    try {
      await updateActiveProgram({
        expectedVersion: activeProgram.version,
        businessLine,
        targetAudience,
        route,
        candidatePlatforms: platforms,
        ...(confirmFoundation ? { readiness: { foundationConfirmed: true } } : {}),
      });
      setNotice(confirmFoundation ? '基础资料已由你确认。' : '项目设置已保存。');
    } catch { /* context shows the server error */ }
  };

  const fields = (
    <>
      {!activeProgram && <label className="space-y-1.5 text-sm font-medium text-text-secondary">品牌名称<input required value={brandName} onChange={event => setBrandName(event.target.value)} className="ui-field" placeholder="填写真实品牌名称" /></label>}
      <label className="space-y-1.5 text-sm font-medium text-text-secondary">业务线<input value={businessLine} onChange={event => setBusinessLine(event.target.value)} className="ui-field" placeholder="可选，例如护肤产品" /></label>
      {!activeProgram && <label className="space-y-1.5 text-sm font-medium text-text-secondary">目标市场<input required value={market} onChange={event => setMarket(event.target.value)} className="ui-field" placeholder="例如美国，不使用演示默认值" /></label>}
      <label className="space-y-1.5 text-sm font-medium text-text-secondary sm:col-span-2">目标受众<textarea required value={targetAudience} onChange={event => setTargetAudience(event.target.value)} className="ui-field" placeholder="描述真实受众、需求和购买场景" /></label>
    </>
  );

  return (
    <SocialProgramPageFrame title="项目方向" description="确认品牌、市场和经营路线。" currentPage="socialSetup" onNavigate={onNavigate}>
      {!activeProgram ? (
        <form onSubmit={submitCreate} className="rounded-xl border border-border bg-white p-5 sm:p-6">
          <h2 className="text-lg font-bold text-text-primary">创建真实经营项目</h2>
          <p className="mt-1 text-sm text-text-muted">所有必填项都会写入项目 API；页面不会自动补充虚构品牌或平台。</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">{fields}</div>
          <RouteAndPlatforms route={route} setRoute={setRoute} platforms={platforms} togglePlatform={togglePlatform} />
          <button type="submit" disabled={mutating || loading || !brandName.trim() || !market.trim() || !targetAudience.trim() || !platforms.length} className="btn-primary mt-6 inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
            {mutating ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}创建项目
          </button>
        </form>
      ) : (
        <section className="rounded-xl border border-border bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-lg font-bold text-text-primary">{activeProgram.brandName}</h2><p className="mt-1 text-sm text-text-muted">{activeProgram.market} · 品牌和市场创建后由服务端锁定，防止跨项目串用。</p></div>
            {activeProgram.readiness.foundationConfirmed && <span className="tag gap-1 text-accent"><CheckCircle2 size={13} />基础资料已确认</span>}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">{fields}</div>
          <RouteAndPlatforms route={route} setRoute={setRoute} platforms={platforms} togglePlatform={togglePlatform} />
          {notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-accent">{notice}</p>}
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" onClick={() => void saveExisting(false)} disabled={mutating || !targetAudience.trim() || !platforms.length} className="btn-ghost inline-flex items-center gap-2 disabled:opacity-50"><Save size={15} />保存修改</button>
            {!activeProgram.readiness.foundationConfirmed && activeProgram.route === 'cold_start' && <button type="button" onClick={() => void saveExisting(true)} disabled={mutating || !targetAudience.trim() || !platforms.length} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"><CheckCircle2 size={15} />确认基础资料</button>}
            <button type="button" onClick={() => onNavigate('socialAccounts')} className="btn-primary inline-flex items-center gap-2">下一步：配置账号矩阵<ArrowRight size={15} /></button>
          </div>
        </section>
      )}
    </SocialProgramPageFrame>
  );
}

function RouteAndPlatforms({
  route,
  setRoute,
  platforms,
  togglePlatform,
}: {
  route: SocialProgramRoute;
  setRoute: (route: SocialProgramRoute) => void;
  platforms: SocialPlatform[];
  togglePlatform: (platform: SocialPlatform) => void;
}) {
  return (
    <div className="mt-6 space-y-5 border-t border-border pt-5">
      <fieldset><legend className="text-sm font-bold text-text-primary">经营路线</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">
        {([{ value: 'cold_start', label: '从零搭建', detail: '先确认基础资料，再建立账号矩阵。' }, { value: 'account_repair', label: '已有账号修复', detail: '先录入真实账号，再等待诊断结果。' }] as const).map(item => (
          <label key={item.value} className={`cursor-pointer rounded-lg border p-4 ${route === item.value ? 'border-accent bg-emerald-50' : 'border-border'}`}>
            <span className="flex items-center gap-2"><input type="radio" name="social-route" checked={route === item.value} onChange={() => setRoute(item.value)} /><strong className="text-sm text-text-primary">{item.label}</strong></span>
            <span className="mt-1 block pl-5 text-xs text-text-muted">{item.detail}</span>
          </label>
        ))}
      </div></fieldset>
      <fieldset><legend className="text-sm font-bold text-text-primary">候选平台</legend><div className="mt-3 flex flex-wrap gap-2">
        {PLATFORMS.map(item => <label key={item.value} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${platforms.includes(item.value) ? 'border-accent bg-emerald-50 font-semibold text-accent' : 'border-border text-text-secondary'}`}><input type="checkbox" className="mr-2" checked={platforms.includes(item.value)} onChange={() => togglePlatform(item.value)} />{item.label}</label>)}
      </div></fieldset>
    </div>
  );
}
