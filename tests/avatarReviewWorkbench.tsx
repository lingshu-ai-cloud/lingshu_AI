// Development-only browser fixture for the real editing panel. No network or supplier calls.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ShotProductionPanel from '../src/components/ShotProductionPanel';
import { newShotProduction, shotFingerprint, patchShot, EMPTY_DEFAULTS, type AvatarJob, type ShotProduction } from '../src/lib/shotProduction';
import '../src/index.css';
const initial: ShotProduction = { ...newShotProduction('设备介绍', 'alice'), source: 'avatar', sound: 'source' };
const fingerprint = shotFingerprint(initial, 'fixture');
initial.candidates = [{ id: 'c1', jobId: 'j1', materialId: 'm1', source: 'avatar', fingerprint, createdAt: '' }];
function Workbench() {
  const [shot, setShot] = useState(initial);
  const [calls, setCalls] = useState(0);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<AvatarJob>({ id: 'j1', projectId: 'p1', assemblyId: 'a1', shotId: 's1', fingerprint, status: 'pending', error: '供应商已生成，但下载或技术检查未通过：音轨缺失', createdAt: '', updatedAt: '' });
  return <main className="relative h-screen bg-slate-100">
    <output aria-label="测试状态" className="absolute left-4 top-4">模拟刷新次数：{calls}；采用：{shot.adoptedId || '无'}</output>
    <ShotProductionPanel shot={shot} context="fixture" title="数字人核验交互测试" defaults={EMPTY_DEFAULTS} materials={[]} products={[]} jobs={[job]} refreshingJobIds={busy ? ['j1'] : []}
      reason="仅验证前端交互，供应商返回使用测试替身" error="" busy={false} configured={false} costPerSecond={null}
      onChange={patch => setShot(value => patchShot(value, patch))} onClose={() => {}} onNarration={() => {}} onDefaults={async () => {}}
      onGenerate={() => { throw new Error('测试禁止付费生成'); }} onAi={() => { throw new Error('测试禁止付费生成'); }} onShoot={() => {}} onMaterial={() => {}}
      onAdopt={id => setShot(value => ({ ...value, adoptedId: id }))}
      onRefresh={() => { if (busy) return; setBusy(true); setCalls(value => value + 1); window.setTimeout(() => { setJob(value => ({ ...value, status: 'completed', materialId: 'm1', error: '' })); setBusy(false); }, 700); }} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Workbench />);
