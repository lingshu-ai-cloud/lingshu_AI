import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Segmented } from 'antd';
import LsPageHeader from './ui/LsPageHeader';
import { CheckCircle2, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Clipboard, KeyRound, Link2, Loader2, RefreshCcw } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { clearDeliveryTenantRequestId, deliveryTenantRequestId } from '../lib/adminDeliveryTenantRequest';
import AdminContentOpsAlerts from './AdminContentOpsAlerts';
import AdminSocialAccountSetup from './AdminSocialAccountSetup';
import AdminSocialWorkPackageCenter from './AdminSocialWorkPackageCenter';
import { DeploymentProgressStrip, PlatformWizard, keyOf, appFor, jsonFetch } from './AdminDeliveryComponents';
import type { DeliveryApp, TenantCard, GeneratedInvite, Draft, TestState, AssistLinkState, ProgressStageKey, KnowledgeCompletionState } from './AdminDeliveryComponents';
export default function AdminDeliveryPage() {
  const [tenants, setTenants] = useState<TenantCard[]>([]);
  const [tenantView, setTenantView] = useState<'customer' | 'trial'>('customer');
  const [expandedTenantIds, setExpandedTenantIds] = useState<Set<string>>(() => new Set());
  const [knowledgeCompletion, setKnowledgeCompletion] = useState<KnowledgeCompletionState | null>(null);
  const [drafts, setDrafts] = useState<Draft>({});
  const [tests, setTests] = useState<TestState>({});
  const [assistLinks, setAssistLinks] = useState<AssistLinkState>({});
  const [progressBusyKey, setProgressBusyKey] = useState('');
  const [tenantDialogOpen, setTenantDialogOpen] = useState(false);
  const [tenantForm, setTenantForm] = useState({ companyName: '', contactName: '', industry: '', notes: '' });
  const [generatedInvite, setGeneratedInvite] = useState<GeneratedInvite | null>(null);
  const [copiedInvite, setCopiedInvite] = useState<'code' | 'url' | ''>('');
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingAppKeys, setSavingAppKeys] = useState<Set<string>>(() => new Set());
  const [saveToast, setSaveToast] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasUnsavedDrafts = useMemo(() => Object.values(drafts).some(draft => Object.keys(draft ?? {}).length > 0), [drafts]);

  const load = async ({ background = false }: { background?: boolean } = {}) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const data = await jsonFetch('/api/overseas/admin/delivery/platform-apps');
      setTenants(data.tenants ?? []);
      fetch('/api/overseas/enterprise/knowledge-completion', { headers: authHeader() })
        .then(resp => resp.ok ? resp.json() : null)
        .then(result => {
          if (typeof result?.completed === 'number') setKnowledgeCompletion({ completed: result.completed, total: result.total || 6 });
        })
        .catch(() => setKnowledgeCompletion(null));
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败');
    } finally {
      if (background) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (loading || !scrollContainerRef.current) return;
    const savedPosition = Number(sessionStorage.getItem('lingshu:admin-delivery:scroll') || 0);
    if (!Number.isFinite(savedPosition) || savedPosition <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = savedPosition;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading]);

  useEffect(() => {
    if (!saveToast) return;
    const timer = window.setTimeout(() => setSaveToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [saveToast]);

  useEffect(() => {
    if (!hasUnsavedDrafts) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedDrafts]);

  const openInviteDialog = () => {
    setGeneratedInvite(null);
    setCopiedInvite('');
    setError('');
    setTenantDialogOpen(true);
  };

  const closeInviteDialog = () => {
    setTenantDialogOpen(false);
    setGeneratedInvite(null);
    setCopiedInvite('');
  };

  const copyInvite = async (kind: 'code' | 'url', value: string) => {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    setCopiedInvite(kind);
  };

  const save = async (app: DeliveryApp, options: { silent?: boolean } = {}) => {
    const appKey = keyOf(app.tenantId, app.platform);
    const draft = drafts[appKey] ?? {};
    setSavingAppKeys(current => new Set(current).add(appKey));
    setError('');
    try {
      await jsonFetch(`/api/overseas/admin/delivery/platform-apps/${app.tenantId}/${app.platform}`, {
        method: 'PUT',
        body: JSON.stringify({
          appId: draft.appId ?? app.appId,
          appSecret: draft.appSecret ?? '',
          waConfigId: draft.waConfigId ?? app.waConfigId,
          businessId: draft.businessId ?? app.businessId,
          wabaId: draft.wabaId ?? app.wabaId,
          phoneNumberId: draft.phoneNumberId ?? app.phoneNumberId,
          waPublicNumber: draft.waPublicNumber ?? app.waPublicNumber,
          pageId: draft.pageId ?? app.pageId,
          igUserId: draft.igUserId ?? app.igUserId,
          youtubeChannelId: draft.youtubeChannelId ?? app.youtubeChannelId, webhookVerifyToken: draft.webhookVerifyToken ?? '',
          wecomEncodingAesKey: draft.wecomEncodingAesKey ?? '',
          tokenType: draft.tokenType ?? app.tokenType,
          accessToken: draft.accessToken ?? '',
          tokenExpiresAt: draft.tokenExpiresAt ?? app.tokenExpiresAt,
          status: draft.status ?? app.status,
          checklist: { ...(app.checklist ?? {}), ...(draft.checklist ?? {}) },
          notes: draft.notes ?? app.notes,
        }),
      });
      setDrafts(current => {
        const next = { ...current };
        delete next[appKey];
        return next;
      });
      if (!options.silent) {
        setMessage('配置已保存');
        setSaveToast('配置保存成功');
      }
      await load({ background: true });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '配置保存失败');
      return false;
    } finally {
      setSavingAppKeys(current => {
        const next = new Set(current);
        next.delete(appKey);
        return next;
      });
    }
  };

  const test = async (app: DeliveryApp, kind: string) => {
    const appKey = keyOf(app.tenantId, app.platform);
    setTests(current => ({ ...current, [appKey]: { ...current[appKey], [kind]: 'running' } }));
    try {
      const data = await jsonFetch(`/api/overseas/admin/delivery/platform-apps/${app.tenantId}/${app.platform}/test/${kind}`, { method: 'POST' });
      setTests(current => ({ ...current, [appKey]: { ...current[appKey], [kind]: 'ok' } }));
      const autoCheckId = {
        whatsapp: 'whatsapp_test_passed',
        pages: 'pages_test_passed',
        webhook: 'webhook_test_passed',
        google: 'google_test_passed',
        tiktok: 'tiktok_test_passed',
        wecom_webhook: 'wecom_callback_verified',
        wecom: 'wecom_message_test_passed',
      }[kind];
      if (autoCheckId) {
        await load({ background: true });
      }
      setMessage(data.message || '自检通过');
    } catch (err) {
      setTests(current => ({ ...current, [appKey]: { ...current[appKey], [kind]: 'error' } }));
      setError(err instanceof Error ? err.message : '自检失败');
    }
  };

  const complete = async (app: DeliveryApp) => {
    const appKey = keyOf(app.tenantId, app.platform);
    const draft = drafts[appKey] ?? {};
    if (Object.keys(draft).length > 0) {
      const saved = await save(app, { silent: true });
      if (!saved) return;
    }
    await jsonFetch(`/api/overseas/admin/delivery/platform-apps/${app.tenantId}/${app.platform}/complete`, {
      method: 'POST',
      body: JSON.stringify({ notes: draft.notes ?? app.notes }),
    });
    setMessage('已标记交付完成，客户端将显示“已由专属顾问配置”。');
    await load({ background: true });
  };

  const createTenant = async () => {
    const companyName = tenantForm.companyName.trim();
    if (!companyName) {
      setError('公司名称必填');
      return;
    }
    setCreatingTenant(true);
    setError('');
    try {
      const requestId = await deliveryTenantRequestId(tenantForm);
      const data = await jsonFetch('/api/overseas/admin/delivery/tenants', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestId },
        body: JSON.stringify({
          requestId,
          companyName,
          contactName: tenantForm.contactName.trim(),
          industry: tenantForm.industry.trim(),
          notes: tenantForm.notes.trim(),
        }),
      });
      clearDeliveryTenantRequestId(requestId);
      if (data.tenant) {
        setTenants(current => [data.tenant, ...current.filter(item => item.tenantId !== data.tenant.tenantId)]);
      }
      const inviteCode = String(data.tenant?.inviteCode || '');
      const inviteUrl = String(data.tenant?.inviteUrl || '');
      setGeneratedInvite({
        companyName: String(data.tenant?.name || companyName),
        inviteCode,
        inviteUrl,
      });
      setTenantForm({ companyName: '', contactName: '', industry: '', notes: '' });
      setCopiedInvite('');
      setMessage(inviteCode ? '正式客户一次性邀请码已生成' : '客户租户已创建');
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成邀请码失败');
    } finally {
      setCreatingTenant(false);
    }
  };

  const createAssistLink = async (app: DeliveryApp) => {
    const appKey = keyOf(app.tenantId, app.platform);
    setAssistLinks(current => ({ ...current, [appKey]: { link: current[appKey]?.link ?? '', loading: true } }));
    setError('');
    try {
      const data = await jsonFetch('/api/admin/assist-links', {
        method: 'POST',
        body: JSON.stringify({ tenantId: app.tenantId, platform: app.platform }),
      });
      const link = String(data.link || '');
      setAssistLinks(current => ({ ...current, [appKey]: { link, loading: false } }));
      if (link) await navigator.clipboard?.writeText(link);
      setMessage('协助链接已生成并复制，24 小时内有效。');
    } catch (err) {
      setAssistLinks(current => ({ ...current, [appKey]: { link: current[appKey]?.link ?? '', loading: false } }));
      setError(err instanceof Error ? err.message : '协助链接生成失败');
    }
  };

  const saveAppChecklist = async (app: DeliveryApp, checklist: Record<string, boolean | string>) => {
    await jsonFetch(`/api/overseas/admin/delivery/platform-apps/${app.tenantId}/${app.platform}`, {
      method: 'PUT',
      body: JSON.stringify({
        appId: app.appId,
        appSecret: '',
        waConfigId: app.waConfigId,
        businessId: app.businessId,
        wabaId: app.wabaId,
        phoneNumberId: app.phoneNumberId,
        waPublicNumber: app.waPublicNumber,
        pageId: app.pageId,
        igUserId: app.igUserId,
        youtubeChannelId: app.youtubeChannelId,
        wecomEncodingAesKey: '',
        tokenType: app.tokenType,
        accessToken: '',
        tokenExpiresAt: app.tokenExpiresAt,
        status: app.status,
        checklist,
        notes: app.notes,
      }),
    });
  };

  const toggleProgressStage = async (tenant: TenantCard, key: ProgressStageKey) => {
    const app = appFor(tenant, 'meta');
    if (!app) return;
    const busy = `${tenant.tenantId}:${key}`;
    setProgressBusyKey(busy);
    setError('');
    try {
      const checklist = { ...(app.checklist ?? {}) };
      if (key === 'business_verification') {
        if (checklist.business_verification_approved) {
          checklist.business_verification_approved = false;
          checklist.business_verification_submitted = false;
        } else if (checklist.business_verification_submitted) {
          checklist.business_verification_approved = true;
        } else {
          checklist.business_verification_submitted = true;
        }
      } else {
        checklist[key] = !checklist[key];
      }
      await saveAppChecklist(app, checklist);
      setMessage('部署进度已更新');
      await load({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '部署进度更新失败');
    } finally {
      setProgressBusyKey('');
    }
  };

  const customerTenants = useMemo(
    () => tenants.filter(tenant => tenant.accountType !== 'trial' && tenant.accountType !== 'admin'),
    [tenants],
  );
  const trialTenants = useMemo(
    () => tenants.filter(tenant => tenant.accountType === 'trial'),
    [tenants],
  );
  const visibleTenants = tenantView === 'trial' ? trialTenants : customerTenants;
  const summary = useMemo(() => {
    const apps = visibleTenants.flatMap(tenant => tenant.apps);
    return {
      total: apps.length,
      active: apps.filter(app => app.status === 'active').length,
      risky: apps.filter(app => app.status === 'token_expired' || app.status === 'needs_permanent_token' || app.status === 'error').length,
    };
  }, [visibleTenants]);
  const anyTenantExpanded = visibleTenants.some(tenant => expandedTenantIds.has(tenant.tenantId));

  const toggleTenant = (tenantId: string) => {
    setExpandedTenantIds(current => {
      const next = new Set(current);
      if (next.has(tenantId)) next.delete(tenantId);
      else next.add(tenantId);
      return next;
    });
  };

  const toggleAllTenants = () => {
    setExpandedTenantIds(anyTenantExpanded
      ? new Set()
      : new Set(visibleTenants.map(tenant => tenant.tenantId)));
  };

  return (
    <div className="flex h-full flex-col bg-ink">
      <LsPageHeader title="客户运维" description="集中处理客户部署、平台授权、验收进度和内容入库异常。" extra={
        <div className="flex flex-wrap items-center gap-2">
          {visibleTenants.length > 0 && (
            <Button onClick={toggleAllTenants} icon={anyTenantExpanded ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}>
              {anyTenantExpanded ? '收起全部' : '展开全部'}
            </Button>
          )}
          <Button type="primary" onClick={openInviteDialog} icon={<KeyRound size={16} />}>生成注册邀请码</Button>
          <Button data-testid="admin-delivery-refresh" onClick={() => void load({ background: true })} loading={refreshing} icon={<RefreshCcw size={16} />}>刷新</Button>
        </div>
      }><p className="text-xs text-text-secondary">平台配置 {summary.total} 项 · 已交付 {summary.active} · 风险 {summary.risky}</p></LsPageHeader>

      <div
        ref={scrollContainerRef}
        data-testid="admin-delivery-scroll"
        onScroll={event => sessionStorage.setItem('lingshu:admin-delivery:scroll', String(event.currentTarget.scrollTop))}
        className="min-h-0 flex-1 overflow-y-auto p-5"
      >
        {message && <Alert className="mb-3" type="success" showIcon title={message} />}
        {error && <Alert className="mb-3" type="error" showIcon title={error} />}
        <AdminSocialAccountSetup />
        <div id="customer-content-ops" className="mb-4 scroll-mt-5">
          <AdminContentOpsAlerts />
        </div>
        <AdminSocialWorkPackageCenter />
        <section className="mb-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-text-primary">客户租户</p>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                每张卡片代表一家客户公司的独立工作空间。客户用你生成的邀请码注册后，社媒账号、内容和客户数据都归属这里；管理员自己的账号请使用上方直连区。
              </p>
            </div>
            <Segmented value={tenantView} onChange={value => setTenantView(value as 'customer' | 'trial')} options={[
              { value: 'customer', label: `正式客户 ${customerTenants.length}` },
              { value: 'trial', label: `试用客户 ${trialTenants.length}` },
            ]} />
          </div>
        </section>
        {loading ? (
          <div className="flex h-60 items-center justify-center text-text-muted"><Loader2 className="animate-spin" /></div>
        ) : visibleTenants.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
            <p className="text-sm font-semibold text-text-primary">{tenantView === 'trial' ? '暂无试用客户' : '还没有正式客户'}</p>
            {tenantView === 'trial' ? (
              <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-text-muted">试用账号会单独显示在这里，不会混入正式交付列表。</p>
            ) : (
              <>
                <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-text-muted">新客户可以使用邀请码注册；已有试用客户请在账号总控里直接转正。</p>
                <Button type="primary" onClick={openInviteDialog} className="mt-4" icon={<KeyRound size={16} />}>生成注册邀请码</Button>
              </>
            )}
          </div>
        ) : (
          <div id="customer-deployment" className="grid gap-4 scroll-mt-5">
            {visibleTenants.map(tenant => {
              const expanded = expandedTenantIds.has(tenant.tenantId);
              const activeApps = tenant.apps.filter(app => app.status === 'active').length;
              const riskyApps = tenant.apps.filter(app => app.status === 'token_expired' || app.status === 'needs_permanent_token' || app.status === 'error').length;
              return (
                <section key={tenant.tenantId} className="rounded-lg border border-border bg-surface p-4">
                  <div className={`flex items-center justify-between gap-4 ${expanded ? 'mb-3' : ''}`}>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-text-primary">{tenant.name}</p>
                        {tenant.accountType === 'trial' && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                            试用空间
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          tenant.registrationState === 'waiting_registration'
                            ? 'bg-amber-50 text-amber-700'
                            : tenant.registrationState === 'registered'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                        }`}>
                          {tenant.registrationState === 'waiting_registration'
                            ? '待客户注册'
                            : tenant.registrationState === 'registered'
                              ? '客户已注册'
                              : '已有客户空间'}
                        </span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-text-muted">
                          已交付 {activeApps}/{tenant.apps.length}
                        </span>
                        {riskyApps > 0 && (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                            风险 {riskyApps}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        独立客户空间{tenant.contactName ? ` · 联系人：${tenant.contactName}` : ''}{tenant.registeredEmail ? ` · ${tenant.registeredEmail}` : ''}
                      </p>
                      {tenant.inviteCode && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <code className="rounded-lg border border-border bg-white px-2 py-1 text-[11px] font-bold text-text-secondary">
                            邀请码：{tenant.inviteCode}
                          </code>
                          <button type="button" onClick={() => navigator.clipboard?.writeText(tenant.inviteCode || '')} className="text-[11px] font-bold text-primary hover:underline">
                            复制邀请码
                          </button>
                        </div>
                      )}
                      {tenant.inviteUrl && (
                        <button type="button" onClick={() => navigator.clipboard?.writeText(tenant.inviteUrl || '')} className="mt-1 text-[11px] font-bold text-primary hover:underline">
                          复制客户注册链接
                        </button>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-text-secondary">现场预计 3 小时</span>
                      <button
                        type="button"
                        onClick={() => toggleTenant(tenant.tenantId)}
                        aria-expanded={expanded}
                        className="inline-flex min-w-[88px] items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary"
                      >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {expanded ? '收起资料' : '展开资料'}
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <>
                      <DeploymentProgressStrip tenant={tenant} busyKey={progressBusyKey} onToggle={toggleProgressStage} knowledgeCompletion={knowledgeCompletion} />
                      <div className="grid gap-3">
                        {tenant.apps.map(app => (
                          <PlatformWizard
                            key={`${tenant.tenantId}-${app.platform}`}
                            app={app}
                            drafts={drafts}
                            setDrafts={setDrafts}
                            tests={tests}
                            onSave={save}
                            onTest={test}
                            onComplete={complete}
                            onAssistLink={createAssistLink}
                            assistLink={assistLinks[keyOf(app.tenantId, app.platform)]}
                            saving={savingAppKeys.has(keyOf(app.tenantId, app.platform))}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
      {saveToast && (
        <div role="status" className="fixed right-6 top-20 z-[70] inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-none">
          <CheckCircle2 size={17} /> {saveToast}
        </div>
      )}
      {tenantDialogOpen && (
        <Modal open title={generatedInvite ? '一次性注册邀请码' : '生成注册邀请码'} width={560} onCancel={closeInviteDialog} closable={!creatingTenant} keyboard={!creatingTenant} mask={{ closable: false }}
          footer={generatedInvite
            ? <Button onClick={closeInviteDialog}>完成</Button>
            : <><Button onClick={closeInviteDialog} disabled={creatingTenant}>取消</Button><Button type="primary" onClick={() => void createTenant()} loading={creatingTenant} icon={<KeyRound size={16} />}>生成邀请码</Button></>}
        >
                <p className="mb-4 text-sm text-text-secondary">
                  {generatedInvite
                    ? `${generatedInvite.companyName} 注册成功后，该邀请码立即失效。`
                    : '填写客户信息后，系统会生成一次性随机邀请码。'}
                </p>
            {error && <Alert className="mb-3" type="error" showIcon title={error} />}
            {generatedInvite ? (
              <>
                <div className="border-y border-border py-5 text-center">
                  <p className="text-[11px] font-bold text-text-muted">一次性邀请码</p>
                  <code className="mt-2 block text-2xl font-semibold tracking-normal text-text-primary">{generatedInvite.inviteCode || '生成失败'}</code>
                  <p className="mt-2 text-xs text-text-muted">将邀请码或注册链接发送给客户，客户在注册页面使用。</p>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <Button onClick={() => void copyInvite('code', generatedInvite.inviteCode)} disabled={!generatedInvite.inviteCode} icon={copiedInvite === 'code' ? <CheckCircle2 size={16} /> : <Clipboard size={16} />}>
                    {copiedInvite === 'code' ? '邀请码已复制' : '复制邀请码'}
                  </Button>
                  <Button type="primary" onClick={() => void copyInvite('url', generatedInvite.inviteUrl)} disabled={!generatedInvite.inviteUrl} icon={copiedInvite === 'url' ? <CheckCircle2 size={16} /> : <Link2 size={16} />}>
                    {copiedInvite === 'url' ? '链接已复制' : '复制注册链接'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-3">
                  <label className="grid gap-1 text-xs font-bold text-text-secondary">
                    <span>公司名称 <span className="text-red">*</span></span>
                    <Input required value={tenantForm.companyName} onChange={event => setTenantForm(current => ({ ...current, companyName: event.target.value }))} placeholder="必填，例如：义乌星河饰品有限公司" />
                  </label>
                  <label className="grid gap-1 text-xs font-bold text-text-secondary">
                    联系人
                    <Input value={tenantForm.contactName} onChange={event => setTenantForm(current => ({ ...current, contactName: event.target.value }))} placeholder="例如：王总" />
                  </label>
                  <label className="grid gap-1 text-xs font-bold text-text-secondary">
                    客户行业
                    <Input value={tenantForm.industry} onChange={event => setTenantForm(current => ({ ...current, industry: event.target.value }))} placeholder="例如：美妆个护 / 护肤彩妆" />
                  </label>
                  <label className="grid gap-1 text-xs font-bold text-text-secondary">
                    备注
                    <Input.TextArea value={tenantForm.notes} onChange={event => setTenantForm(current => ({ ...current, notes: event.target.value }))} rows={3} placeholder="记录部署方式、客户账号、待补信息。" />
                  </label>
                </div>
              </>
            )}
        </Modal>
      )}
    </div>
  );
}
