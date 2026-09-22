import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Download,
  Eye,
  ExternalLink,
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
  WalletCards,
  X,
} from 'lucide-react';
import type {
  StartupCompanyDocument,
  StartupCompanyDocumentCategory,
  StartupCompanyProfile,
  StartupHubSnapshot,
  StartupTaxRecord,
} from '../../shared/startupHub';
import type { StartupHubActions } from '../lib/startupHubUi';

interface Props { snapshot: StartupHubSnapshot; actions: StartupHubActions; saving: boolean }
type CompanyView = 'profile' | 'tax' | 'documents' | 'governance';
type CompanyDraft = Omit<StartupCompanyProfile, 'updatedAt' | 'updatedBy'>;

const EMPTY_COMPANY: CompanyDraft = {
  name: '', taxpayerType: '未确认', taxRegion: '', taxContact: '', creditCode: '', entityType: '',
  legalRepresentative: '', establishedDate: '', industry: '', accountingStandard: '', bookkeepingMode: '',
  vatFilingCycle: '未确认', incomeTaxFilingCycle: '按季', employeeStatus: '未确认',
};

const TAX_STATUS: Record<StartupTaxRecord['status'], string> = {
  draft: '待整理', preparing: '资料准备中', ready: '待申报', filed: '已申报', paid: '已缴款 / 完成',
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
const TAX_TYPES = ['增值税及附加', '企业所得税预缴', '企业所得税年度汇算清缴', '个人所得税代扣代缴', '印花税', '财务报表报送', '工商年度报告', '其他事项'];

const GOVERNANCE_ITEMS = [
  { title: '归档营业执照电子版', detail: '保留清晰扫描件，变更后及时替换旧版本', category: 'license' as const, priority: 'high' as const },
  { title: '归档公司章程与股东协议', detail: '记录签署版本、股东签字页和历次修订', category: 'articles' as const, priority: 'high' as const },
  { title: '核对银行账户税务备案与三方协议', detail: '开户后核对存款账户报告和自动扣税协议', category: 'bank' as const, priority: 'high' as const },
  { title: '建立印章清单与使用审批规则', detail: '明确公章、合同章、财务章、法人章保管人', priority: 'medium' as const },
  { title: '建立知识产权资产清单', detail: '跟踪商标、域名、软件著作权及续费日期', category: 'ip' as const, priority: 'medium' as const },
  { title: '核对员工劳动合同与社保手续', detail: '有员工时确认合同、个税、社保和公积金责任', category: 'hr' as const, priority: 'high' as const },
  { title: '安排本年度工商年度报告', detail: '企业通常需在每年 1 月 1 日至 6 月 30 日完成年报公示', priority: 'medium' as const },
];

const TAX_KNOWLEDGE = [
  {
    id: 'first', title: '第一次报税，从哪里开始？', icon: BookOpenCheck,
    summary: '先查清“系统要求你报什么”，不要凭感觉自行创建税种。',
    steps: ['登录主管地区电子税务局，进入纳税人信息或一户式查询', '抄下税（费）种、申报周期、征收方式和首次申报期限', '确认会计制度备案、银行账户报告与扣税三方协议', '确认开票权限和税务数字账户', '把电子税务局待办逐条录入本系统并指定负责人'],
  },
  {
    id: 'monthly', title: '每月固定做什么？', icon: CalendarClock,
    summary: '固定关账流程比临近截止日临时找资料更安全。',
    steps: ['下载银行流水和支付平台流水', '整理销项、进项发票及未到票清单', '核对工资、个税、社保和报销', '核对合同、收入确认和成本归属期间', '完成账务复核后申报、缴款并归档申报表与回执'],
  },
  {
    id: 'zero', title: '没有收入，要不要申报？', icon: ReceiptText,
    summary: '是否需要零申报，取决于电子税务局已核定的税种和当期义务。',
    steps: ['不要因为没有收入就忽略电子税务局待办', '先确认当期是否有已开票、未开票收入或应税合同', '工资、印花税、财务报表等义务可能独立存在', '无法判断时，在截止日前咨询主管税务机关或涉税专业人员'],
  },
  {
    id: 'invoice', title: '发票和报销怎么管？', icon: WalletCards,
    summary: '发票不是有票就能入账，必须对应真实业务。',
    steps: ['每张票关联真实合同、付款和验收证据', '区分公司支出与股东个人支出', '检查抬头、税号、金额、项目和开票日期', '建立未到票、红冲、作废和异常凭证清单', '抵扣或税前扣除口径交由财税人员复核'],
  },
];

function localDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function taxSuggestion(taxType: string, company: CompanyDraft) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (taxType === '增值税及附加') {
    if (company.vatFilingCycle === '按季') {
      const quarter = Math.floor((month - 1) / 3) + 1;
      const nextMonth = quarter * 3 + 1;
      return nextMonth > 12
        ? { period: `${year} 年第 ${quarter} 季度`, dueDate: localDate(year + 1, 1, 15) }
        : { period: `${year} 年第 ${quarter} 季度`, dueDate: localDate(year, nextMonth, 15) };
    }
    const nextMonth = month === 12 ? 1 : month + 1;
    return { period: `${year} 年 ${month} 月`, dueDate: localDate(month === 12 ? year + 1 : year, nextMonth, 15) };
  }
  if (taxType === '企业所得税预缴') {
    const quarter = Math.floor((month - 1) / 3) + 1;
    const nextMonth = quarter * 3 + 1;
    return nextMonth > 12
      ? { period: `${year} 年第 ${quarter} 季度`, dueDate: localDate(year + 1, 1, 15) }
      : { period: `${year} 年第 ${quarter} 季度`, dueDate: localDate(year, nextMonth, 15) };
  }
  if (taxType === '企业所得税年度汇算清缴') return { period: `${year} 年度`, dueDate: localDate(year + 1, 5, 31) };
  if (taxType === '个人所得税代扣代缴') {
    const nextMonth = month === 12 ? 1 : month + 1;
    return { period: `${year} 年 ${month} 月`, dueDate: localDate(month === 12 ? year + 1 : year, nextMonth, 15) };
  }
  if (taxType === '工商年度报告') return { period: `${year} 年度`, dueDate: localDate(year + 1, 6, 30) };
  return { period: `${year} 年`, dueDate: '' };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function taxUrgency(record: StartupTaxRecord) {
  if (record.status === 'paid' || record.status === 'filed') return { label: '已完成', className: 'bg-[#edf5ef] text-accent' };
  if (!record.dueDate) return { label: '未设截止日', className: 'bg-[#f2f3f1] text-text-muted' };
  const days = Math.ceil((new Date(`${record.dueDate}T23:59:59`).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `逾期 ${Math.abs(days)} 天`, className: 'bg-red-50 text-red-700' };
  if (days <= 7) return { label: `${days} 天内到期`, className: 'bg-[#fff4e8] text-[#a6572a]' };
  return { label: `${days} 天后`, className: 'bg-[#f2f3f1] text-text-muted' };
}

export default function StartupCompanyCenter({ snapshot, actions, saving }: Props) {
  const [view, setView] = useState<CompanyView>(snapshot.company ? 'tax' : 'profile');
  const [editingCompany, setEditingCompany] = useState(!snapshot.company);
  const [company, setCompany] = useState<CompanyDraft>(EMPTY_COMPANY);
  const [profileNotice, setProfileNotice] = useState('');
  const [showTaxForm, setShowTaxForm] = useState(false);
  const [tax, setTax] = useState({ taxType: '增值税及附加', period: '', dueDate: '', owner: '', notes: '' });
  const [knowledgeId, setKnowledgeId] = useState('first');
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
    setTax(value => ({ ...value, owner: value.owner || snapshot.company?.taxContact || '' }));
  }, [snapshot.company]);

  const members = useMemo(() => [company.taxContact, ...snapshot.members.filter(item => item.status !== 'disabled').map(item => item.name)].filter(Boolean), [company.taxContact, snapshot.members]);
  const pendingTaxes = snapshot.taxRecords.filter(item => !['filed', 'paid'].includes(item.status));
  const overdueTaxes = pendingTaxes.filter(item => item.dueDate && new Date(`${item.dueDate}T23:59:59`).getTime() < Date.now());
  const profileFields = [company.name, company.creditCode, company.entityType, company.taxpayerType !== '未确认' ? company.taxpayerType : '', company.taxRegion, company.taxContact, company.legalRepresentative, company.establishedDate, company.industry, company.accountingStandard, company.bookkeepingMode, company.vatFilingCycle !== '未确认' ? company.vatFilingCycle : '', company.employeeStatus !== '未确认' ? company.employeeStatus : ''];
  const profileProgress = Math.round(profileFields.filter(Boolean).length / profileFields.length * 100);
  const activeKnowledge = TAX_KNOWLEDGE.find(item => item.id === knowledgeId) || TAX_KNOWLEDGE[0];
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

  const openTaxForm = (taxType = '增值税及附加') => {
    const suggestion = taxSuggestion(taxType, company);
    setTax({ taxType, period: suggestion.period, dueDate: suggestion.dueDate, owner: company.taxContact || members[0] || '', notes: '' });
    setShowTaxForm(true);
  };

  const createTaxRecord = async () => {
    if (!tax.taxType || !tax.period || !tax.owner.trim()) return;
    await actions.create('taxRecords', {
      title: tax.taxType,
      taxType: tax.taxType,
      period: tax.period,
      dueDate: tax.dueDate || undefined,
      owner: tax.owner,
      notes: tax.notes || undefined,
      status: 'draft',
    });
    setShowTaxForm(false);
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
      <button type="button" onClick={() => setView('governance')} className="section-panel p-4 text-left hover:border-border-bright"><p className="text-[9px] text-text-muted">公司治理待办</p><div className="mt-2 flex items-end justify-between"><strong className="text-2xl tracking-[-.04em]">{governanceTasks.filter(item => item.status !== 'completed').length}</strong><ShieldCheck size={16} className="text-accent" /></div><p className="mt-3 text-[9px] text-text-muted">与协作中心任务实时联动</p></button>
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
          <div className="flex flex-wrap items-center gap-2 md:col-span-2 xl:col-span-3"><button type="button" onClick={() => void saveCompany()} disabled={saving} className="btn-primary flex items-center gap-1.5 px-4 py-2 text-xs disabled:opacity-45">{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}保存资料</button>{snapshot.company && <button type="button" onClick={() => setEditingCompany(false)} className="btn-ghost px-4 py-2 text-xs">取消</button>}<span className="text-[9px] text-text-muted">只需公司全称即可先保存草稿</span></div>
        </div> : <div className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2 xl:grid-cols-4">{[
          ['公司名称', company.name], ['信用代码', company.creditCode], ['企业类型', company.entityType], ['法定代表人', company.legalRepresentative],
          ['主管地区', company.taxRegion], ['纳税人类型', company.taxpayerType], ['增值税周期', company.vatFilingCycle], ['记账方式', company.bookkeepingMode],
          ['会计制度', company.accountingStandard], ['员工情况', company.employeeStatus], ['财税负责人', company.taxContact], ['成立日期', company.establishedDate],
        ].map(([label, value]) => <div key={label}><p className="text-[9px] text-text-muted">{label}</p><p className="mt-1 text-[11px] font-semibold">{value || '尚未填写'}</p></div>)}</div>}
        <div className="m-5 grid gap-3 rounded-xl border border-[#e7dfc8] bg-[#fffdf7] p-4 md:grid-cols-[auto_1fr]">
          <CircleAlert size={17} className="text-[#a66c24]" /><div><p className="text-[11px] font-semibold">最重要的是按电子税务局核定结果填写</p><p className="mt-1 text-[10px] leading-5 text-text-secondary">纳税人类型、税（费）种、征收方式和申报周期不能只根据公司名称推断。登录主管地区电子税务局核对后，再用这里的提醒功能。</p></div>
        </div>
      </div>}

      {view === 'tax' && <div>
        <div className="grid border-b border-border xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
          <div className="border-b border-border p-5 xl:border-b-0 xl:border-r">
            <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold text-accent">新手从这里开始</p><h3 className="mt-1 text-lg font-semibold tracking-[-.03em]">第一次办税的 5 步清单</h3></div><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#edf5ef] text-accent"><BookOpenCheck size={17} /></span></div>
            <ol className="mt-5 space-y-3">{[
              ['查义务', '登录电子税务局，核对税费种、申报周期、征收方式和当期待办。'],
              ['定责任', '明确由本人、会计还是代理记账负责；本人仍要掌握截止日期。'],
              ['备资料', '每月整理银行流水、发票、工资社保、合同、报销和收入成本证据。'],
              ['先复核', '申报前核对账、表、票、款是否一致，异常事项先咨询再提交。'],
              ['留证据', '保存申报表、缴款凭证、财务报表和咨询记录，按月归档。'],
            ].map(([title, detail], index) => <li key={title} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[9px] font-bold text-white">{index + 1}</span><div><p className="text-[11px] font-semibold">{title}</p><p className="mt-1 text-[10px] leading-5 text-text-secondary">{detail}</p></div></li>)}</ol>
            <div className="mt-5 flex flex-wrap gap-2"><a href="https://www.chinatax.gov.cn/" target="_blank" rel="noreferrer" className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-[10px]">国家税务总局<ExternalLink size={11} /></a><a href="https://www.gsxt.gov.cn/index.html" target="_blank" rel="noreferrer" className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-[10px]">企业信用信息公示系统<ExternalLink size={11} /></a></div>
          </div>
          <div className="p-5"><p className="text-[10px] font-semibold">常见期限速查</p><div className="mt-3 divide-y divide-border rounded-xl border border-border bg-[#fbfcfa]">{[
            ['增值税', '按核定的月或季计税，通常在期满后 15 日内申报'],
            ['企业所得税预缴', '按核定的月或季预缴，通常在期满后 15 日内完成'],
            ['企业所得税汇算', '纳税年度结束后 5 个月内完成，通常到次年 5 月 31 日'],
            ['个人所得税代扣', '每月或每次代扣税款，通常在次月 15 日内申报缴纳'],
            ['企业年度报告', '通常每年 1 月 1 日至 6 月 30 日通过公示系统报送'],
          ].map(([title, detail]) => <div key={title} className="px-4 py-3"><p className="text-[10px] font-semibold">{title}</p><p className="mt-1 text-[9px] leading-4 text-text-muted">{detail}</p></div>)}</div><div className="mt-3 flex gap-2 rounded-lg border border-[#f0ddcf] bg-[#fff9f4] p-3 text-[9px] leading-4 text-[#78503d]"><AlertTriangle size={13} className="mt-0.5 shrink-0" />法定节假日可能顺延，税种和周期也因企业而异。这里给出的是管理提醒，最终日期以当期电子税务局为准。</div></div>
        </div>

        <div className="border-b border-border p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h3 className="text-sm font-semibold">建立本期申报计划</h3><p className="mt-1 text-[10px] text-text-muted">选择税种后自动给出所属期和建议日期，你确认后才会保存。</p></div><button type="button" onClick={() => openTaxForm()} className="btn-primary flex items-center justify-center gap-1.5 px-3 py-2 text-[10px]"><Plus size={12} />新增申报事项</button></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{['增值税及附加', '企业所得税预缴', '个人所得税代扣代缴', '企业所得税年度汇算清缴'].map(item => <button key={item} type="button" onClick={() => openTaxForm(item)} className="flex items-center justify-between rounded-xl border border-border bg-[#fbfcfa] px-3 py-3 text-left text-[10px] font-semibold hover:border-border-bright hover:bg-white"><span>{item}</span><ChevronRight size={12} className="text-text-muted" /></button>)}</div>
          {showTaxForm && <div className="mt-4 grid gap-3 rounded-xl border border-border bg-[#fbfcfa] p-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-[10px] font-semibold text-text-secondary">事项类型<select value={tax.taxType} onChange={event => { const type = event.target.value; const suggestion = taxSuggestion(type, company); setTax(value => ({ ...value, taxType: type, ...suggestion })); }} className="ui-field ui-select mt-1.5">{TAX_TYPES.map(option => <option key={option}>{option}</option>)}</select></label>
            <label className="text-[10px] font-semibold text-text-secondary">所属期<select value={tax.period} onChange={event => setTax(value => ({ ...value, period: event.target.value }))} className="ui-field ui-select mt-1.5"><option value={tax.period}>{tax.period || '请选择税种后生成'}</option>{Array.from({ length: 12 }, (_, index) => `${new Date().getFullYear()} 年 ${index + 1} 月`).filter(option => option !== tax.period).map(option => <option key={option}>{option}</option>)}{[1, 2, 3, 4].map(q => `${new Date().getFullYear()} 年第 ${q} 季度`).filter(option => option !== tax.period).map(option => <option key={option}>{option}</option>)}<option>{new Date().getFullYear()} 年度</option></select></label>
            <label className="text-[10px] font-semibold text-text-secondary">建议截止日期<input type="date" value={tax.dueDate} onChange={event => setTax(value => ({ ...value, dueDate: event.target.value }))} className="ui-field mt-1.5" /></label>
            <label className="text-[10px] font-semibold text-text-secondary">负责人<input list="company-tax-owners" value={tax.owner} onChange={event => setTax(value => ({ ...value, owner: event.target.value }))} className="ui-field mt-1.5" /><datalist id="company-tax-owners">{members.map(member => <option key={member} value={member} />)}</datalist></label>
            <label className="text-[10px] font-semibold text-text-secondary md:col-span-2">准备说明<textarea value={tax.notes} onChange={event => setTax(value => ({ ...value, notes: event.target.value }))} className="ui-field mt-1.5 min-h-20" placeholder="记录本期需要核对的发票、流水、工资、合同或异常事项" /></label>
            <div className="flex gap-2 md:col-span-2 xl:col-span-3"><button type="button" onClick={() => void createTaxRecord()} disabled={saving || !tax.period || !tax.owner.trim()} className="btn-primary px-4 py-2 text-[10px] disabled:opacity-45">确认并建立事项</button><button type="button" onClick={() => setShowTaxForm(false)} className="btn-ghost px-4 py-2 text-[10px]">取消</button></div>
          </div>}
        </div>

        <div className="grid xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,.8fr)]">
          <div className="border-b border-border p-5 xl:border-b-0 xl:border-r"><h3 className="text-sm font-semibold">申报执行台</h3><p className="mt-1 text-[10px] text-text-muted">每个事项都有截止风险、当前状态和下一步。</p>{snapshot.taxRecords.length ? <div className="mt-4 space-y-3">{snapshot.taxRecords.map(item => { const urgency = taxUrgency(item); const next = item.status === 'draft' ? '整理账、票、款和合同资料' : item.status === 'preparing' ? '完成账表复核并确认申报口径' : item.status === 'ready' ? '登录电子税务局提交申报' : item.status === 'filed' ? '核对扣款并归档回执' : '已完成'; return <div key={item.id} className="rounded-xl border border-border bg-[#fbfcfa] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><p className="text-[11px] font-semibold">{item.title}</p><span className={`rounded-full px-2 py-0.5 text-[8px] font-semibold ${urgency.className}`}>{urgency.label}</span></div><p className="mt-1 text-[9px] text-text-muted">{item.period} · {item.owner}{item.dueDate ? ` · ${item.dueDate}` : ''}</p></div><select value={item.status} onChange={event => void actions.update('taxRecords', item.id, { status: event.target.value as StartupTaxRecord['status'] })} disabled={saving} className="rounded-lg border border-border bg-white px-2 py-1 text-[9px] font-semibold">{Object.entries(TAX_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="mt-3 flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-[9px] text-text-secondary"><ArrowRight size={11} className="mt-0.5 shrink-0 text-accent" /><span><strong>下一步：</strong>{next}</span></div>{item.notes && <p className="mt-2 text-[9px] leading-4 text-text-muted">{item.notes}</p>}</div>; })}</div> : <div className="mt-4 grid min-h-[230px] place-items-center rounded-xl border border-dashed border-border text-center"><div><CalendarClock size={25} className="mx-auto text-text-muted" /><p className="mt-3 text-xs font-semibold">还没有申报事项</p><p className="mt-1 text-[10px] text-text-muted">先从电子税务局查到真实待办，再建立本期计划。</p></div></div>}</div>
          <div className="p-5"><h3 className="text-sm font-semibold">不会处理时怎么做</h3><div className="mt-3 grid grid-cols-2 gap-2">{TAX_KNOWLEDGE.map(item => <button key={item.id} type="button" onClick={() => setKnowledgeId(item.id)} className={`rounded-lg px-3 py-2 text-left text-[9px] font-semibold ${knowledgeId === item.id ? 'bg-[#e8f2eb] text-accent' : 'border border-border bg-white text-text-secondary'}`}>{item.title}</button>)}</div><div className="mt-4 rounded-xl border border-border bg-[#fbfcfa] p-4"><div className="flex items-center gap-2"><activeKnowledge.icon size={15} className="text-accent" /><p className="text-[11px] font-semibold">{activeKnowledge.title}</p></div><p className="mt-2 text-[9px] leading-4 text-text-muted">{activeKnowledge.summary}</p><ul className="mt-3 space-y-2">{activeKnowledge.steps.map(step => <li key={step} className="flex gap-2 text-[9px] leading-4 text-text-secondary"><CheckCircle2 size={11} className="mt-0.5 shrink-0 text-accent" />{step}</li>)}</ul></div></div>
        </div>
      </div>}

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
        <div className="border-b border-border bg-[#fbfcfa] px-5 py-4"><h3 className="text-sm font-semibold">创业公司治理清单</h3><p className="mt-1 text-[10px] text-text-muted">不是静态说明：加入后会进入协作中心，由负责人持续跟进和完成。</p></div>
        <div className="divide-y divide-border">{GOVERNANCE_ITEMS.map(item => { const task = governanceTasks.find(candidate => candidate.title === item.title); const documentReady = item.category ? snapshot.documents.some(document => document.category === item.category) : false; const complete = task?.status === 'completed' || documentReady; return <div key={item.title} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${complete ? 'bg-[#e8f2eb] text-accent' : 'bg-[#f1f2ef] text-text-muted'}`}>{complete ? <Check size={14} /> : <CircleAlert size={14} />}</span><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold">{item.title}</p><p className="mt-1 text-[9px] leading-4 text-text-muted">{item.detail}</p></div>{complete ? <span className="rounded-full bg-[#edf5ef] px-3 py-1.5 text-[9px] font-semibold text-accent">{documentReady ? '已有对应文件' : '任务已完成'}</span> : task ? <span className="rounded-full bg-[#f3f4f2] px-3 py-1.5 text-[9px] font-semibold text-text-secondary">已加入待办 · {task.owner}</span> : <button type="button" onClick={() => void addGovernanceTask(item.title, item.priority)} disabled={saving} className="btn-ghost flex items-center justify-center gap-1.5 px-3 py-2 text-[9px] disabled:opacity-45"><Plus size={11} />加入协作待办</button>}</div>; })}</div>
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
