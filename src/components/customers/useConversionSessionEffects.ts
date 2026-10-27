import { useEffect } from 'react';
import { authHeader } from '../../lib/auth';
import { customerManualTakeoverApi } from '../../lib/customerManualTakeoverApi';
import { readCustomerItemNavigation, matchCustomerItemNavigation } from '../../lib/weeklyCustomerProductionLink';
import { buildPrioritySuggestion } from '../../lib/customerPriority';
import { getCustomerServiceStatus, type CustomerServiceStatus } from '../../lib/customerService';
import type { CustomerProfile, AutonomyLevel } from '../../types/customer';
import type { DigitalEmployeeDeepLink } from '../../lib/digitalEmployees';
import { isSuggestionDismissed } from './customerSuggestionDismissal';
import type { CustomerView } from './ConversionCustomerList';
import type { MessageTemplate } from './customerReplyPreparation';

interface ConversionSessionEffects {
  customers: CustomerProfile[];
  customersInActiveView: CustomerProfile[];
  selectedId: string | null;
  deliveryHandoff: DigitalEmployeeDeepLink | null | undefined;
  agentProductionActive: boolean;
  customerPendingCount: number;
  deepLinkConsumedRef: { current: boolean };
  filterEmptySelectionRef: { current: boolean };
  setSelectedId: (id: string | null) => void;
  setView: (view: CustomerView) => void;
  setDeliveryError: (message: string) => void;
  updateCustomer: (id: string, patch: Partial<CustomerProfile>) => void;
  setCustomerServiceStatus: (status: CustomerServiceStatus | null) => void;
  setCustomerServiceStatusLoadFailed: (failed: boolean) => void;
  setAutonomyLevel: (level: AutonomyLevel) => void;
  setNotificationReady: (ready: boolean) => void;
  setTemplates: (templates: MessageTemplate[]) => void;
  setDailyBriefingOpen: (open: boolean) => void;
}

