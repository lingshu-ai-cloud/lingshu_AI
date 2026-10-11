import assert from 'node:assert/strict';
import test from 'node:test';
import {weeklyContentNavigationDetail} from '../../src/lib/weeklyContentNavigationApi.js';
import type {SocialWeeklyPublicationTask,WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {prepareWeeklyQualityRecoveryFixture} from './weeklyContentQualityRecovery.fixture.js';
import {readWeeklyContentNavigation} from './weeklyContentNavigation.js';
import {projectWeeklyDeliveryCards} from './weeklyDeliveryCards.js';

test('one persisted weekly video is one calendar card whose click resolves the same production workspace', async t => {
  const fixture = await prepareWeeklyQualityRecoveryFixture();
  t.after(fixture.cleanup);

  const publication = fixture.pkg.socialContentPackage.publicationTasks[0]! as SocialWeeklyPublicationTask;
  publication.motherContentId = 'gui-an-fa-cleansing-honey';
  publication.publishWindow = '2026-10-08T10:00:00+08:00';
  publication.businessProposition = 'GUIANFA 云朵泡沫卸妆蜜爆款复刻';

  const execution = fixture.current();
  execution.resultRefs = [{type:'starter_social_content_artifact',id:'artifact',version:1}];
  const pkg = fixture.pkg as WeeklyOperatingPackage;
  const cards = await projectWeeklyDeliveryCards(fixture.store, execution.tenantId, pkg, [execution]);

  assert.equal(cards.length, 1, 'one publication must not expand into one visible card per Agent node');
  const card = cards[0]!;
  assert.equal(card.publicationTaskId, publication.publicationTaskId);
  assert.equal(card.title, 'GUIANFA 云朵泡沫卸妆蜜爆款复刻');
  assert.equal(card.publishWindow, publication.publishWindow);
  assert.equal(card.nodes.length, 1);
  assert.equal(card.nodes[0]!.executionTaskId, execution.taskId);
  assert.deepEqual(card.production, {
    bindingKey: 'weekly-production:week1:1:pub',
    contentTaskId: 'content',
    runId: 'run',
  });

  const navigation = await readWeeklyContentNavigation(fixture.store, {
    tenantId: card.tenantId,
    programId: card.programId,
    packageId: card.packageId,
    packageVersion: card.packageVersion,
    executionTaskId: card.nodes[0]!.executionTaskId,
  });
  assert.equal(navigation.contentTaskId, card.production!.contentTaskId);
  assert.equal(navigation.runId, card.production!.runId);
  assert.equal(navigation.publicationTaskId, card.publicationTaskId);
  assert.deepEqual(weeklyContentNavigationDetail(navigation), {
    page:'smartAssets',
    view:'create',
    directStudio:true,
    socialContentTaskId:'content',
    socialContentPage:'smartAssets',
    socialContentView:'managed',
    weeklyContentTarget:navigation,
  });
});

test('calendar card remains visible but cannot forge a production click when weekly authority is absent', async t => {
  const fixture = await prepareWeeklyQualityRecoveryFixture();
  t.after(fixture.cleanup);
  const content = fixture.tables.starter_social_content_tasks![0]!;
  content.brief = {...(content.brief as Record<string,unknown>),programRef:null};

  const cards = await projectWeeklyDeliveryCards(fixture.store, fixture.current().tenantId, fixture.pkg, [fixture.current()]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.production, null, 'a title or task id alone is not enough to route to a production workspace');
  await assert.rejects(readWeeklyContentNavigation(fixture.store, {
    tenantId:fixture.current().tenantId,
    programId:fixture.pkg.programId,
    packageId:fixture.pkg.packageId,
    packageVersion:fixture.pkg.version,
    executionTaskId:fixture.current().taskId,
  }), {code:'weekly_content_navigation_binding_invalid'});
});
