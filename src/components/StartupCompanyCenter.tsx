import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Check,
  CircleAlert,
  ClipboardCheck,
  Download,
  Eye,
  FileArchive,
  FileCheck2,
  FileText,
  Landmark,
  Loader2,
  Plus,
  ReceiptText,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type {
  StartupCompanyDocument,
  StartupCompanyDocumentCategory,
  StartupCompanyProfile,
  StartupHubSnapshot,
} from '../../shared/startupHub';
import type { StartupHubActions } from '../lib/startupHubUi';
import StartupTaxCalendar from './StartupTaxCalendar';

interface Props { snapshot: StartupHubSnapshot; actions: StartupHubActions; saving: boolean }
type CompanyView = 'profile' | 'tax' | 'documents' | 'governance';
type CompanyDraft = Omit<StartupCompanyProfile, 'updatedAt' | 'updatedBy'>;

const EMPTY_COMPANY: CompanyDraft = {
  name: '', taxpayerType: '未确认', taxRegion: '', taxContact: '', creditCode: '', entityType: '',
  legalRepresentative: '', establishedDate: '', industry: '', accountingStandard: '', bookkeepingMode: '',
  vatFilingCycle: '未确认', incomeTaxFilingCycle: '按季', employeeStatus: '未确认', bankName: '', bankBranch: '',
  bankCustomerNumber: '', bankOperatorNumber: '', bankAccount: '', basicDepositAccountNumber: '', bankAccountOpenedDate: '',
  onlineBankingSecurityStatus: '未确认', bankAccountTaxReportStatus: '未确认', taxPaymentAgreementStatus: '未确认',
};

const DOCUMENT_CATEGORY: Record<StartupCompanyDocumentCategory, string> = {
  license: '营业执照', articles: '公司章程 / 股东文件', tax: '税务资料', bank: '银行资料',
  contract: '重要合同', hr: '人事与社保', ip: '知识产权', other: '其他资料',
};

const REGION_OPTIONS = [
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽',
  '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南',
  '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆', '香港', '澳门', '其他',
];

const INDUSTRY_OPTIONS = ['软件和信息技术服务', '互联网和相关服务', '批发和零售', '制造业', '商务服务', '科学研究和技术服务', '文化、体育和娱乐', '教育', '住宿和餐饮', '建筑业', '其他'];

