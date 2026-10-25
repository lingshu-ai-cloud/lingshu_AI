import { useState } from 'react';
import { Alert, Button, Drawer, Space } from 'antd';
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
      {value && <><span>{value.name}</span><Button type="text" disabled={disabled} onClick={() => onChange(null)}>清除选择</Button></>}
    </Space>
    <Drawer className="ads-material-picker-drawer" title="选择投放素材" open={open} onClose={() => changeOpen(false)} size={1000} destroyOnHidden>
      <Alert type="info" showIcon title="选择不会上传或启动广告" description="文件可用且有使用权限的 MP4 成片可以选择。内部内容尚未确认不阻止选择，也不代表 Meta 广告已通过审核；广告账户、渠道和币种在绑定时单独核验。"/>
      {open && <AdSourceCatalog blockedReason={blockedReason} onSelect={selection => { onChange(selection); changeOpen(false); }}/>}
    </Drawer>
  </section>;
}
