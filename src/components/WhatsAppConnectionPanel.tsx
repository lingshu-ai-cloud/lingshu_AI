import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { verifyWhatsAppConnection, disconnectWhatsApp, getWhatsAppEmbeddedSignupConfig, prepareWhatsAppEmbeddedSignup, startWhatsAppEmbeddedSignup,
  type PreparedWhatsAppSignup, type WhatsAppSignupConfig } from '../lib/whatsappEmbeddedSignup';

export default function WhatsAppConnectionPanel() {
  const [config, setConfig] = useState<WhatsAppSignupConfig | null>(null);
  const [prepared, setPrepared] = useState<PreparedWhatsAppSignup | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(async () => {
    setPrepared(null); setBusy(true); setError('');
    try { setConfig(await getWhatsAppEmbeddedSignupConfig()); }
    catch (reason) { setConfig(null); setError(reason instanceof Error ? reason.message : '连接状态读取失败'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const connect = async () => {
    if (!config) return;
    setBusy(true); setError('');
    try {
      if (prepared) { await startWhatsAppEmbeddedSignup(prepared); setPrepared(null); await load(); }
      else setPrepared(await prepareWhatsAppEmbeddedSignup(config));
    } catch (reason) { setPrepared(null); setError(reason instanceof Error ? reason.message : '连接未完成'); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError('');
    try { const result = await verifyWhatsAppConnection(); await load(); if (!result.connected) setError('连接检测未通过，请核对 Meta 号码状态并重新授权。'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '连接检测失败'); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setError('');
    try { await disconnectWhatsApp(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '断开连接失败'); }
    finally { setBusy(false); }
  };
  return <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-white p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3">
      <SocialPlatformIcon platform="whatsapp" size={26}/><div><h2 className="text-sm font-semibold text-text-primary">WhatsApp 企业消息接入</h2>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">由企业管理员授权自己的企业账户和号码，客户新消息将进入灵枢客服。</p></div></div>
      <button type="button" aria-label="刷新 WhatsApp 连接状态" disabled={busy} onClick={() => void load()} className="btn-ghost"><RefreshCw size={15}/></button></div>
    <p role="status" className="text-sm text-text-primary">{config?.connected ? `已授权号码：+${config.account?.phoneNumber}` : config?.account?.status === 'token_expired' ? '授权已失效，请重新授权' : config?.account?.status === 'error' ? '连接检测异常，请检测连接或重新授权' : '尚未完成企业号码连接'}</p>
    {config?.account?.legacy && <p className="text-xs text-text-muted">检测到旧接入记录，平台管理员需先核对迁移条件。</p>}
    {config && (!config.configured || !config.storageReady) && <p className="text-xs text-text-muted">平台接入准备尚未完成，请联系管理员。</p>}
    {prepared && <p className="text-xs text-text-muted">授权窗口已准备好。继续后请在 Meta 中选择你的企业和号码，授权准备十分钟内有效。</p>}
    {error && <p role="alert" className="text-xs text-red">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !config?.configured || !config.storageReady} onClick={() => void connect()} className="btn-primary">
      {busy ? '处理中…' : prepared ? '前往 Meta 授权' : config?.connected ? '重新授权' : '开始连接 WhatsApp'}</button>
      {config?.account && !config.account.legacy && <button type="button" disabled={busy} onClick={() => void verify()} className="btn-ghost">检测连接</button>}
      {config?.account && !config.account.legacy && config.account.status !== 'pending' && <button type="button" disabled={busy} onClick={() => void disconnect()} className="btn-ghost">停止灵枢接入</button>}
      {prepared && <button type="button" disabled={busy} onClick={() => setPrepared(null)} className="btn-ghost">取消</button>}</div>
    <p className="text-xs leading-relaxed text-text-muted">连接成功后仍需验证真实收发。停止接入后灵枢不再处理该号码消息；Meta 授权可在企业后台另行撤销。</p>
  </section>;
}