const GOVERNANCE_ITEMS = [
  { title: '归档营业执照电子版', detail: '保留清晰扫描件，变更后及时替换旧版本', category: 'license' as const, priority: 'high' as const },
  { title: '归档公司章程与股东协议', detail: '记录签署版本、股东签字页和历次修订', category: 'articles' as const, priority: 'high' as const },
  { title: '核对银行账户税务备案与三方协议', detail: '开户后核对存款账户报告和自动扣税协议', category: 'bank' as const, priority: 'high' as const },
  { title: '建立印章清单与使用审批规则', detail: '明确公章、合同章、财务章、法人章保管人', priority: 'medium' as const },
  { title: '建立知识产权资产清单', detail: '跟踪商标、域名、软件著作权及续费日期', category: 'ip' as const, priority: 'medium' as const },
  { title: '核对员工劳动合同与社保手续', detail: '有员工时确认合同、个税、社保和公积金责任', category: 'hr' as const, priority: 'high' as const },
  { title: '安排本年度工商年度报告', detail: '企业通常需在每年 1 月 1 日至 6 月 30 日完成年报公示', priority: 'medium' as const },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function StartupCompanyCenter({ snapshot, actions, saving }: Props) {
  const [view, setView] = useState<CompanyView>(snapshot.company ? 'tax' : 'profile');
  const [editingCompany, setEditingCompany] = useState(!snapshot.company);
  const [company, setCompany] = useState<CompanyDraft>(EMPTY_COMPANY);
  const [profileNotice, setProfileNotice] = useState('');
  const [documentCategory, setDocumentCategory] = useState<StartupCompanyDocumentCategory>('license');
  const [documentExpiryDate, setDocumentExpiryDate] = useState('');
  const [documentNotice, setDocumentNotice] = useState('');
  const [documentFilter, setDocumentFilter] = useState<'all' | StartupCompanyDocumentCategory>('all');
  const [preview, setPreview] = useState<{ document: StartupCompanyDocument; url: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!snapshot.company) return;
    setCompany({ ...EMPTY_COMPANY, ...snapshot.company });
  }, [snapshot.company]);

  const pendingTaxes = snapshot.taxRecords.filter(item => !['filed', 'paid'].includes(item.status));
  const overdueTaxes = pendingTaxes.filter(item => item.dueDate && new Date(`${item.dueDate}T23:59:59`).getTime() < Date.now());
  const profileFields = [company.name, company.creditCode, company.entityType, company.taxpayerType !== '未确认' ? company.taxpayerType : '', company.taxRegion, company.taxContact, company.legalRepresentative, company.establishedDate, company.industry, company.accountingStandard, company.bookkeepingMode, company.vatFilingCycle !== '未确认' ? company.vatFilingCycle : '', company.employeeStatus !== '未确认' ? company.employeeStatus : ''];
  const profileProgress = Math.round(profileFields.filter(Boolean).length / profileFields.length * 100);
  const governanceTasks = snapshot.tasks.filter(item => item.area === '公司治理');
  const filteredDocuments = documentFilter === 'all' ? snapshot.documents : snapshot.documents.filter(document => document.category === documentFilter);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const saveCompany = async () => {
    if (!company.name.trim()) {
      setProfileNotice('请先填写公司全称，其余资料可以稍后补充。');
      return;
    }
    setProfileNotice('');
    try {
      await actions.updateCompany(company);
      setEditingCompany(false);
      setProfileNotice('公司资料已保存。');
    } catch (error) {
      setProfileNotice(error instanceof Error ? error.message : '公司资料保存失败，请重试。');
    }
  };

  const uploadDocument = async (file: File) => {
    setDocumentNotice('');
    try {
      await actions.uploadDocument(file, { category: documentCategory, expiryDate: documentExpiryDate || undefined });
      setDocumentExpiryDate('');
      setDocumentNotice('文件已安全保存到当前公司工作区。');
    } catch (error) {
      setDocumentNotice(error instanceof Error ? error.message : '上传失败');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const openPreview = async (document: StartupCompanyDocument) => {
    setDocumentNotice('');
    setPreviewLoading(document.id);
    try {
      const blob = await actions.loadDocumentBlob(document);
      setPreview({ document, url: URL.createObjectURL(blob) });
    } catch (error) {
      setDocumentNotice(error instanceof Error ? error.message : '预览加载失败');
    } finally {
      setPreviewLoading('');
    }
  };

  const addGovernanceTask = async (title: string, priority: 'high' | 'medium' | 'low') => {
    if (!company.taxContact) {
      setView('profile');
      setEditingCompany(true);
      return;
    }
    await actions.create('tasks', { title, area: '公司治理', owner: company.taxContact, priority, status: 'open' });
  };

  const tabs: Array<{ id: CompanyView; label: string; icon: typeof Building2 }> = [
    { id: 'profile', label: '公司资料', icon: Building2 },
    { id: 'tax', label: '税务助手', icon: ReceiptText },
    { id: 'documents', label: '证照文件', icon: FileArchive },
    { id: 'governance', label: '治理清单', icon: ClipboardCheck },
  ];

  return <div className="space-y-4">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <button type="button" onClick={() => setView('profile')} className="section-panel p-4 text-left hover:border-border-bright"><p className="text-[9px] text-text-muted">公司资料完整度</p><div className="mt-2 flex items-end justify-between"><strong className="text-2xl tracking-[-.04em]">{profileProgress}%</strong><Building2 size={16} className="text-accent" /></div><div className="mt-3 h-1.5 rounded-full bg-[#e8ece7]"><div className="h-full rounded-full bg-accent" style={{ width: `${profileProgress}%` }} /></div></button>
      <button type="button" onClick={() => setView('tax')} className="section-panel p-4 text-left hover:border-border-bright"><p className="text-[9px] text-text-muted">待办税务事项</p><div className="mt-2 flex items-end justify-between"><strong className="text-2xl tracking-[-.04em]">{pendingTaxes.length}</strong><CalendarClock size={16} className="text-accent" /></div><p className={`mt-3 text-[9px] ${overdueTaxes.length ? 'text-red-700' : 'text-text-muted'}`}>{overdueTaxes.length ? `${overdueTaxes.length} 项已超过设定日期` : '当前没有逾期记录'}</p></button>
      <button type="button" onClick={() => setView('documents')} className="section-panel p-4 text-left hover:border-border-bright"><p className="text-[9px] text-text-muted">公司文件</p><div className="mt-2 flex items-end justify-between"><strong className="text-2xl tracking-[-.04em]">{snapshot.documents.length}</strong><FileCheck2 size={16} className="text-accent" /></div><p className="mt-3 text-[9px] text-text-muted">营业执照、章程、税务和银行资料</p></button>
      <button type="button" onClick={() => setView('governance')} className="section-panel p-4 text-left hover:border-border-bright"><p className="text-[9px] text-text-muted">公司治理待办</p><div className="mt-2 flex items-end justify-between"><strong className="text-2xl tracking-[-.04em]">{governanceTasks.filter(item => item.status !== 'completed').length}</strong><ShieldCheck size={16} className="text-accent" /></div><p className="mt-3 text-[9px] text-text-muted">在公司中心独立跟进</p></button>
    </section>

    <section className="section-panel overflow-hidden">
      <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2" role="tablist" aria-label="公司中心功能">
        {tabs.map(tab => { const Icon = tab.icon; return <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} onClick={() => setView(tab.id)} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold ${view === tab.id ? 'bg-[#e8f2eb] text-accent' : 'text-text-secondary hover:bg-[#f4f6f3]'}`}><Icon size={13} />{tab.label}</button>; })}
      </div>

      {view === 'profile' && <div>
        <div className="flex flex-col justify-between gap-3 border-b border-border bg-[#fbfcfa] px-5 py-4 sm:flex-row sm:items-center"><div><h3 className="text-sm font-semibold">公司基础档案</h3><p className="mt-1 text-[10px] text-text-muted">这些信息用于生成税务提醒和治理检查，不保存账号密码或税控凭证。</p></div>{snapshot.company && !editingCompany && <button type="button" onClick={() => setEditingCompany(true)} className="text-[10px] font-semibold text-accent">编辑资料</button>}</div>
        {profileNotice && <div role="status" className={`mx-5 mt-4 rounded-lg px-3 py-2 text-[10px] ${/失败|请先/.test(profileNotice) ? 'bg-red-50 text-red-700' : 'bg-[#edf5ef] text-accent'}`}>{profileNotice}</div>}
        {editingCompany ? <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-[10px] font-semibold text-text-secondary">公司全称 *<input value={company.name} onChange={event => setCompany(value => ({ ...value, name: event.target.value }))} className="ui-field mt-1.5" autoComplete="organization" /></label>
          <label className="text-[10px] font-semibold text-text-secondary">统一社会信用代码<input value={company.creditCode || ''} onChange={event => setCompany(value => ({ ...value, creditCode: event.target.value.toUpperCase() }))} className="ui-field mt-1.5 font-mono" maxLength={18} /></label>
          <label className="text-[10px] font-semibold text-text-secondary">企业类型<select value={company.entityType || ''} onChange={event => setCompany(value => ({ ...value, entityType: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">请选择</option><option>有限责任公司</option><option>股份有限公司</option><option>合伙企业</option><option>个人独资企业</option><option>个体工商户</option><option>其他</option></select></label>
          <label className="text-[10px] font-semibold text-text-secondary">法定代表人<input value={company.legalRepresentative || ''} onChange={event => setCompany(value => ({ ...value, legalRepresentative: event.target.value }))} className="ui-field mt-1.5" /></label>
          <label className="text-[10px] font-semibold text-text-secondary">成立日期<input type="date" value={company.establishedDate || ''} onChange={event => setCompany(value => ({ ...value, establishedDate: event.target.value }))} className="ui-field mt-1.5" /></label>
          <label className="text-[10px] font-semibold text-text-secondary">登记 / 主管地区<select value={company.taxRegion} onChange={event => setCompany(value => ({ ...value, taxRegion: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">稍后补充</option>{REGION_OPTIONS.map(option => <option key={option}>{option}</option>)}</select></label>
          <label className="text-[10px] font-semibold text-text-secondary">所属行业<select value={company.industry || ''} onChange={event => setCompany(value => ({ ...value, industry: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">请选择</option>{INDUSTRY_OPTIONS.map(option => <option key={option}>{option}</option>)}</select></label>
          <label className="text-[10px] font-semibold text-text-secondary">增值税纳税人类型<select value={company.taxpayerType} onChange={event => setCompany(value => ({ ...value, taxpayerType: event.target.value }))} className="ui-field ui-select mt-1.5"><option>未确认</option><option>小规模纳税人</option><option>一般纳税人</option><option>不适用 / 其他</option></select></label>
          <label className="text-[10px] font-semibold text-text-secondary">增值税申报周期<select value={company.vatFilingCycle || '未确认'} onChange={event => setCompany(value => ({ ...value, vatFilingCycle: event.target.value }))} className="ui-field ui-select mt-1.5"><option>未确认</option><option>按月</option><option>按季</option><option>按次 / 其他</option></select></label>
          <label className="text-[10px] font-semibold text-text-secondary">企业所得税预缴周期<select value={company.incomeTaxFilingCycle || '按季'} onChange={event => setCompany(value => ({ ...value, incomeTaxFilingCycle: event.target.value }))} className="ui-field ui-select mt-1.5"><option>未确认</option><option>按月</option><option>按季</option><option>不适用 / 其他</option></select></label>
          <label className="text-[10px] font-semibold text-text-secondary">会计制度<select value={company.accountingStandard || ''} onChange={event => setCompany(value => ({ ...value, accountingStandard: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">请选择 / 待确认</option><option>小企业会计准则</option><option>企业会计准则</option><option>企业会计制度</option><option>其他</option></select></label>
          <label className="text-[10px] font-semibold text-text-secondary">记账方式<select value={company.bookkeepingMode || ''} onChange={event => setCompany(value => ({ ...value, bookkeepingMode: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">请选择</option><option>公司自行记账</option><option>代理记账机构</option><option>专职 / 兼职会计</option><option>尚未确定</option></select></label>
          <label className="text-[10px] font-semibold text-text-secondary">是否已有员工<select value={company.employeeStatus || '未确认'} onChange={event => setCompany(value => ({ ...value, employeeStatus: event.target.value }))} className="ui-field ui-select mt-1.5"><option>未确认</option><option>已有员工</option><option>仅有股东 / 法人</option><option>暂无人员</option></select></label>
          <label className="text-[10px] font-semibold text-text-secondary">财税负责人<input value={company.taxContact} onChange={event => setCompany(value => ({ ...value, taxContact: event.target.value }))} className="ui-field mt-1.5" placeholder="可稍后填写本人、会计或代理记账联系人" /></label>
          <div className="border-t border-border pt-4 md:col-span-2 xl:col-span-3"><p className="text-[10px] font-semibold text-text-secondary">基本存款账户与网银资料</p><p className="mt-1 text-[9px] text-text-muted">保存开户资料、银行客户号和操作员号；登录密码、UKey PIN 与验证码不进入业务数据。</p></div>
          <label className="text-[10px] font-semibold text-text-secondary">开户银行<select value={company.bankName || ''} onChange={event => setCompany(value => ({ ...value, bankName: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">请选择</option><option>杭州银行</option><option>工商银行</option><option>农业银行</option><option>中国银行</option><option>建设银行</option><option>招商银行</option><option>其他</option></select></label>
          <label className="text-[10px] font-semibold text-text-secondary">开户网点<input value={company.bankBranch || ''} onChange={event => setCompany(value => ({ ...value, bankBranch: event.target.value }))} className="ui-field mt-1.5" /></label>
          <label className="text-[10px] font-semibold text-text-secondary">开户日期<input type="date" value={company.bankAccountOpenedDate || ''} onChange={event => setCompany(value => ({ ...value, bankAccountOpenedDate: event.target.value }))} className="ui-field mt-1.5" /></label>
          <label className="text-[10px] font-semibold text-text-secondary">银行客户号<input value={company.bankCustomerNumber || ''} onChange={event => setCompany(value => ({ ...value, bankCustomerNumber: event.target.value.replace(/\D/g, '') }))} className="ui-field mt-1.5 font-mono" inputMode="numeric" autoComplete="off" /></label>
          <label className="text-[10px] font-semibold text-text-secondary">网银操作员号<input value={company.bankOperatorNumber || ''} onChange={event => setCompany(value => ({ ...value, bankOperatorNumber: event.target.value.replace(/\s/g, '') }))} className="ui-field mt-1.5 font-mono" autoComplete="off" /></label>
          <label className="text-[10px] font-semibold text-text-secondary">网银登录安全状态<select value={company.onlineBankingSecurityStatus || '未确认'} onChange={event => setCompany(value => ({ ...value, onlineBankingSecurityStatus: event.target.value }))} className="ui-field ui-select mt-1.5"><option>未确认</option><option>初始密码待修改</option><option>已修改并安全保管</option><option>已停用网银</option></select></label>
          <label className="text-[10px] font-semibold text-text-secondary">银行账号<input value={company.bankAccount || ''} onChange={event => setCompany(value => ({ ...value, bankAccount: event.target.value.replace(/\D/g, '') }))} className="ui-field mt-1.5 font-mono" inputMode="numeric" autoComplete="off" /></label>
          <label className="text-[10px] font-semibold text-text-secondary">基本存款账户编号<input value={company.basicDepositAccountNumber || ''} onChange={event => setCompany(value => ({ ...value, basicDepositAccountNumber: event.target.value.toUpperCase() }))} className="ui-field mt-1.5 font-mono" autoComplete="off" /></label>
          <label className="text-[10px] font-semibold text-text-secondary">存款账户账号报告<select value={company.bankAccountTaxReportStatus || '未确认'} onChange={event => setCompany(value => ({ ...value, bankAccountTaxReportStatus: event.target.value }))} className="ui-field ui-select mt-1.5"><option>未确认</option><option>待办理</option><option>已报告</option><option>不适用</option></select></label>
          <label className="text-[10px] font-semibold text-text-secondary">银税三方协议<select value={company.taxPaymentAgreementStatus || '未确认'} onChange={event => setCompany(value => ({ ...value, taxPaymentAgreementStatus: event.target.value }))} className="ui-field ui-select mt-1.5"><option>未确认</option><option>待签署</option><option>待验证</option><option>已生效</option><option>不适用</option></select></label>
          <div className="flex flex-wrap items-center gap-2 md:col-span-2 xl:col-span-3"><button type="button" onClick={() => void saveCompany()} disabled={saving} className="btn-primary flex items-center gap-1.5 px-4 py-2 text-xs disabled:opacity-45">{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}保存资料</button>{snapshot.company && <button type="button" onClick={() => setEditingCompany(false)} className="btn-ghost px-4 py-2 text-xs">取消</button>}<span className="text-[9px] text-text-muted">只需公司全称即可先保存草稿</span></div>
        </div> : <div className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2 xl:grid-cols-4">{[
          ['公司名称', company.name], ['信用代码', company.creditCode], ['企业类型', company.entityType], ['法定代表人', company.legalRepresentative],
          ['主管地区', company.taxRegion], ['纳税人类型', company.taxpayerType], ['增值税周期', company.vatFilingCycle], ['记账方式', company.bookkeepingMode],
          ['会计制度', company.accountingStandard], ['员工情况', company.employeeStatus], ['财税负责人', company.taxContact], ['成立日期', company.establishedDate],
          ['开户银行', [company.bankName, company.bankBranch].filter(Boolean).join(' · ')], ['银行账号', company.bankAccount ? `•••• ${company.bankAccount.slice(-4)}` : ''], ['基本存款账户编号', company.basicDepositAccountNumber], ['开户日期', company.bankAccountOpenedDate],
          ['银行客户号', company.bankCustomerNumber ? `•••• ${company.bankCustomerNumber.slice(-4)}` : ''], ['网银操作员号', company.bankOperatorNumber], ['网银登录安全状态', company.onlineBankingSecurityStatus], ['账户税务报告', company.bankAccountTaxReportStatus], ['银税三方协议', company.taxPaymentAgreementStatus],
        ].map(([label, value]) => <div key={label}><p className="text-[9px] text-text-muted">{label}</p><p className="mt-1 text-[11px] font-semibold">{value || '尚未填写'}</p></div>)}</div>}
        <div className="m-5 grid gap-3 rounded-xl border border-[#e7dfc8] bg-[#fffdf7] p-4 md:grid-cols-[auto_1fr]">
          <CircleAlert size={17} className="text-[#a66c24]" /><div><p className="text-[11px] font-semibold">最重要的是按电子税务局核定结果填写</p><p className="mt-1 text-[10px] leading-5 text-text-secondary">纳税人类型、税（费）种、征收方式和申报周期不能只根据公司名称推断。登录主管地区电子税务局核对后，再用这里的提醒功能。</p></div>
        </div>
      </div>}

      {view === 'tax' && <StartupTaxCalendar snapshot={snapshot} actions={actions} saving={saving} />}

      {view === 'documents' && <div>
        <div className="grid gap-4 border-b border-border bg-[#fbfcfa] p-5 lg:grid-cols-[minmax(0,1fr)_260px_190px_auto] lg:items-end"><div><h3 className="text-sm font-semibold">公司证照文件库</h3><p className="mt-1 text-[10px] leading-5 text-text-muted">文件按公司工作区隔离保存；支持 JPG、PNG、WebP、PDF、Word、Excel 和 TXT，单个不超过 20 MB。</p></div><label className="text-[10px] font-semibold text-text-secondary">文件分类<select value={documentCategory} onChange={event => setDocumentCategory(event.target.value as StartupCompanyDocumentCategory)} className="ui-field ui-select mt-1.5">{Object.entries(DOCUMENT_CATEGORY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-[10px] font-semibold text-text-secondary">到期日（可选）<input type="date" value={documentExpiryDate} onChange={event => setDocumentExpiryDate(event.target.value)} className="ui-field mt-1.5" /></label><div><input ref={fileInput} type="file" className="sr-only" accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadDocument(file); }} /><button type="button" onClick={() => fileInput.current?.click()} disabled={saving} className="btn-primary flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-[10px] disabled:opacity-45">{saving ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}选择并上传</button></div></div>
        {documentNotice && <div className={`mx-5 mt-4 rounded-lg px-3 py-2 text-[10px] ${/失败|不能|不符合/.test(documentNotice) ? 'bg-red-50 text-red-700' : 'bg-[#edf5ef] text-accent'}`}>{documentNotice}</div>}
        {snapshot.documents.length > 0 && <div className="flex gap-2 overflow-x-auto border-b border-border px-5 py-3" aria-label="文件分类筛选"><button type="button" onClick={() => setDocumentFilter('all')} className={`shrink-0 rounded-full px-3 py-1.5 text-[9px] font-semibold ${documentFilter === 'all' ? 'bg-accent text-white' : 'bg-[#f0f2ef] text-text-secondary'}`}>全部 {snapshot.documents.length}</button>{Object.entries(DOCUMENT_CATEGORY).map(([value, label]) => { const count = snapshot.documents.filter(document => document.category === value).length; return <button key={value} type="button" onClick={() => setDocumentFilter(value as StartupCompanyDocumentCategory)} className={`shrink-0 rounded-full px-3 py-1.5 text-[9px] font-semibold ${documentFilter === value ? 'bg-accent text-white' : 'bg-[#f0f2ef] text-text-secondary'}`}>{label} {count}</button>; })}</div>}
        {filteredDocuments.length ? <div className="divide-y divide-border">{filteredDocuments.map(document => { const previewable = document.mimeType.startsWith('image/') || document.mimeType === 'application/pdf' || document.mimeType === 'text/plain'; return <div key={document.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#edf5ef] text-accent"><FileText size={16} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-[11px] font-semibold">{document.name}</p><span className="rounded-full bg-[#f0f2ef] px-2 py-0.5 text-[8px] text-text-muted">{DOCUMENT_CATEGORY[document.category]}</span></div><p className="mt-1 text-[9px] text-text-muted">{formatBytes(document.sizeBytes)} · 上传于 {new Date(document.uploadedAt).toLocaleDateString('zh-CN')}{document.expiryDate ? ` · 到期 ${document.expiryDate}` : ''}</p>{!previewable && <p className="mt-1 text-[8px] text-text-muted">Word / Excel 暂不支持在线预览，请下载查看</p>}</div><div className="flex gap-2">{previewable && <button type="button" onClick={() => void openPreview(document)} disabled={previewLoading === document.id} className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-[9px] disabled:opacity-45">{previewLoading === document.id ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />}预览</button>}<button type="button" onClick={() => void actions.downloadDocument(document).catch(error => setDocumentNotice(error instanceof Error ? error.message : '下载失败'))} className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-[9px]"><Download size={11} />下载</button><button type="button" onClick={() => { if (window.confirm(`确认删除“${document.name}”吗？此操作无法撤销。`)) void actions.deleteDocument(document.id); }} disabled={saving} className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-[9px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-45"><Trash2 size={11} />删除</button></div></div>; })}</div> : <div className="grid min-h-[330px] place-items-center px-6 text-center"><div><FileArchive size={29} className="mx-auto text-text-muted" /><p className="mt-3 text-xs font-semibold">{snapshot.documents.length ? '这个分类还没有文件' : '还没有公司文件'}</p><p className="mt-1 max-w-lg text-[10px] leading-5 text-text-muted">{snapshot.documents.length ? '切换到其他分类，或为当前分类上传文件。' : '建议先上传营业执照和最新公司章程，再按实际情况补充银行、税务、合同、人事和知识产权资料。'}</p></div></div>}
        <div className="m-5 grid gap-3 rounded-xl border border-[#e7dfc8] bg-[#fffdf7] p-4 md:grid-cols-3">{[
          ['不要上传', '网银密码、UKey PIN、电子税务局密码、私钥或短信验证码'],
          ['版本规则', '章程、股东协议和证照变更后保留签署日期并上传最新版本'],
          ['到期提醒', '证书、商标、域名等有期限的文件请填写到期日'],
        ].map(([title, detail]) => <div key={title}><p className="text-[10px] font-semibold">{title}</p><p className="mt-1 text-[9px] leading-4 text-text-muted">{detail}</p></div>)}</div>
      </div>}

      {view === 'governance' && <div>
        <div className="border-b border-border bg-[#fbfcfa] px-5 py-4"><h3 className="text-sm font-semibold">创业公司治理清单</h3><p className="mt-1 text-[10px] text-text-muted">公司治理事项在本模块独立跟进，不进入日常业务协作中心。</p></div>
        <div className="divide-y divide-border">{GOVERNANCE_ITEMS.map(item => { const task = governanceTasks.find(candidate => candidate.title === item.title); const documentReady = item.category ? snapshot.documents.some(document => document.category === item.category) : false; const complete = task?.status === 'completed' || documentReady; return <div key={item.title} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${complete ? 'bg-[#e8f2eb] text-accent' : 'bg-[#f1f2ef] text-text-muted'}`}>{complete ? <Check size={14} /> : <CircleAlert size={14} />}</span><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold">{item.title}</p><p className="mt-1 text-[9px] leading-4 text-text-muted">{item.detail}</p></div>{complete ? <span className="rounded-full bg-[#edf5ef] px-3 py-1.5 text-[9px] font-semibold text-accent">{documentReady ? '已有对应文件' : '任务已完成'}</span> : task ? <span className="rounded-full bg-[#f3f4f2] px-3 py-1.5 text-[9px] font-semibold text-text-secondary">已加入待办 · {task.owner}</span> : <button type="button" onClick={() => void addGovernanceTask(item.title, item.priority)} disabled={saving} className="btn-ghost flex items-center justify-center gap-1.5 px-3 py-2 text-[9px] disabled:opacity-45"><Plus size={11} />加入治理待办</button>}</div>; })}</div>
        <div className="grid gap-3 border-t border-border bg-[#fbfcfa] p-5 md:grid-cols-3">{[
          { icon: Landmark, title: '钱与账户', detail: '公司钱和个人钱分开；付款、报销、借款都保留业务依据。' },
          { icon: Users, title: '股东与人员', detail: '重大决策留书面记录，股权、劳动和保密约定及时签署。' },
          { icon: ShieldCheck, title: '印章与权限', detail: '按最小权限保管公章、银行、税务和系统管理员权限。' },
        ].map(item => { const Icon = item.icon; return <div key={item.title} className="rounded-xl border border-border bg-white p-4"><Icon size={15} className="text-accent" /><p className="mt-3 text-[10px] font-semibold">{item.title}</p><p className="mt-1 text-[9px] leading-4 text-text-muted">{item.detail}</p></div>; })}</div>
      </div>}
    </section>
    {preview && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label={`预览 ${preview.document.name}`} onMouseDown={event => { if (event.target === event.currentTarget) setPreview(null); }}><div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3"><div className="min-w-0"><p className="truncate text-[11px] font-semibold">{preview.document.name}</p><p className="mt-0.5 text-[9px] text-text-muted">{DOCUMENT_CATEGORY[preview.document.category]} · {formatBytes(preview.document.sizeBytes)}</p></div><div className="flex gap-2"><button type="button" onClick={() => void actions.downloadDocument(preview.document)} className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-[9px]"><Download size={11} />下载</button><button type="button" onClick={() => setPreview(null)} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-secondary hover:bg-[#f4f6f3]" aria-label="关闭预览"><X size={14} /></button></div></div><div className="min-h-0 flex-1 bg-[#eef1ed] p-3">{preview.document.mimeType.startsWith('image/') ? <img src={preview.url} alt={preview.document.name} className="h-full w-full object-contain" /> : <iframe src={preview.url} title={preview.document.name} className="h-full w-full rounded-lg border-0 bg-white" />}</div></div></div>}
  </div>;
}
