import { Avatar, Button, Empty, Modal, Switch, Table, Tag } from 'antd';
import { useId, useMemo, useState } from 'react';
import { UsersRound } from 'lucide-react';
import { localCustomerProfileUnassessed } from '../../../shared/contracts/localCustomerProfile';
import { sortCustomersByLatestMessage } from '../../lib/customerRecency';
import type { CustomerProfile, CustomerStage } from '../../types/customer';
import { customerDisplayName, STAGE_LABEL } from './conversionPresentation';
import { SourceIcon, sourceLabel } from './SourceIcon';

interface CustomerServiceControlProps {
  enabled: boolean;
  unavailable: boolean;
  saving: boolean;
  summary: string;
  onChange: (enabled: boolean) => void;
}

interface CustomerDirectoryProps {
  customers: CustomerProfile[];
  onOpenCustomer: (id: string) => void;
}

interface CustomerServiceSwitchProps extends CustomerServiceControlProps, CustomerDirectoryProps {}

const STAGE_COLOR: Partial<Record<CustomerStage, string>> = {
  quoted: 'processing',
  won: 'success',
  silent30: 'warning',
  silent60: 'warning',
};

function customerContact(customer: CustomerProfile): string {
  return customer.email || customer.waNumber || '联系方式未登记';
}

function customerProduct(customer: CustomerProfile): string {
  return customer.outboundProduct || customer.product || '需求未登记';
}

function customerIntent(customer: CustomerProfile): string {
  return localCustomerProfileUnassessed(customer) ? '待评估' : `${customer.intentScore}`;
}

function uniqueCustomerRows(customers: CustomerProfile[]): CustomerProfile[] {
  const seen = new Set<string>();
  return sortCustomersByLatestMessage(customers).filter(customer => {
    if (seen.has(customer.id)) return false;
    seen.add(customer.id);
    return true;
  });
}

/** The original activation control remains available inside the customer directory dialog. */
export function CustomerServiceControl({ enabled, unavailable, saving, summary, onChange }: CustomerServiceControlProps) {
  const switchId = useId();
  const labelId = `${switchId}-label`;
  const descriptionId = `${switchId}-description`;

  return (
    <section aria-label="智能客服设置" className="mb-4 flex min-h-14 items-center justify-between gap-4 border-b border-border pb-3">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-semibold text-text-primary">智能客服</p>
        <p id={descriptionId} title={summary} className="mt-1 line-clamp-2 text-xs leading-[18px] text-text-secondary">{summary}</p>
      </div>
      <Switch
        id={switchId}
        size="small"
        aria-label="智能客服总开关"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        checked={enabled}
        disabled={unavailable}
        loading={saving}
        onChange={value => { if (!unavailable && !saving) onChange(value); }}
      />
    </section>
  );
}

