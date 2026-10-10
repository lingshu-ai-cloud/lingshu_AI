import {createDefaultStarter198Router} from '../starter198/router.js';
import {createMobileWorkbenchQueueRouter} from './mobileWorkbenchQueue.js';
import {transcribeMobileVoice} from './mobileWorkbench.js';
import {store} from '../storage/index.js';

// HTTP adapters are composed here, outside the starter workspace domain.
export const starter198Router = createDefaultStarter198Router({
  queueRouter: workspace => createMobileWorkbenchQueueRouter(store, workspace),
  transcribe: transcribeMobileVoice,
});
