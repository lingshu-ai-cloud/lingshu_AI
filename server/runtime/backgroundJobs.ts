import { initDigitalEmployeeRuntime } from '../digitalEmployees/runtimeOrchestrator.js';
import { initFollowupDispatchWorker } from '../digitalEmployees/followupDispatchWorker.js';
import { initScheduledPublisher } from '../publishing/scheduledPublisher.js';
import { initStarterPublicationPackageWorker } from '../starter198/publicationPackageWorker.js';
import { initStarterQuoteArtifactWorker } from '../starter198/quoteArtifactWorker.js';
import { initStarter198OrchestratorWorker } from '../starter198/orchestratorWorker.js';
import { initCrawlWorkerCloudFallback } from '../routes/crawlWorker.js';
import { initScheduler } from '../routes/scheduler.js';
import { initTenantPlatformTokenMonitor } from '../routes/tenantPlatformTokenMonitor.js';
import { initCrawlerOpsWorker, initPocketBaseVideoBackfill } from '../routes/videos.js';
import { initWhatsAppCustomerMaintenance } from '../whatsapp/historyImport.js';
import { startAdAutomationWorker } from '../platformAds/automation.js';

export async function startBackgroundJobs(): Promise<void> {
  console.log('[runtime] starting background jobs');
  await initScheduler();
  initScheduledPublisher();
  initCrawlerOpsWorker();
  initPocketBaseVideoBackfill();
  initCrawlWorkerCloudFallback();
  initTenantPlatformTokenMonitor();
  await initWhatsAppCustomerMaintenance();
  initFollowupDispatchWorker();
  initStarterPublicationPackageWorker();
  initStarterQuoteArtifactWorker();
  initStarter198OrchestratorWorker();
  startAdAutomationWorker();
  initDigitalEmployeeRuntime();
  console.log('[runtime] background jobs started');
}
