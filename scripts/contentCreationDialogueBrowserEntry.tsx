import { setToken } from '../src/lib/auth';
import { writeAppearancePreference } from '../src/lib/appearance';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import '../src/styles/design-system.css';
import '../src/styles/creator-workspace.css';
import '../src/components/assistant/assistantDecisionCenter.css';
import ContentCreationHome from '../src/components/ContentCreationHome';
import GlobalAssistant from '../src/components/GlobalAssistant';
import LingshuProvider from '../src/components/ui/LingshuProvider';
import { CreationModeContext, CreationModeControlContext, type CreationMode } from '../src/lib/creationMode';
localStorage.setItem('overseas_token', 'controlled-offline-fixture');
function Fixture() {
  const [mode, setMode] = useState<CreationMode>('free');
  const [identity, setIdentity] = useState('fixture');
  return <LingshuProvider><CreationModeContext.Provider value={mode}><CreationModeControlContext.Provider value={setMode}>
    <div className="h-screen flex flex-col bg-surface text-text-primary"><div className="p-2 border-b border-border text-xs">受控离线夹具 · 无真实账号、供应商或生产执行 <button onClick={() => { const next = identity === 'fixture' ? 'other' : 'fixture'; setToken(`controlled-offline-${next}`); setIdentity(next); }}>切换验收身份</button> <button onClick={() => writeAppearancePreference('light')}>日间验收</button> <button onClick={() => writeAppearancePreference('dark')}>夜间验收</button> <button onClick={() => void fetch('/__fixture/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fail: true }) })}>下次请求失败</button> <button onClick={() => void fetch('/__fixture/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hold: true }) })}>挂起请求</button> <button onClick={() => void fetch('/__fixture/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })}>释放请求</button></div>
      <main className="min-h-0 flex-1"><ContentCreationHome/><GlobalAssistant key={identity} page="strategy" persistenceScope={{ tenantId: identity, userId: `${identity}-user` }}/></main>
    </div>
  </CreationModeControlContext.Provider></CreationModeContext.Provider></LingshuProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
