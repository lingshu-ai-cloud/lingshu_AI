import { useEffect, useState } from 'react';
import { Copy, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { authHeader } from '../lib/auth';

interface ProductApiInfo {
  tenantId: string;
  apiKeySet: boolean;
  apiKeyLast4?: string;
  createdAt?: string;
  /** Returned once, only by a successful create or rotate request. */
  apiKey?: string;
}

export interface ProductApiStatus {
  count: number;
  lastIngestedAt?: string;
  lastProductName?: string;
}

interface Props {
  importing: boolean;
  importMessage: string;
  apiStatus: ProductApiStatus;
  onImport(file: File | null): void | Promise<void>;
}

export default function EnterpriseProductImportCard({ importing, importMessage, apiStatus, onImport }: Props) {
  const [apiInfo, setApiInfo] = useState<ProductApiInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/overseas/enterprise/product-api', {
      headers: authHeader(),
      signal: controller.signal,
    }).then(async response => {
      const result = await response.json().catch(() => ({})) as Partial<ProductApiInfo> & { error?: string; message?: string };
      if (!response.ok) throw new Error(response.status === 403 ? '当前会话没有密钥管理权限' : result.message || result.error || '密钥状态加载失败');
      setApiInfo(result as ProductApiInfo);
    }).catch(error => {
      if (error instanceof Error && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? error.message : '密钥状态加载失败');
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const createOrRotate = async () => {
    if (saving) return;
    const rotating = apiInfo?.apiKeySet === true;
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(
        rotating ? '/api/overseas/enterprise/product-api/rotate' : '/api/overseas/enterprise/product-api',
        { method: 'POST', headers: authHeader() },
      );
      const next = await response.json().catch(() => ({})) as Partial<ProductApiInfo> & { error?: string; message?: string };
      if (!response.ok || !next.apiKey) throw new Error(next.message || next.error || `密钥操作失败（${response.status}）`);
      setApiInfo(next as ProductApiInfo);
      setMessage(`${rotating ? '新密钥已生成' : '密钥已创建'}，明文只显示这一次，请立即复制并安全保存。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '密钥操作失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const keyDisplay = apiInfo?.apiKey
    || (apiInfo?.apiKeySet ? `已设置 · 末四位 ${apiInfo.apiKeyLast4 || '未知'}` : loading ? '正在读取...' : '尚未创建密钥');

  return (
    <section data-lingshu-guide="enterprise-order-import" className="card p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-700">
          <FileSpreadsheet size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-text-primary">产品数据导入</p>
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">上传 Excel / CSV 商品表或 PDF / DOCX 产品资料，确认识别结果后导入；也可由 ERP 服务商通过 API 接入。</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary">
                {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                上传产品表
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf,.docx"
                  className="hidden"
                  disabled={importing}
                  onChange={event => {
                    void onImport(event.currentTarget.files?.[0] ?? null);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
              <button type="button" onClick={createOrRotate} disabled={loading || saving || Boolean(message && !apiInfo)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                {apiInfo?.apiKeySet ? '轮换Key' : '创建Key'}
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-primary">{keyDisplay}</code>
            <button type="button" disabled={!apiInfo?.apiKey} onClick={() => apiInfo?.apiKey && navigator.clipboard?.writeText(apiInfo.apiKey)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-950 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
              <Copy size={12} />复制
            </button>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">为保护密钥，页面刷新后只显示末四位；遗失后请轮换，不会再次回显原值。</p>
          {message && <p className="mt-2 text-[11px] font-semibold text-text-secondary">{message}</p>}
          {importMessage && <p className="mt-2 text-[11px] font-semibold text-green-700">{importMessage}</p>}
          <p className="mt-2 text-[11px] text-text-muted">已接入商品：{apiStatus.count}{apiStatus.lastIngestedAt ? ` · 最近接入 ${apiStatus.lastProductName || '商品'}` : ''}</p>
        </div>
      </div>
    </section>
  );
}
