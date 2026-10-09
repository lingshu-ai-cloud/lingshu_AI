import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../server/socialPrograms/weeklyContentTemplates.fixture.js';
import {validateWeeklyExecutionResults} from '../../server/runtime/socialWeeklyResultValidation.js';
import {runVisualFfmpeg} from '../../server/lib/renderVisualQuality.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';

// Independent evidence audit, not a provider/platform or business E2E success.
// Reuses the source test's DataStore/immutable-plan contract without changing it.
test('persisted hash validation is insufficient to establish independently decoded video', async () => {
  const f = await fixture();
  try {
    const task = f.tables.social_weekly_execution_tasks![0]!.payload as WeeklyExecutionTask;
    const refs = task.resultRefs!;
    await validateWeeklyExecutionResults(f.store, task, refs, new Date('2026-10-19T00:00:00Z'));
    const invalid = await runVisualFfmpeg(['-i', f.local, '-map', '0:v:0', '-f', 'null', '-']);
    assert.equal(invalid.ok, false, 'source fixture is text bytes named .mp4, not rendered media');

    const rendered = await runVisualFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=128x128:rate=12:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f.local]);
    assert.equal(rendered.ok, true, rendered.stderr);
    const bytes = await readFile(f.local);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const renderedPath = path.join(path.dirname(f.local), `${hash}.mp4`);
    await rename(f.local, renderedPath);
    Object.assign(f.tables.starter_social_content_files![0]!, {byte_size: bytes.length, content_sha256: hash, storage_key: path.relative(path.resolve('data/social-content-sources'), renderedPath)});
    const content = f.tables.starter_social_content_artifacts![0]!.content as {mediaStorage: {video: {sha256: string}}};
    content.mediaStorage.video.sha256 = hash;
    await validateWeeklyExecutionResults(f.store, task, refs, new Date('2026-10-19T00:00:00Z'));
    const video = await runVisualFfmpeg(['-i', renderedPath, '-map', '0:v:0', '-f', 'null', '-']);
    const audio = await runVisualFfmpeg(['-i', renderedPath, '-map', '0:a:0', '-f', 'null', '-']);
    assert.equal(video.ok, true, video.stderr);
    assert.equal(audio.ok, true, audio.stderr);

    // Same persistent identity, later corrupted bytes must fail both checks.
    await writeFile(renderedPath, 'corrupt-after-render');
    await assert.rejects(validateWeeklyExecutionResults(f.store, task, refs, new Date('2026-10-19T00:00:00Z')));
    assert.equal((await runVisualFfmpeg(['-i', renderedPath, '-map', '0:v:0', '-f', 'null', '-'])).ok, false);
  } finally {
    await f.cleanup();
  }
});
