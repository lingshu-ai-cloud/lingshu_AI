import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const detail = fs.readFileSync('src/components/assistant/AssistantContentTaskDetail.tsx', 'utf8');
const actions = fs.readFileSync('src/components/assistant/useAssistantTaskCardActions.ts', 'utf8');
const projection = fs.readFileSync('shared/contracts/assistantContentTaskCard.ts', 'utf8');
const refresh = fs.readFileSync('src/components/assistant/useAssistantContentTaskCard.ts', 'utf8');

test('assistant reviews exact artifact versions and never promotes a local-only adoption state', () => {
  assert.match(projection, /artifactId:\s*artifact\.artifactId[\s\S]{0,120}version:\s*artifact\.version[\s\S]{0,120}status:\s*artifact\.status/);
  assert.match(actions, /authoritative\.version !== artifact\.version[\s\S]{0,300}socialContentApi\.decideArtifact[\s\S]{0,250}expectedVersion:\s*artifact\.version/);
  assert.match(actions, /persistContentTask\(result\.task\)/, 'successful adoption must replace the card from the returned server task');
  assert.doesNotMatch(detail, /set[A-Za-z]*(?:Approved|Adopted)|status:\s*['"]approved['"]/, 'the UI must not manufacture an approved status');
});

test('another window refreshes artifact and delivery changes even when aggregate cursor is unchanged', () => {
  assert.match(refresh, /lastProjection = JSON\.stringify/);
  assert.match(refresh, /projection = JSON\.stringify\(card\)/);
  assert.doesNotMatch(refresh, /card\.recoveryCursor\.value === lastCursor/);
});

test('assistant delivery is backed by an authoritative package receipt and authenticated download', () => {
  assert.match(actions, /socialContentApi\.createDeliveryPackage[\s\S]{0,250}expectedTaskVersion:\s*card\.cardVersion[\s\S]{0,120}artifactIds:/);
  assert.match(actions, /socialContentApi\.downloadPackage\(href\)/);
  assert.match(detail, /receipt\.downloadHref[\s\S]{0,180}receipt\.status === 'ready' \|\| receipt\.status === 'confirmed'/);
  assert.match(detail, /以服务端回执为准/);
});

test('assistant candidate preview reads authenticated bytes and labels unavailable evidence honestly', () => {
  assert.match(detail, /socialContentApi\.fetchArtifactMedia\(taskId, artifact\.artifactId, controller\.signal\)/);
  assert.match(detail, /暂无可核验预览/);
  assert.match(detail, /该精确版本已通过服务端质量门并被采纳/);
});
