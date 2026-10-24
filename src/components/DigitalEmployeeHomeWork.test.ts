import assert from 'node:assert/strict';
import { projectDigitalEmployeeHomeWork } from './DigitalEmployeeHomeWork';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';

const data = {
  tasks: [
    { id: 'ads', task_key: 'ads_performance', title: '为新品启动智能投流', description: '', kind: 'ads', status: 'running' },
    { id: 'customer', task_key: 'customer_followup', title: '跟进高意向询盘', description: '', kind: 'customer', status: 'waiting_approval' },
  ],
  contentQueue: { items: [{ id: 'content', contentId: 'content-1', status: 'producing', title: '新品精华短视频', stage: '成片渲染', platform: 'tiktok', preproduction: { benchmark: { thumbnailUrl: '/api/overseas/videos/video-1/thumbnail' }, materials: { items: [] } } }] },
} as unknown as DigitalEmployeeOverview;

const projected = projectDigitalEmployeeHomeWork(data);
assert.equal(projected.length, 9, '三栏必须各展示三个任务位');
assert.deepEqual([...new Set(projected.map(item => item.label))], ['内容创作', '智能投流', '智能客服']);
assert.deepEqual(projected.map(item => item.kind).reduce<Record<string, number>>((counts, kind) => ({ ...counts, [kind]: (counts[kind] || 0) + 1 }), {}), { content: 3, traffic: 3, customer: 3 });
assert.equal(projected[0]?.title, '新品精华短视频');
assert.equal(projected[0]?.activity, '成片渲染');
assert.equal(projected[3]?.activity, '为新品启动智能投流');
assert.equal(projected[6]?.activity, '跟进高意向询盘');
assert.equal(projected.find(item => item.id === 'content-content')?.thumbnailUrl, '/api/overseas/videos/video-1/thumbnail', '真实内容任务必须保留自己的视频预览');
assert.ok(projected.filter(item => item.kind !== 'content').every(item => !item.thumbnailUrl), '投流和客服栏不得借用内容视频伪装成各自任务');

const empty = projectDigitalEmployeeHomeWork({ tasks: [], contentQueue: { items: [] } } as unknown as DigitalEmployeeOverview);
assert.ok(empty.every(item => item.status === '暂无进行中'));
assert.ok(empty.some(item => item.activity === '暂无进行中的投流任务'));
assert.ok(empty.some(item => item.activity === '暂无进行中的客服任务'));

console.log('Digital employee home work projection tests passed');
