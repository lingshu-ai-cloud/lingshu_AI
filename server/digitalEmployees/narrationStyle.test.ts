import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateNarrationStyleProfiles, deriveNarrationStyleProfile, narrationStyleInstruction } from './narrationStyle.js';
import { narrationNaturalnessIssues } from './narration.js';

test('reference narration becomes an abstract style profile without source copy', () => {
  const profile = deriveNarrationStyleProfile([
    { dialogue: '你选这类产品时，最容易忽略什么？' },
    { dialogue: '其实关键是把使用条件问清楚。' },
    { dialogue: '你更在意哪一点？欢迎聊聊。' },
  ]);
  assert.equal(profile?.hookMechanism, 'question');
  assert.equal(profile?.person, 'second_person');
  assert.equal(profile?.connectorStyle, 'conversational');
  const instruction = narrationStyleInstruction(profile);
  assert.match(instruction, /抽象口播节奏/);
  assert.doesNotMatch(instruction, /最容易忽略|使用条件/);
  assert.equal(aggregateNarrationStyleProfiles([profile]), null,
    'one video must not silently become the tenant-wide narration style');
  assert.equal(aggregateNarrationStyleProfiles([profile, profile])?.sampleCount, 6);
});

test('naturalness gate rejects repeated audit copy', () => {
  assert.ok(narrationNaturalnessIssues(['已确认产品资料：A。', '已确认资料显示B。', '已确认资料表明C。']).length > 0);
  assert.deepEqual(narrationNaturalnessIssues(['先看这个细节。', '真正关键的是使用条件。', '你更在意哪一点？']), []);
});
