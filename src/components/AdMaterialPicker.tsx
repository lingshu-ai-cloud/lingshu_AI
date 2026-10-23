import { useState } from 'react';
import { Alert, Button, Drawer, Space, Tag } from 'antd';
import type { AdMaterialSelection } from '../../shared/platformAdCreatives';
import AdSourceCatalog from './AdSourceCatalog';
import './adCreativeLibrary.css';
export default function AdMaterialPicker({ value, onChange, disabled, blockedReason, onOpenChange }: {
  value?: AdMaterialSelection | null; onChange: (selection: AdMaterialSelection | null) => void; disabled?: boolean; blockedReason?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const changeOpen = (next: boolean) => { setOpen(next); onOpenChange?.(next); };
  return <section aria-label="投放素材选择" className="ads-material-picker">
    <Space wrap><Button disabled={disabled} onClick={() => changeOpen(true)}>{value ? '更换已有素材' : '从素材管理选择'}</Button>
      {value && <><span>{value.name}</span><Tag>{value.sourceTenantName}</Tag><Button type="text" disabled={disabled} onClick={() => onChange(null)}>清除选择</Button></>}
    </Space>
    <Drawer className="ads-material-picker-drawer" title="选择投放素材" open={open} onClose={() => changeOpen(false)} size={1000} destroyOnHidden>
      <Alert type="info" showIcon title="选择不会上传或启动广告" description="素材与素材管理共用来源。仅可选择当前企业已核验的 MP4 成片；广告账户、渠道和币种将在绑定时单独核验。"/>
      {open && <AdSourceCatalog blockedReason={blockedReason} onSelect={selection => { onChange(selection); changeOpen(false); }}/>} 
    </Drawer>
  </section>;
}
