/** Local, synthetic UI acceptance only; no analysis or production calls. */
import { createRoot } from 'react-dom/client';
import { DirectorVideoDetailPanel } from '../components/InspirationDashboard';
import { benchmarkVideoFixture } from '../../tests/fixtures/benchmarkVideo';
import { buildBenchmarkAnalysis } from '../../shared/benchmarkAnalysis';
import type { VideoAnalysisPayload } from '../lib/inspirationTypes';
import '../index.css';
const state = new URLSearchParams(window.location.search).get('state');
const fixture = benchmarkVideoFixture();
if (state === 'pending') { fixture.requestedAnalysisMode = 'exact'; fixture.geminiStatus = 'queued'; }
if (state === 'failed') { fixture.analysisError = 'isolated-fixture-failure'; fixture.geminiStatus = 'failed'; }
if (state === 'legacy') {
  const gemini = fixture.gemini as Record<string, unknown>; delete gemini.hookAnalysis;
  (gemini.scriptDetails15s as Record<string, unknown>[]).forEach(row => { delete row.materialType; delete row.narrativeRole; });
}
const payload = fixture as VideoAnalysisPayload;
payload.benchmarkAnalysis = buildBenchmarkAnalysis({ analysis: fixture, videoId: 'video-fixture', duration: 9, evidenceRevision: 'isolated-fixture' });
createRoot(document.getElementById('root')!).render(<DirectorVideoDetailPanel
  video={{ id: 'video-fixture', title: '隔离验收样例 · 护肤品定制对标视频', platform: 'tiktok', duration: 9,
    thumbnail: '', tags: [], views: '', trend: 'stable', status: 'analyzed', contentFormat: 'video', aiAnalysis: payload }}
  onClose={() => {}} onPreview={() => {}} onCreate={() => {}} onRetry={() => {}}
  onExactAnalysis={() => {}} onCancelAnalysis={() => {}} onFavorite={() => {}} analyzing={state === 'pending'}
/>);
