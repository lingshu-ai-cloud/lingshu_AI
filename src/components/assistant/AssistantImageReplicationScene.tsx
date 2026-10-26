import { lazy, Suspense } from 'react';
import { Spin } from 'antd';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import type { ImageReplicationIntake, ImageReplicationReferenceIdentity } from '../../lib/imageReplicationIntake';
import { useAssistantStore } from '../../stores/assistantStore';
import { PRIMARY_ASSISTANT_THREAD } from './globalAssistantRuntime';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import type { SocialContentCreateRequest } from '../socialContent/SocialContentWorkspace';

const ImageReplicationConversation = lazy(() => import('../socialContent/ImageReplicationConversation'));

/** Store only intake answers and task pointers in the existing assistant journal. */
export default function AssistantImageReplicationScene({ portal, request }: {
  portal: AssistantCreationPortal; request: SocialContentCreateRequest;
}) {
  const update = (intake: ImageReplicationIntake, reference?: ImageReplicationReferenceIdentity | null) => {
    const store = useAssistantStore.getState();
    store.setMessages(PRIMARY_ASSISTANT_THREAD, store.threads[PRIMARY_ASSISTANT_THREAD].messages.map(message =>
      message.creationPortal?.id === portal.id ? { ...message, creationPortal: {
        ...message.creationPortal, imageReplication: { ...message.creationPortal.imageReplication, intake,
          ...(reference === null ? { reference: undefined } : reference ? { reference } : {}) },
      } } : message));
  };
  return <Suspense fallback={<Spin size="small" description="正在打开图文爆款复刻对话"/>}>
    <ImageReplicationConversation embedded request={request}
      checkpoint={portal.imageReplication?.intake} operationKey={portal.id} onCheckpoint={update}
      onShowCreations={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: {
        page: 'smartAssets', navigationIdentity: productionNavigationIdentity(),
      } }))}/>
  </Suspense>;
}
