import { useEffect } from 'react';
import { productionPortalNavigation } from '../assistant/AssistantProductionPortal';
import { productionNavigationIdentity } from '../../lib/productionNavigation';

/** Read-only compatibility handoff for old standalone task links. */
export default function CreationTaskLocation({taskId}:{taskId:string}) {
  useEffect(()=>{window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{...productionPortalNavigation(taskId),navigationIdentity:productionNavigationIdentity()}}));},[taskId]);
  return <p role="status">正在打开创作任务…</p>;
}
