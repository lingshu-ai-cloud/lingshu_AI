import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Button, Spin } from 'antd';
import LingshuProvider from './components/ui/LingshuProvider';
import WeeklyCtaContactIntervention from './components/socialProgram/WeeklyCtaContactIntervention';
import WeeklyProductSelectionIntervention from './components/socialProgram/WeeklyProductSelectionIntervention';
import WeeklyProductFootageIntervention from './components/socialProgram/WeeklyProductFootageIntervention';
import WeeklyCollectionCredentialIntervention from './components/socialProgram/WeeklyCollectionCredentialIntervention';
import { authHeader, clearToken, getToken, setToken } from './lib/auth';
import './index.css';

type Scope = { programId: string; packageId: string; packageVersion: number };

function WeeklyTaskCard() {
  const [scope, setScope] = useState<Scope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    // A page left open after this short-lived process stops cannot revoke its
    // own localStorage synchronously; clear on navigation and on failed /me.
    window.addEventListener('pagehide', clearToken);
    return () => window.removeEventListener('pagehide', clearToken);
  }, []);
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let live = true;
    setBusy(true);
    void fetch('/api/overseas/auth/me', { headers: authHeader(), cache: 'no-store' })
      .then(async response => { if (!response.ok) throw Error('当前会话已失效，请重新打开待干预卡。');
        const next = await fetch('/api/overseas/weekly-task-card-scope', { headers: authHeader(), cache: 'no-store' });
        if (!next.ok) throw Error('当前任务作用域不可用，请核对黄金周包版本。');
        return (await next.json() as { item: Scope }).item; })
      .then(item => { if (live && getToken() === token) { setScope(item); setError(''); } })
      .catch(cause => { if (live && getToken() === token) { clearToken(); setScope(null); setError(cause instanceof Error ? cause.message : '任务卡读取失败。'); } })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [refresh]);

  const open = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/overseas/auth/local-task-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: '{}', cache: 'no-store',
      });
      if (!response.ok) throw Error('当前本地测试身份不可用，未打开任务卡。');
      const body = await response.json() as { token?: unknown };
      if (typeof body.token !== 'string' || !body.token.startsWith('weekly-cta-card.v1.')) throw Error('本地会话格式无效。');
      setToken(body.token);
      setRefresh(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '任务卡会话获取失败。'); setBusy(false); }
  };

  return <main className="mx-auto flex min-h-screen w-full max-w-4xl min-w-0 flex-col gap-6 bg-white px-4 py-8 text-text-primary sm:px-6">
    <header className="border-b border-border pb-4"><h1 className="text-[28px] leading-9 font-semibold">周任务待干预</h1></header>
    {error && <Alert type="error" showIcon title={error} />}
    {!scope && <section aria-label="打开当前周任务卡" className="space-y-4">
      <Alert type="warning" showIcon title="当前周包有待干预资料" description="请在本机打开当前测试企业的受限任务卡。会话只在本机有效，15 分钟后过期。" />
      <Button type="primary" className="min-h-11" disabled={busy} onClick={() => void open()}>打开待干预任务卡</Button>
      {busy && <Spin aria-label="正在核验当前身份" />}
    </section>}
    {scope && <section className="flex min-w-0 flex-col gap-5" aria-label="当前周包的待干预字段">
      <Alert type="warning" showIcon title="资料与生产门禁分离" description="填写号码只解决联系字段；样品政策须独立核验。发布选品只确定实际展示商品，不能代替人物、声音、素材与 QA 门禁。" />
      <WeeklyCollectionCredentialIntervention scope={scope} />
      <WeeklyCtaContactIntervention scope={scope} openWhenMissing samplePolicySectionId={`weekly-cta-sample-policy-${scope.packageId}`} />
      <WeeklyProductSelectionIntervention scope={scope} />
      <WeeklyProductFootageIntervention scope={scope} />
    </section>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<LingshuProvider><WeeklyTaskCard /></LingshuProvider>);
