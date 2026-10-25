import { useEffect, useRef } from 'react';
import { Alert, Button, Select, Space, Spin } from 'antd';
import { useMetaDestinationAssets } from './useMetaDestinationAssets';
export type MetaLeadFieldsValue = { messageDestination: string; whatsappPhoneNumber: string; instagramActorId: string; instagramUsername: string; leadFormId: string; pixelId: string };
export const emptyMetaLeadFields: MetaLeadFieldsValue = { messageDestination: 'WHATSAPP', whatsappPhoneNumber: '', instagramActorId: '', instagramUsername: '', leadFormId: '', pixelId: '' };
export default function MetaLeadFields({ goal, value, onChange, connectionId = '', pageId = '', onAvailability, onAuthorize }: { goal: string; value: MetaLeadFieldsValue; onChange: (value: MetaLeadFieldsValue) => void; connectionId?: string; pageId?: string; onAvailability?: (ready: boolean) => void; onAuthorize?: () => void }) {
  const kind = goal === '获取Meta表单线索' ? 'forms' : goal === '获取消息会话' ? 'messages' : goal === '获取独立站询盘' ? 'pixels' : null;
  const { data, loading, error, errorCode, refresh } = useMetaDestinationAssets(connectionId, pageId, kind);
  const change = useRef(onChange); change.current = onChange;
  useEffect(() => {
    if (!data) return;
    const next = { ...emptyMetaLeadFields, messageDestination: value.messageDestination };
    if (data?.kind === 'forms') next.leadFormId = data.forms.some(f => f.id === value.leadFormId) ? value.leadFormId : data.forms.length === 1 ? data.forms[0].id : '';
    if (data?.kind === 'pixels') next.pixelId = data.pixels.some(p => p.id === value.pixelId) ? value.pixelId : data.pixels.length === 1 ? data.pixels[0].id : '';
    if (data?.kind === 'messages') {
      next.whatsappPhoneNumber = data.whatsappPhoneNumber;
      next.instagramActorId = data.instagram?.id || ''; next.instagramUsername = data.instagram?.username || '';
      if (!next.messageDestination && !next.whatsappPhoneNumber && !next.instagramActorId) next.messageDestination = 'MESSENGER';
    }
    if (JSON.stringify(next) !== JSON.stringify(value)) change.current(next);
  }, [data, value]);
  const ready = !!data && (kind === 'forms' ? data.termsAccepted === true && data.forms.some(f => f.id === value.leadFormId) : kind === 'pixels' ? data.pixels.some(p => p.id === value.pixelId) : value.messageDestination === 'MESSENGER' || value.messageDestination === 'WHATSAPP' && !!data.whatsappPhoneNumber || value.messageDestination === 'INSTAGRAM_DIRECT' && !!data.instagram);
  useEffect(() => { onAvailability?.(ready); }, [ready, onAvailability]);
  if (!kind) return null;
  const form = data?.forms.find(f => f.id === value.leadFormId);
  return <div className="ads-destination-assets" role="region" aria-label="自动关联获客资产">
    <Space wrap><strong>{kind === 'forms' ? '获客表单' : kind === 'messages' ? '消息接收账户' : '网站数据源'}</strong><Button type="link" disabled={!connectionId || !pageId || loading} onClick={refresh}>重新同步</Button></Space>
    {!connectionId || !pageId ? <p role="status">关联广告账户后，系统自动匹配可用主页与获客资产。</p> : loading ? <Spin description="正在自动关联平台资产…"/> : error ? <Alert type="error" showIcon title={['10', '190', '200', 'PAGE_AUTH_REQUIRED', 'AUTH_REQUIRED', 'AUTH_EXPIRED'].includes(errorCode || '') ? '当前授权不足或已失效' : '未能读取平台资产'} description={<>{error}。可重新同步；无需填写平台编号。{onAuthorize && <Button type="link" onClick={onAuthorize}>补充授权</Button>}</>}/> : data && <>
      {kind === 'forms' && <>
        {data.forms.length === 0 ? <Alert type="warning" showIcon title="该主页尚无可用的已发布表单" description="系统已自动检查。准备表单内容后才能创建表单广告；无需查找或填写表单编号。"/> : <>
          {data.forms.length === 1 ? <p role="status">已自动关联：{data.forms[0].name}{data.forms[0].locale ? ` · ${data.forms[0].locale}` : ''}</p> : <label>确认要使用的表单<Select aria-label="获客表单" style={{ width: '100%' }} value={value.leadFormId || undefined} placeholder="确认符合本次推广内容的表单" onChange={leadFormId => onChange({ ...value, leadFormId })} options={data.forms.map(f => ({ value: f.id, label: `${f.name}${f.locale ? ` · ${f.locale}` : ''}` }))}/></label>}
          {form && <p className="ads-muted">客户填写内容：{form.questions.join('、') || '平台未返回字段摘要，请在正式创建前预览表单内容。'}</p>}
        </>}
        {data.termsAccepted !== true && <Alert type="warning" showIcon title={data.termsAccepted === false ? '主页线索广告条款尚未确认' : '尚未确认主页线索广告条款状态'} description="需要主页管理员在 Meta 确认条款或核对授权；系统不会代签平台条款。"/>}
      </>}
      {kind === 'messages' && <>
        <label>客户通过哪个聊天渠道联系你<Select aria-label="消息目的地" style={{ width: '100%' }} value={value.messageDestination || undefined} placeholder="选择接收客户咨询的渠道" onChange={messageDestination => onChange({ ...value, messageDestination })} options={[{ value: 'WHATSAPP', label: data.whatsappPhoneNumber ? `WhatsApp · ${data.whatsappPhoneNumber}` : 'WhatsApp · 该主页未返回已关联号码', disabled: !data.whatsappPhoneNumber }, { value: 'MESSENGER', label: 'Messenger · 使用当前 Facebook 主页私信' }, { value: 'INSTAGRAM_DIRECT', label: data.instagram ? `Instagram 私信 · @${data.instagram.username}` : 'Instagram 私信 · 该主页未返回已关联专业账户', disabled: !data.instagram }]}/></label>
        {value.messageDestination && !ready && <Alert type="warning" showIcon title="原选择的聊天渠道当前不可用，请绑定后同步或自行选择其他渠道；系统不会自动切换。"/>}
        <div className="ads-message-bindings">
          <p><strong>Messenger</strong> · 已关联所选主页，可选择；平台消息设置和广告资格仍须创建前检查。</p>
          <p><strong>WhatsApp</strong> · {data.whatsappPhoneNumber ? `已绑定：${data.whatsappPhoneNumber}` : '该主页未返回已关联号码'}{!data.whatsappPhoneNumber && <Button type="link" href="https://business.facebook.com/latest/settings" target="_blank" rel="noopener noreferrer">去 Meta 绑定 WhatsApp</Button>}</p>
          <p><strong>Instagram 私信</strong> · {data.instagram ? `已绑定：@${data.instagram.username}` : '该主页未返回已关联专业账户'}{!data.instagram && <Button type="link" href="https://business.facebook.com/latest/settings" target="_blank" rel="noopener noreferrer">去 Meta 绑定 Instagram</Button>}</p>
          <p className="ads-muted">在 Meta Business Suite 选择当前主页，在关联账户中连接企业 WhatsApp 号码或 Instagram 专业账户。验证码、账号登录与授权由你在 Meta 完成。返回此页会自动刷新，也可点“重新同步”。仅从授权目录未读到关联信息时，不等于账号不存在。</p>
          {onAuthorize && <Button type="link" onClick={onAuthorize}>已绑定但未显示？补充授权</Button>}
        </div>
      </>}
      {kind === 'pixels' && <>
        {data.pixels.length === 0 ? <Alert type="warning" showIcon title="广告账户尚无可用的网站数据源" description="系统未找到已分配的数据源，请管理员完成网站数据源接入；无需填写 Pixel 编号。"/> : data.pixels.length === 1 ? <p role="status">已自动关联：{data.pixels[0].name}</p> : <label>确认网站数据源<Select aria-label="网站数据源" style={{ width: '100%' }} value={value.pixelId || undefined} placeholder="确认本次推广网站的数据源" options={data.pixels.map(p => ({ value: p.id, label: p.name }))} onChange={pixelId => onChange({ ...value, pixelId })}/></label>}
        <p className="ads-muted">成功提交询盘后回传 Lead；关联数据源不代表网站事件已验证。</p>
      </>}
    </>}
  </div>;
}
