import { Alert, Button, Input, Tag, Upload } from 'antd';
import { useEffect, useState } from 'react';
import { authHeader } from '../../lib/auth';

type Scope = { programId: string; packageId: string; packageVersion: number };
type Footage = { product: { id: string; name: string } | null;
  status: 'material_intervention_required'; candidateCount: number;
  candidates: Array<{ id: string; name: string; sha256: string; status: 'pending_independent_review'; bytesCurrent: boolean }> };

/** Read-only task-card projection. A candidate upload is never a usable shot. */
export default function WeeklyProductFootageIntervention({ scope }: { scope: Scope }) {
  const [item, setItem] = useState<Footage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [identityRef, setIdentityRef] = useState('');
  const [rightsRef, setRightsRef] = useState('');
  const key = `${scope.programId}:${scope.packageId}:${scope.packageVersion}`;
  const refresh = async () => {
    setBusy(true); setError('');
    try {
      const route = `/api/overseas/social-programs/${encodeURIComponent(scope.programId)}/operating-packages/${encodeURIComponent(scope.packageId)}/product-footage?version=${scope.packageVersion}`;
      const response = await fetch(route, { headers: authHeader(), cache: 'no-store' });
      if (!response.ok) throw Error('当前产品素材状态暂不可读取，请刷新后重试。');
      setItem((await response.json() as { item: Footage }).item);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '素材状态读取失败。'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    void refresh();
    const onSelection = () => { void refresh(); };
    window.addEventListener('lingshu:weekly-product-selection-updated', onSelection);
    return () => window.removeEventListener('lingshu:weekly-product-selection-updated', onSelection);
  }, [key]);
  const upload = async () => {
    if (!file || !item?.product) return;
    setUploading(true); setError('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || Error('视频读取失败'));
        reader.readAsDataURL(file);
      });
      const response = await fetch(`/api/overseas/social-programs/${encodeURIComponent(scope.programId)}/operating-packages/${encodeURIComponent(scope.packageId)}/product-footage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, cache: 'no-store',
        body: JSON.stringify({ expectedPackageVersion: scope.packageVersion, productId: item.product.id,
          name: file.name, dataUrl, productIdentityEvidenceRef: identityRef.trim(), rightsEvidenceRef: rightsRef.trim() }),
      });
      if (!response.ok) throw Error('视频候选未保存，请先刷新核对，再决定是否重试。');
      setFile(null); setIdentityRef(''); setRightsRef('');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '视频候选保存失败。'); }
    finally { setUploading(false); }
  };
  return <section aria-label="产品实拍素材待干预" className="space-y-3 rounded-lg border border-amber-200 bg-white p-4">
    <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-text-primary">产品实拍素材</h2><Tag color="warning">待干预</Tag></div>
    {item?.product ? <p className="text-sm text-text-secondary">本周选品：{item.product.name}。当前仍缺可核验的同品本地实拍视频。</p>
      : <p className="text-sm text-text-secondary">请先完成本周发布选品，才可核对对应产品实拍。</p>}
    <Alert type="warning" showIcon title="异品或通用片段不能替代同品实拍" description="上传仅登记当前商品的视频候选，不会解除生产阻断。身份、权利与逐窗画面需独立审核；原计划缺此镜头依据时，还须建立合法计划修订，不能直接改写原分镜。" />
    {item?.product && <div className="space-y-3">
      <Upload accept="video/mp4,video/quicktime,video/webm" maxCount={1} beforeUpload={candidate => {
        if (candidate.size > 30 * 1024 * 1024) { setError('请选择不超过 30 MB 的视频。'); return Upload.LIST_IGNORE; }
        setFile(candidate); setError(''); return false;
      }} onRemove={() => { setFile(null); }} fileList={file ? [{ uid: 'footage', name: file.name, status: 'done' }] : []}>
        <Button className="min-h-11">选择当前商品的实拍视频</Button>
      </Upload>
      <Input aria-label="产品身份来源" value={identityRef} maxLength={512} onChange={event => setIdentityRef(event.target.value)} placeholder="产品身份来源文件或审核记录" />
      <Input aria-label="商用权利来源" value={rightsRef} maxLength={512} onChange={event => setRightsRef(event.target.value)} placeholder="商用权利文件或授权记录" />
      <Button className="min-h-11" loading={uploading} disabled={!file || identityRef.trim().length < 12 || rightsRef.trim().length < 12} onClick={() => void upload()}>提交视频候选</Button>
    </div>}
    {item && item.candidateCount > 0 && <div className="space-y-1 text-xs text-text-secondary"><p>{item.candidateCount} 条同品候选待独立核验，生产仍受阻。</p>{item.candidates.map(candidate => <p key={candidate.id}>{candidate.name} · {candidate.bytesCurrent ? '文件可读' : '文件待复核或不可读'} · 文件 SHA {candidate.sha256?.slice(0, 12) || '待读取'}</p>)}</div>}
    {error && <Alert type="error" showIcon title={error} />}
    <Button className="min-h-11" loading={busy} onClick={() => void refresh()}>重新核对素材状态</Button>
  </section>;
}
