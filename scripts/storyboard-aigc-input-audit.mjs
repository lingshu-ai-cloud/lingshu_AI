import fs from 'node:fs';
import path from 'node:path';

const matrix = JSON.parse(fs.readFileSync('fixtures/storyboard-aigc-acceptance/matrix.json', 'utf8'));
const account = JSON.parse(fs.readFileSync('fixtures/beauty-showcase/account-data.json', 'utf8'));
const records = [
  ...account.materials.map(item => ({ kind: 'material', id: item.id, path: item.file || item.url, usage: item.usage || 'unknown', sourceType: item.sourceType || 'unknown', licenseName: item.licenseName || '' })),
  ...account.collections.trend_videos.flatMap(item => [item.thumbnailUrl, item.videoFileId].filter(Boolean).map(file => ({ kind: 'trend_video', id: item.id, path: file, usage: 'reference_only', sourceType: item.sourceType || 'unknown', licenseName: '' }))),
];
const cases = matrix.cases.map(item => ({
  caseId: item.id,
  references: item.references.map(reference => {
    const matches = records.filter(record => String(record.path || '').endsWith(reference));
    const source = matches.length === 1 ? matches[0] : null;
    return {
      file: reference,
      sourceRecordId: source?.id || null,
      sourceKind: source?.kind || 'unmatched',
      usage: source?.usage || 'unverified',
      sourceType: source?.sourceType || 'unverified',
      licenseName: source?.licenseName || null,
      directSupplierReferenceAllowedByLocalUsage: false,
      reason: source?.usage === 'reference_only'
        ? 'Local record limits this asset to reference analysis; do not send the original media to a generator.'
        : source?.usage === 'editable'
          ? 'Local record permits editing; supplier submission still needs a separate verified processing decision.'
          : 'No unique local source record or usage evidence; keep supplier input disabled.',
    };
  }),
}));
const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  note: 'This audits local usage metadata only; it does not grant legal rights or prove generated-media quality. Analysis-only references may still inform locally derived shot descriptions.',
  cases,
  summary: {
    cases: cases.length,
    references: cases.reduce((n, item) => n + item.references.length, 0),
    referenceOnly: cases.flatMap(item => item.references).filter(item => item.usage === 'reference_only').length,
    editableNeedsSupplierReview: cases.flatMap(item => item.references).filter(item => item.usage === 'editable').length,
    unmatched: cases.flatMap(item => item.references).filter(item => item.sourceKind === 'unmatched').length,
  },
};
const out = path.resolve(process.argv[2] || 'data/qa-reports/storyboard-aigc-input-audit-2026-10-04.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ out, summary: report.summary }));