export function useConversionSessionEffects({
  customers, customersInActiveView, selectedId, deliveryHandoff, agentProductionActive, customerPendingCount,
  deepLinkConsumedRef, filterEmptySelectionRef, setSelectedId, setView, setDeliveryError, updateCustomer,
  setCustomerServiceStatus, setCustomerServiceStatusLoadFailed, setAutonomyLevel,
  setNotificationReady, setTemplates, setDailyBriefingOpen,
}: ConversionSessionEffects): void {
  useEffect(() => {
    if (deepLinkConsumedRef.current || !customers.length) return;
    if(deliveryHandoff?.businessRef.followupItemId)return;
    const customerId = new URLSearchParams(window.location.search).get('customer');
    if (!customerId) {
      deepLinkConsumedRef.current = true;
      return;
    }
    if (customers.some(customer => customer.id === customerId)) {
      setSelectedId(customerId);
      const customer = customers.find(item => item.id === customerId)!;
      setView(customer.stage === 'won' ? 'won' : ['silent30', 'silent60'].includes(customer.stage) ? 'silent' : 'leads');
      if (selectedId === customerId && customersInActiveView.some(item => item.id === customerId)) deepLinkConsumedRef.current = true;
    }
  }, [customers, selectedId, customersInActiveView]);

  useEffect(() => {
    if(deliveryHandoff?.businessRef.followupItemId)return;
    if (!deepLinkConsumedRef.current && new URLSearchParams(window.location.search).get('customer')) return;
    if (agentProductionActive && window.__agentProductionTarget?.customerId) {
      setSelectedId(window.__agentProductionTarget.customerId);
      return;
    }
    if (selectedId && customersInActiveView.some(customer => customer.id === selectedId)) return;
    if (!selectedId && filterEmptySelectionRef.current) return;
    setSelectedId(customersInActiveView[0]?.id ?? null);
  }, [customersInActiveView, selectedId,deliveryHandoff]);

  useEffect(() => {
    const link=deliveryHandoff;
    if (!link?.businessRef.followupItemId) return;
    let active=true;
    setSelectedId(null);
    setDeliveryError('');
    void readCustomerItemNavigation(link).then(async binding=>{
      if(!active)return;
      if(binding.programId){
        if(!binding.accountId||!binding.conversationId)throw new Error('原周包渠道账号或真实会话身份缺失。');
        const actual=await customerManualTakeoverApi.read(binding.customerId);
        if(!active)return;
        if(['tenantId','channel','accountId','nativeAccountId','conversationId'].some(key=>actual.scope[key as keyof typeof actual.scope]!==binding[key as keyof typeof binding]))throw new Error('原任务与当前真实渠道账号或会话不一致。');
      }
      const customer=matchCustomerItemNavigation(binding,customers);
      if(!customer){if(customers.length)setDeliveryError('原任务客户或渠道当前不可访问，请核对实际渠道接入。');return;}
      setSelectedId(customer.id);
      setView(customer.stage==='won'?'won':['silent30','silent60'].includes(customer.stage)?'silent':'leads');
    }).catch(cause=>{if(active)setDeliveryError(cause instanceof Error?cause.message:'原客服条目无法核验。');});
    return()=>{active=false;};
  },[deliveryHandoff,customers,JSON.stringify(deliveryHandoff?.businessRef.customerNavigation),authHeader().Authorization]);

  useEffect(() => {
    const ref = deliveryHandoff?.businessRef;
    if (!ref?.entityId||ref.followupItemId) return;
    const customer = customers.find(item => item.id === ref.entityId);
    if (!customer) { if (customers.length) setDeliveryError('关联客户暂不可访问，请返回交付看板核对。'); return; }
    setDeliveryError('');
    setSelectedId(customer.id);
    setView(customer.stage === 'won' ? 'won' : ['silent30', 'silent60'].includes(customer.stage) ? 'silent' : 'leads');
  }, [deliveryHandoff, customers]);


  useEffect(() => {
    customers.forEach(customer => {
      if (customer.isHistorical || customer.todoCompletedAt) return;
      const suggestion = buildPrioritySuggestion(customer);
      if (suggestion.suggestionType !== 'none' && isSuggestionDismissed(customer.id, suggestion.suggestionType)) {
        updateCustomer(customer.id, { todoCompletedAt: new Date().toISOString(), hasUnread: false });
      }
    });
  }, [customers, updateCustomer]);

  useEffect(() => {
    let alive = true;
    let retryTimer: number | null = null;
    let attempt = 0;

    const loadStatus = async () => {
      try {
        const status = await getCustomerServiceStatus();
        if (!alive) return;
        setCustomerServiceStatus(status);
        setCustomerServiceStatusLoadFailed(false);
      } catch {
        if (!alive) return;
        attempt += 1;
        if (attempt < 4) {
          retryTimer = window.setTimeout(() => void loadStatus(), 700 * (2 ** (attempt - 1)));
          return;
        }
        setCustomerServiceStatus(null);
        setCustomerServiceStatusLoadFailed(true);
      }
    };

    void loadStatus();
    return () => {
      alive = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    fetch('/api/overseas/enterprise/profile', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        const value = data?.strategy?.aiAutonomy;
        const approvedFaqCount = Array.isArray(data?.faq)
          ? data.faq.filter((item: any) => item?.approvedForAuto && String(item?.question || '').trim() && String(item?.answer || '').trim()).length
          : 0;
        if (value === 'auto') setAutonomyLevel(approvedFaqCount >= 5 ? 'auto' : 'draft');
        else if (value === 'remind' || value === 'draft') setAutonomyLevel(value);
        const firstProduct = Array.isArray(data?.products?.items)
          ? data.products.items.find((item: any) => String(item?.name || '').trim())
          : null;
        const enterpriseProduct = String(firstProduct?.name || data?.products?.categories || data?.company?.industry || '').trim();
        updateCustomer('mock-customer-conversation', {
          product: enterpriseProduct,
          outboundProduct: enterpriseProduct,
          summary: `当前绑定企业：${String(data?.company?.name || '当前企业')}；主营：${enterpriseProduct || '等待客户说明具体需求'}`,
        });
      })
      .catch(() => {});
    fetch('/api/overseas/enterprise/knowledge-completion', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        if (typeof data?.notificationsReady === 'boolean') {
          setNotificationReady(data.notificationsReady);
        }
      })
      .catch(() => {});
  }, [updateCustomer]);

  useEffect(() => {
    fetch('/api/overseas/customers/templates', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => setTemplates(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    if (agentProductionActive || deliveryHandoff || customerPendingCount <= 0 || new URLSearchParams(window.location.search).get('followupDraft') === '1') return;
    const today = new Date().toISOString().slice(0, 10);
    const key = 'lingshu:briefing:lastShown';
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
    setDailyBriefingOpen(true);
  }, [customerPendingCount, deliveryHandoff, agentProductionActive]);

  useEffect(() => {
    const handler = () => setDailyBriefingOpen(true);
    window.addEventListener('lingshu:open-daily-briefing', handler);
    return () => window.removeEventListener('lingshu:open-daily-briefing', handler);
  }, []);

}
