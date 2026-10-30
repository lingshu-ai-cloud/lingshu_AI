import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { videoPipelineFailure, videoPipelineFailureForAnalysis } from './videoPipelineFailure.js';

test('failures distinguish collection, media, admission and analysis without exposing provider payloads', () => {
  const cases = [
    ['COS video not found', 'media_missing', false],
    ['403 platform-feature-disabled Monthly usage hard limit exceeded', 'collection_quota', false],
    ['400 DataInspectionFailed input image inappropriate', 'content_rejected', false],
    ['image_post_queue_persistence_failed', 'queue_admission', true],
    ['Qwen request timed out', 'timeout', true],
    ['yt-dlp unable to download webpage', 'source_unavailable', true],
    ['unexpected provider response', 'analysis_failed', true],
  ] as const;
  for (const [raw, code, retryable] of cases) {
    const result = videoPipelineFailure(`${raw} private-token-do-not-expose`);
    assert.equal(result.code, code);
    assert.equal(result.retryable, retryable);
    assert.doesNotMatch(JSON.stringify(result), /private-token/);
    assert.ok(result.message && result.action);
  }
  assert.equal(videoPipelineFailure('').code, 'none');
});

test('safe classifications survive re-projection without trusting supplied messages or replacing newer raw errors', () => {
  const previous = { code: 'content_rejected', message: 'private-secret', action: 'unsafe-action', retryable: true };
  const safe = videoPipelineFailureForAnalysis({ pipelineFailure: previous });
  assert.equal(safe.code, 'content_rejected');
  assert.equal(safe.retryable, false);
  assert.doesNotMatch(JSON.stringify(safe), /private-secret|unsafe-action/);
  assert.equal(videoPipelineFailureForAnalysis({ pipelineFailure: previous, analysisError: 'Request timed out' }).code, 'timeout');
  assert.equal(videoPipelineFailureForAnalysis({ pipelineFailure: { code: 'unknown-private-code' } }).code, 'none');
});

test('public failure parser accepts frontend interfaces and backend records without requiring an index signature', () => {
  const source = readFileSync(new URL('./videoPipelineFailure.ts', import.meta.url), 'utf8');
  const fixture = `import { videoPipelineFailureForAnalysis } from './pipeline';
    interface Payload { analysisError?: string; pipelineFailure?: { code: string } }
    declare const frontend: Payload | undefined;
    declare const backend: Record<string, unknown>;
    videoPipelineFailureForAnalysis(frontend || {});
    videoPipelineFailureForAnalysis(backend);`;
  const options: import('typescript').CompilerOptions = { noEmit: true, strict: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, ...rest) => file === '/pipeline.ts' || file === '/fixture.ts'
    ? ts.createSourceFile(file, file === '/pipeline.ts' ? source : fixture, version, true)
    : getSourceFile(file, version, ...rest);
  host.resolveModuleNames = names => names.map(name => name === './pipeline' ? { resolvedFileName: '/pipeline.ts' } : undefined);
  const program = ts.createProgram(['/fixture.ts', '/pipeline.ts'], options, host);
  const diagnostics = program.getSemanticDiagnostics();
  assert.deepEqual(diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, ' ')), []);
});