export function CustomerDirectory({ customers, onOpenCustomer }: CustomerDirectoryProps) {
  if (!customers.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有客户信息" />;

  const openCustomer = (customer: CustomerProfile) => (
    <Button
      type="link"
      htmlType="button"
      title={`打开 ${customerDisplayName(customer)} 的会话`}
      className="!h-auto !max-w-full !justify-start !p-0 !text-left"
      onClick={() => onOpenCustomer(customer.id)}
    >
      <span className="truncate font-semibold">{customerDisplayName(customer)}</span>
    </Button>
  );

  return (
    <div data-testid="all-customer-directory">
      <div className="hidden md:block">
        <Table<CustomerProfile>
          size="small"
          rowKey="id"
          tableLayout="fixed"
          dataSource={customers}
          pagination={false}
          scroll={{ x: 860, y: 480 }}
          columns={[
            {
              title: '客户', key: 'customer', width: 190,
              render: (_, customer) => <div className="flex min-w-0 items-center gap-2.5">
                <Avatar size={32} className="shrink-0 bg-surface-2 text-text-secondary">{customer.avatar}</Avatar>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">{openCustomer(customer)}{customer.isHistorical && <Tag className="!m-0 !text-[10px]">历史</Tag>}</div>
                  <p className="truncate text-xs text-text-muted" title={customerContact(customer)}>{customerContact(customer)}</p>
                </div>
              </div>,
            },
            {
              title: '来源', key: 'source', width: 110,
              render: (_, customer) => <span className="flex items-center gap-1.5 text-xs text-text-secondary"><SourceIcon source={customer.source} size={13}/>{sourceLabel(customer.source)}</span>,
            },
            {
              title: '地区 / 语言', key: 'location', width: 125,
              render: (_, customer) => <span className="text-xs text-text-secondary">{customer.countryName || '地区未登记'}<span className="block text-text-muted">{customer.language || '语言未登记'}</span></span>,
            },
            {
              title: '阶段', dataIndex: 'stage', width: 95,
              render: (stage: CustomerStage) => <Tag color={STAGE_COLOR[stage]} className="!m-0">{STAGE_LABEL[stage]}</Tag>,
            },
            {
              title: '需求产品', key: 'product', width: 155,
              render: (_, customer) => <span className="line-clamp-2 text-xs leading-[18px] text-text-secondary" title={customerProduct(customer)}>{customerProduct(customer)}</span>,
            },
            {
              title: '意向', key: 'intent', width: 70,
              render: (_, customer) => <span className="text-xs font-semibold text-text-primary">{customerIntent(customer)}</span>,
            },
            {
              title: '最近互动', dataIndex: 'lastActive', width: 105,
              render: (lastActive: string) => <span className="text-xs text-text-secondary">{lastActive || '暂无记录'}</span>,
            },
          ]}
        />
      </div>

      <ul className="max-h-[62vh] space-y-2 overflow-y-auto md:hidden">
        {customers.map(customer => (
          <li key={customer.id} className="rounded-lg border border-border bg-surface p-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar size={32} className="shrink-0 bg-surface-2 text-text-secondary">{customer.avatar}</Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">{openCustomer(customer)}{customer.isHistorical && <Tag className="!m-0 !text-[10px]">历史</Tag>}</div>
                <p className="truncate text-xs text-text-muted" title={customerContact(customer)}>{customerContact(customer)}</p>
              </div>
              <Tag color={STAGE_COLOR[customer.stage]} className="!m-0 shrink-0">{STAGE_LABEL[customer.stage]}</Tag>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div><dt className="text-text-muted">来源</dt><dd className="mt-0.5 flex items-center gap-1 text-text-secondary"><SourceIcon source={customer.source} size={12}/>{sourceLabel(customer.source)}</dd></div>
              <div><dt className="text-text-muted">地区 / 语言</dt><dd className="mt-0.5 text-text-secondary">{customer.countryName || '未登记'} · {customer.language || '未登记'}</dd></div>
              <div><dt className="text-text-muted">意向</dt><dd className="mt-0.5 font-semibold text-text-primary">{customerIntent(customer)}</dd></div>
              <div><dt className="text-text-muted">最近互动</dt><dd className="mt-0.5 text-text-secondary">{customer.lastActive || '暂无记录'}</dd></div>
              <div className="col-span-2"><dt className="text-text-muted">需求产品</dt><dd className="mt-0.5 break-words text-text-secondary">{customerProduct(customer)}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CustomerServiceSwitch({
  enabled, unavailable, saving, summary, onChange, customers, onOpenCustomer,
}: CustomerServiceSwitchProps) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => uniqueCustomerRows(customers), [customers]);
  const selectCustomer = (id: string) => {
    setOpen(false);
    onOpenCustomer(id);
  };

  return <>
    <Button
      block
      htmlType="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(true)}
      className="mb-2 !flex !h-11 !items-center !justify-start !px-3"
    >
      <span className="flex w-full min-w-0 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2"><UsersRound size={16} aria-hidden="true"/><span className="truncate">查看全部用户信息</span></span>
        <span className="min-w-5 rounded-md bg-surface-2 px-1.5 py-0.5 text-center text-[11px] font-semibold text-text-secondary">{rows.length}</span>
      </span>
    </Button>
    <Modal
      open={open}
      title={<span className="flex items-center gap-2">全部客户信息 <span className="text-xs font-normal text-text-muted">共 {rows.length} 位</span></span>}
      width={960}
      footer={null}
      onCancel={() => setOpen(false)}
    >
      <CustomerServiceControl enabled={enabled} unavailable={unavailable} saving={saving} summary={summary} onChange={onChange}/>
      <CustomerDirectory customers={rows} onOpenCustomer={selectCustomer}/>
    </Modal>
  </>;
}
