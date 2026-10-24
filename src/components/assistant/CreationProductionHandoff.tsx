import { useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { useAssistantStore } from '../../stores/assistantStore';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { creationHandoffRequest, readCreationHandoff } from './contentCreationHandoff';

export default function CreationProductionHandoff({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const enter = async () => {
    if (lock.current) return;
    const selection = useAssistantStore.getState().threads.business.creationDraft;
    if (!selection) return;
    const identity = productionNavigationIdentity();
    lock.current = true; setBusy(true); setError('');
    try {
      const reply = await readCreationHandoff(selection);
      if (productionNavigationIdentity() !== identity || useAssistantStore.getState().threads.business.creationDraft !== selection) throw new Error('当前身份或选择已变化，请重新核验方案。');
      const contentCreationRequest = creationHandoffRequest(reply);
      useAssistantStore.getState().hydrateThread('business', { creationDraft: reply.selection });
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'smartAssets', view: 'create', directStudio: false, navigationIdentity: identity, contentCreationRequest } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '方案交接失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <>
    {error && <Alert type="error" showIcon title={error}/>}
    <Button type="primary" disabled={disabled} loading={busy} onClick={() => void enter()}>带方案进入生产工作台</Button>
    <p className="text-text-secondary">保留当前口播与素材证据，在工作台继续补齐；进入不会启动生成。</p>
  </>;
}
