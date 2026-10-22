import assert from 'node:assert/strict';
import {
  TASK_TEMPLATES, nextDirectorCheckLabel, normalizeCrawlerLimit,
  normalizedTemplateConfig, scheduleLabel, taskAgentGroup, templateSchedule,
} from './scheduledTaskTemplates.js';

assert.equal(taskAgentGroup('video_keyword_crawl'), 'social');
assert.equal(taskAgentGroup('crm_wakeup'), 'customer');
assert.equal(taskAgentGroup('exchange_rate'), 'conversion');
assert.equal(normalizeCrawlerLimit('999'), '50');
assert.equal(normalizeCrawlerLimit('-1'), '1');
assert.equal(normalizeCrawlerLimit('not-a-number'), '5');

const weekly = TASK_TEMPLATES.find(template => template.templateId === 'market_intelligence');
assert.ok(weekly);
assert.deepEqual(templateSchedule(weekly), { time: '09:00', days: ['1'] });
assert.equal(scheduleLabel('09:00', ['1']), '周一 09:00（北京时间）');
assert.deepEqual(normalizedTemplateConfig(weekly), {});

const crawl = TASK_TEMPLATES.find(template => template.templateId === 'instagram_video_keyword_crawl');
assert.ok(crawl);
assert.equal(normalizedTemplateConfig(crawl).limit, '5');
assert.equal(nextDirectorCheckLabel(Date.parse('2026-10-22T08:00:00+08:00')), '10/22 08:15');

console.log('scheduled task template rules passed');
