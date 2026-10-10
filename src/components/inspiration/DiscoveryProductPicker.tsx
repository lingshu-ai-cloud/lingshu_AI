import { useEffect, useRef, useState } from 'react';
import { socialDiscoveryApi } from '../../lib/socialDiscoveryApi';
import { authHeader } from '../../lib/auth';
import { readProductDiscoveryFile, validateProductDiscoveryFileSize } from '../../lib/productDiscoveryFile';
import { selectDiscoveryCatalog, type DiscoveryCatalogProduct } from '../../../shared/discoveryCatalog';

export default function DiscoveryProductPicker({ onReference, disabled }: { onReference: (text: string, name: string, refs: string[]) => void; disabled: boolean }) {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [products, setProducts] = useState<DiscoveryCatalogProduct[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = () => {
    setLoading(true); setError('');
    void socialDiscoveryApi.getProductSources().then(result => { setProducts(result.products); setSelected([]); setFiles([]); }).catch(error => setError(error.message)).finally(() => setLoading(false));
  };
  useEffect(refresh, []);
  const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id];
  const reference = async () => {
    setBusy(true); setError('');
    try {
      const selection = selectDiscoveryCatalog(products, selected, files);
      const parts = selection.products.map(product => product.text);
      const names = selection.products.map(product => product.name);
      for (const file of selection.files) {
        if (!/^\/api\/overseas\/enterprise\/assets\/[^/?#]+$/.test(file.url)) throw new Error('文件地址不属于企业资料库');
        validateProductDiscoveryFileSize(file.name, file.size);
        const response = await fetch(file.url, { headers: authHeader(), redirect: 'error' });
        if (!response.ok) throw new Error(`${file.name} 读取失败，请确认文件仍在企业知识库中`);
        const blob = await response.blob();
        parts.push(`文件：${file.name}\n${await readProductDiscoveryFile(new File([blob], file.name, { type: blob.type }))}`);
        names.push(file.name);
      }
      const text = parts.join('\n');
      if (!text || text.length > 80000) throw new Error('请选择适量产品或文件，合计文字不能超过8万字');
      if (!active.current) return;
      onReference(text, `企业知识库 · ${names.join('、')}`, [...selected, ...files]);
    } catch (error) { setError(error instanceof Error ? error.message : '引用资料失败'); }
    finally { setBusy(false); }
  };
  return <div className="mt-3 rounded-lg border border-emerald-200 p-3 text-xs">
    <div className="flex items-center justify-between"><b>从企业知识库选择</b><button type="button" disabled={busy || loading} onClick={refresh}>刷新目录</button></div>
    {loading ? <p className="mt-2">正在读取产品目录…</p> : <>
      <div className="mt-2 flex gap-3"><button type="button" disabled={busy || disabled} onClick={() => setSelected(products.map(product => product.id))}>全选产品</button><button type="button" disabled={busy || disabled} onClick={() => setFiles(products.flatMap(product => product.files.filter(file => file.available).map(file => file.id)))}>全选文件</button><button type="button" disabled={busy || disabled} onClick={() => { setSelected([]); setFiles([]); }}>清空选择</button></div>
      <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">{products.length === 0 && <p>企业知识库中暂无产品，请先维护产品目录或上传文件。</p>}{products.map(product => <div key={product.id} className="rounded bg-white p-2">
        <label className="flex gap-2"><input type="checkbox" disabled={busy || disabled} checked={selected.includes(product.id)} onChange={() => setSelected(toggle(selected, product.id))} /><span>{product.name}{product.category ? ` · ${product.category}` : ''}</span></label>
        {product.files.map(file => <label key={file.id} className="ml-5 mt-1 flex gap-2"><input type="checkbox" disabled={busy || disabled || !file.available} checked={files.includes(file.id)} onChange={() => setFiles(toggle(files, file.id))} /><span>文件：{file.name}{!file.available && '（暂不支持直接读取，请上传文字版资料）'}</span></label>)}
      </div>)}</div>
      <button type="button" disabled={busy || disabled || (!selected.length && !files.length)} onClick={() => void reference()} className="mt-3 rounded bg-blue-600 px-3 py-2 font-bold text-white disabled:opacity-50">{busy ? '正在读取所选资料…' : `引用已选 ${selected.length} 个产品 / ${files.length} 份文件`}</button>
    </>}
    {error && <p role="alert" className="mt-2 text-amber-800">{error}</p>}
  </div>;
}
