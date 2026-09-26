import { useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Loader2, Plus, RefreshCcw, Users } from 'lucide-react';
import type { Page } from '../../pageRegistry';
import type { SocialPlatform } from '../../../shared/contracts/socialProgram';
import { useSocialProgram } from '../../contexts/SocialProgramContext';
import SocialProgramPageFrame from './SocialProgramPageFrame';

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook',
  douyin: '抖音', xiaohongshu: '小红书', other: '其他',
};

export default function SocialAccountsPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const {
    activeProgram, accounts, accountsLoading, accountsError, mutating,
    createAccount, refreshAccounts, updateActiveProgram,
  } = useSocialProgram();
  const [showCreate, setShowCreate] = useState(false);
  const [platform, setPlatform] = useState<SocialPlatform>('tiktok');
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [businessRole, setBusinessRole] = useState('');
  const [audiencePromise, setAudiencePromise] = useState('');
  const [contentPromise, setContentPromise] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice('');
    try {
      await createAccount({ platform, displayName, handle, businessRole, audiencePromise, contentPromise });
      setDisplayName(''); setHandle(''); setBusinessRole(''); setAudiencePromise(''); setContentPromise('');
      setShowCreate(false);
      setNotice('账号定义已保存；平台授权仍需在发布与渠道中单独完成。');
    } catch { /* context shows the server error */ }
  };

  const confirmAccountImport = async () => {
    if (!activeProgram || !accounts.length) return;
    setNotice('');
    try {
      await updateActiveProgram({ expectedVersion: activeProgram.version, readiness: { accountImportConfirmed: true } });
      setNotice('账号录入已由你确认。账号诊断仍需产生真实结果后才能完成。');
    } catch { /* context shows the server error */ }
  };

  if (!activeProgram) {
    return <SocialProgramPageFrame title="账号矩阵" description="为真实账号分配职责。" currentPage="socialAccounts" onNavigate={onNavigate}><section className="rounded-xl border border-dashed border-border-bright bg-white px-6 py-14 text-center"><Users size={32} className="mx-auto text-accent" /><h2 className="mt-4 text-lg font-bold">请先创建经营项目</h2><button type="button" onClick={() => onNavigate('socialSetup')} className="btn-primary mt-5">上一步：项目方向</button></section></SocialProgramPageFrame>;
  }

  return (
    <SocialProgramPageFrame
      title="自有账号矩阵"
      description="账号定义与平台授权分开保存；这里不会把候选平台伪装成已连接账号。"
      currentPage="socialAccounts"
      onNavigate={onNavigate}
      action={<button type="button" onClick={() => setShowCreate(value => !value)} className="btn-primary inline-flex items-center gap-2"><Plus size={15} />新增账号</button>}
    >
      {accountsError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{accountsError} <button type="button" className="ml-2 underline" onClick={() => void refreshAccounts()}>重试</button></div>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-accent">{notice}</p>}
      {showCreate && (
        <form onSubmit={submit} className="rounded-xl border border-border bg-white p-5 sm:p-6">
          <h2 className="text-lg font-bold text-text-primary">新增真实账号定义</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium text-text-secondary">平台<select value={platform} onChange={event => setPlatform(event.target.value as SocialPlatform)} className="ui-field ui-select">{Object.entries(PLATFORM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="space-y-1.5 text-sm font-medium text-text-secondary">账号名称<input required value={displayName} onChange={event => setDisplayName(event.target.value)} className="ui-field" /></label>
            <label className="space-y-1.5 text-sm font-medium text-text-secondary">账号 handle<input value={handle} onChange={event => setHandle(event.target.value)} className="ui-field" placeholder="可选，尚未授权也可留空" /></label>
            <label className="space-y-1.5 text-sm font-medium text-text-secondary">业务角色<input required value={businessRole} onChange={event => setBusinessRole(event.target.value)} className="ui-field" placeholder="例如产品教育账号" /></label>
            <label className="space-y-1.5 text-sm font-medium text-text-secondary">受众承诺<textarea required value={audiencePromise} onChange={event => setAudiencePromise(event.target.value)} className="ui-field" /></label>
            <label className="space-y-1.5 text-sm font-medium text-text-secondary">内容承诺<textarea required value={contentPromise} onChange={event => setContentPromise(event.target.value)} className="ui-field" /></label>
          </div>
          <div className="mt-5 flex gap-2"><button type="submit" disabled={mutating} className="btn-primary inline-flex items-center gap-2">{mutating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}保存账号</button><button type="button" onClick={() => setShowCreate(false)} className="btn-ghost">取消</button></div>
        </form>
      )}

      <section className="rounded-xl border border-border bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">账号列表</h2><p className="mt-1 text-sm text-text-muted">只展示当前项目从 API 读取的账号。</p></div><button type="button" onClick={() => void refreshAccounts()} disabled={accountsLoading} className="btn-ghost inline-flex items-center gap-2 px-3 py-2">{accountsLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}刷新</button></div>
        {!accountsLoading && !accounts.length ? (
          <div className="mt-5 rounded-lg border border-dashed border-border-bright px-5 py-10 text-center text-sm text-text-muted">当前项目尚未保存账号定义。</div>
        ) : (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">{accounts.map(account => (
            <article key={account.accountId} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-text-primary">{account.displayName}</h3><p className="mt-1 text-xs text-text-muted">{PLATFORM_LABELS[account.platform]}{account.handle ? ` · ${account.handle}` : ''}</p></div><span className="tag">{account.connectionId ? '已连接' : '未授权'}</span></div>
              <dl className="mt-4 grid gap-3 text-sm"><div><dt className="text-xs text-text-muted">业务角色</dt><dd className="mt-1 text-text-primary">{account.businessRole}</dd></div><div><dt className="text-xs text-text-muted">受众承诺</dt><dd className="mt-1 text-text-primary">{account.audiencePromise}</dd></div><div><dt className="text-xs text-text-muted">内容承诺</dt><dd className="mt-1 text-text-primary">{account.contentPromise}</dd></div></dl>
              <div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="tag">{account.playbookRef ? `账号规则 v${account.playbookRef.version}` : '账号规则未建立'}</span><span className="tag">{account.conversionRoute ? '获客路径已配置' : '获客路径未配置'}</span></div>
            </article>
          ))}</div>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {activeProgram.route === 'account_repair' && !activeProgram.readiness.accountImportConfirmed && accounts.length > 0 && <button type="button" onClick={() => void confirmAccountImport()} disabled={mutating} className="btn-primary inline-flex items-center gap-2"><CheckCircle2 size={15} />确认账号录入完成</button>}
          <button type="button" onClick={() => onNavigate('socialPlanning')} className="btn-primary inline-flex items-center gap-2">下一步：制定月周计划<ArrowRight size={15} /></button>
        </div>
      </section>
    </SocialProgramPageFrame>
  );
}
