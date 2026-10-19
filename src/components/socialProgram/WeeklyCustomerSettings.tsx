import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Checkbox,Popconfirm} from 'antd';
import {weeklyCustomerRunApi as api} from '../../lib/weeklyCustomerRunApi';
import {getToken} from '../../lib/auth';
export default function WeeklyCustomerSettings({programId,packageId,packageVersion}:{programId:string;packageId:string;packageVersion:number}){
 const token=getToken(),identity=JSON.stringify([programId,packageId,packageVersion,token]),current=useRef(identity);current.current=identity;
 const [settings,setSettings]=useState<Awaited<ReturnType<typeof api.settings>>|null>(null),[enabled,setEnabled]=useState(false),[consent,setConsent]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const active=()=>current.current===identity&&getToken()===token;
 useEffect(()=>{let live=true;setSettings(null);setError('');void api.settings(programId,packageId,packageVersion).then(s=>{if(live&&active()){setSettings(s);setEnabled(s.enabled);setConsent(s.allowRealCustomerMessages);}}).catch(e=>{if(live&&active())setError(e instanceof Error?e.message:String(e));});return()=>{live=false;};},[identity,revision]);
 async function save(){if(!settings||busy||!active())return;setBusy(true);setError('');try{const s=await api.saveSettings(programId,packageId,packageVersion,{expectedConfigVersion:settings.configVersion,enabled,allowRealCustomerMessages:enabled&&consent});if(active()){setSettings(s);window.dispatchEvent(new Event('lingshu:agent-business-refresh'));}}catch(e){if(active())setError(e instanceof Error?e.message:String(e));}finally{if(active())setBusy(false);}}
 return <section aria-label="客服执行中补充配置" className="space-y-3 rounded-lg border p-4"><h4 className="font-semibold">客服执行条件</h4><p className="text-sm">常驻窗口00:00至次日00:00；渠道未连接只阻塞对应分支。授权后仍保留逐客审批、商业承诺审核和发送安全开关。</p>
 {error&&<Alert showIcon type="error" title={error}/>}
 {settings&&<><Checkbox checked={enabled} onChange={e=>{setEnabled(e.target.checked);if(!e.target.checked)setConsent(false);}}>启用客服智能体</Checkbox><Checkbox disabled={!enabled} checked={consent} onChange={e=>setConsent(e.target.checked)}>允许已连接渠道按现有审批规则发送真实消息</Checkbox><Popconfirm title="保存客服启用与真实消息许可？" description="不会授权社媒发布，也不会伪造渠道权限。" onConfirm={()=>void save()}><Button loading={busy}>保存这两项客服配置</Button></Popconfirm><p className="text-xs">当前配置版本：{settings.configVersion}。实际授权由服务端按渠道逐次核验。</p></>}
 <Button onClick={()=>window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{page:'accountManagement'}}))}>连接或修复渠道账号</Button><Button disabled={busy} onClick={()=>setRevision(v=>v+1)}>重新读取条件</Button>
 </section>;
}
