import { Button, Drawer, Tag } from 'antd';
import { ArrowUpRight } from 'lucide-react';
import type { Page } from '../../pageRegistry';

export type BusinessOverviewDetail = {
  title: string;
  summary: string;
  rows: Array<[string, string]>;
  preview?: boolean;
  image?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  page?: Page;
};

export default function BusinessOverviewDetailDrawer({ detail, onClose, onNavigate }: {
  detail: BusinessOverviewDetail | null;
  onClose: () => void;
  onNavigate?: (page: Page) => void;
}) {
  return <Drawer open={Boolean(detail)} onClose={onClose} title={detail?.title} width={480} destroyOnHidden>
    {detail && <div className="space-y-4">
      {detail.preview && <Tag color="processing">界面预览</Tag>}
      {detail.image && <img src={detail.image} alt={`${detail.title}预览图`} className="max-h-64 w-full rounded-xl bg-surface-2 object-contain"/>}
      <p className="text-sm leading-6 text-text-secondary">{detail.summary}</p>
      <dl className="divide-y divide-border rounded-xl border border-border px-4">{detail.rows.map(([label, value]) => <div key={label} className="flex min-w-0 justify-between gap-4 py-3 text-sm"><dt className="shrink-0 text-text-secondary">{label}</dt><dd className="min-w-0 break-words text-right font-medium text-text-primary">{value}</dd></div>)}</dl>
      {detail.sourceUrl && <a className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-accent hover:underline focus-visible:outline-accent" href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">{detail.sourceLabel || '查看原始来源'}<ArrowUpRight size={15} aria-hidden="true"/></a>}
      {detail.page && <Button type="primary" onClick={() => { onClose(); onNavigate?.(detail.page!); }}>打开业务页面</Button>}
    </div>}
  </Drawer>;
}
