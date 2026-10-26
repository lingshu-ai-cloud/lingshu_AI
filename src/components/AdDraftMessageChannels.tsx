import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button } from 'antd';
import { MetaPageSelect } from './MetaPlanAuditPanel';
import MetaLeadFields, { emptyMetaLeadFields, type MetaLeadFieldsValue } from './MetaLeadFields';
import type { MetaMessageChoice } from '../../shared/metaMessageChoice';

export default function AdDraftMessageChannels({ connectionId, value, onChange, onAuthorize, accountPicker }: { accountPicker: ReactNode; connectionId?: string; value?: MetaMessageChoice; onChange: (value: MetaMessageChoice | undefined) => void; onAuthorize: () => void }) {
  const [lead, setLead] = useState<MetaLeadFieldsValue>({ ...emptyMetaLeadFields, messageDestination: value?.destination || '' });
  useEffect(() => { setLead({ ...emptyMetaLeadFields, messageDestination: value?.destination || '' }); }, [connectionId, value?.pageId]);
  const pageId = value?.pageId || '';
  const update = (next: MetaLeadFieldsValue) => {
    setLead(next);
    if (!pageId) return;
    const recipientId = next.messageDestination === 'MESSENGER' ? pageId : next.messageDestination === 'WHATSAPP' ? next.whatsappPhoneNumber : next.instagramActorId;
    const choice: MetaMessageChoice = { pageId, destination: next.messageDestination as MetaMessageChoice['destination'], recipientId };
    if (JSON.stringify(choice) !== JSON.stringify(value)) onChange(choice);
  };
  return <section className="ads-draft-message-channels" aria-label="选择客户咨询的聊天渠道">
    <h3>聊天渠道与绑定</h3>
    {accountPicker}
    {!connectionId ? <Alert type="info" showIcon title="请在上方选择已有广告账户，点击“用于此草稿”后读取主页与聊天渠道。" description="广告账户用于支付和管理广告；它与客户联系你的聊天账号分别关联。"/> : <>
      <MetaPageSelect connectionId={connectionId} value={pageId} onChange={id => onChange(id ? { pageId: id, destination: '', recipientId: '' } : undefined)}/>
      <MetaLeadFields key={`${connectionId}:${pageId}`} goal="获取消息会话" connectionId={connectionId} pageId={pageId} value={lead} onChange={update} onAuthorize={onAuthorize}/>
      {!pageId && <Button type="link" onClick={onAuthorize}>补充 Facebook 主页授权</Button>}
    </>}
    <Button type="link" onClick={onAuthorize}>连接新的广告账户 / 补充 Meta 授权</Button>
  </section>;
}
