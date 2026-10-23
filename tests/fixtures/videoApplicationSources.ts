import { readFileSync } from 'node:fs';
import ts from 'typescript';

export function readVideoApplicationSources(): string {
  return [
    new URL('../../server/videos/runtimeConfig.ts', import.meta.url),
    new URL('../../server/videos/contracts.ts', import.meta.url),
    new URL('../../server/videos/crawlerObjectStorage.ts', import.meta.url),
    new URL('../../server/videos/exactEvidencePersistence.ts', import.meta.url),
    new URL('../../server/videos/videoVisibilityMaintenance.ts', import.meta.url),
    new URL('../../server/videos/videoCollectionApplication.ts', import.meta.url),
    new URL('../../server/videos/imagePostCollectionApplication.ts', import.meta.url),
    new URL('../../server/routes/videoCollectionRoutes.ts', import.meta.url),
    new URL('../../server/routes/videoSourceRequestRoutes.ts', import.meta.url),
    new URL('../../server/routes/videoOpsRoutes.ts', import.meta.url),
    new URL('../../server/routes/videoReferenceImportRoutes.ts', import.meta.url),
    new URL('../../server/routes/videoRecordMutationRoutes.ts', import.meta.url),
    new URL('../../server/routes/videoReferenceReviewRoutes.ts', import.meta.url),
    new URL('../../server/routes/videoAssetRoutes.ts', import.meta.url),
    new URL('../../server/routes/videoAnalysisControlRoutes.ts', import.meta.url),
    new URL('../../server/videos/sourceAnalysisSubmission.ts', import.meta.url),
    new URL('../../server/videos/videoBackgroundWorkers.ts', import.meta.url),
    new URL('../../server/videos/materialAcquisitionApplication.ts', import.meta.url),
    new URL('../../server/videos/videoDownloadRuntime.ts', import.meta.url),
    new URL('../../server/videos/sourceAnalysisExecution.ts', import.meta.url),
    new URL('../../server/videos/materialAnalysisExecution.ts', import.meta.url),
    new URL('../../server/videos/queuedMaterialAnalysis.ts', import.meta.url),
    new URL('../../server/videos/videoCollectionProviders.ts', import.meta.url),
    new URL('../../server/videos/imagePostCollectionProviders.ts', import.meta.url),
    new URL('../../server/videos/videoDiscoverySearch.ts', import.meta.url),
    new URL('../../server/videos/accountCollectionProvider.ts', import.meta.url),
    new URL('../../server/videos/videoDownloadFallbacks.ts', import.meta.url),
    new URL('../../server/videos/apifyFallbackRuntime.ts', import.meta.url),
    new URL('../../server/videos/videoAnalysisProvider.ts', import.meta.url),
    new URL('../../server/videos/exactVideoAnalysis.ts', import.meta.url),
    new URL('../../server/videos/videoDownloaderTransport.ts', import.meta.url),
    new URL('../../server/videos/crawlerOpsApplication.ts', import.meta.url),
    new URL('../../server/videos/materialFileRepository.ts', import.meta.url),
    new URL('../../server/videos/localMediaProcessing.ts', import.meta.url),
    new URL('../../server/videos/videoAnalysisRequestPolicy.ts', import.meta.url),
    new URL('../../server/videos/referenceImportApplication.ts', import.meta.url),
    new URL('../../server/videos/application.ts', import.meta.url),
    new URL('../../server/routes/videos.ts', import.meta.url),
  ].map(file => readFileSync(file, 'utf8')).join('\n');
}

/** Select an implementation rather than a legacy forwarding entry. */
export function videoApplicationFunction(source: string, name: string): string {
  const parsed = ts.createSourceFile('videoContract.ts', source, ts.ScriptTarget.Latest, true);
  let result = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.getText(parsed).length > result.length) result = node.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (!result) throw new Error('Missing video application function: ' + name);
  return result;
}

export function videoRouteBlock(source: string, start: string): string {
  const parsed = ts.createSourceFile('videoContract.ts', source, ts.ScriptTarget.Latest, true);
  let result = '';
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.getText(parsed).startsWith(start)) result = node.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (!result) throw new Error('Missing video route: ' + start);
  return result;
}
