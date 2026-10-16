import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReplicationWorkbenchHeader from './ReplicationWorkbenchHeader';

const html = renderToStaticMarkup(<ReplicationWorkbenchHeader
  activeStep={1}
  title="爆款复刻 · 10月15日"
  editableTitle
  onTitleChange={() => {}}
  onTitleCommit={() => {}}
/>);
assert.ok(!html.includes('aria-label="内容制作步骤"'));
assert.ok(!html.includes('ant-steps'));
assert.ok(!html.includes('口播替换与确认'));
assert.ok(!html.includes('分镜匹配与制作'));
assert.ok(!html.includes('成片渲染和导出'));
assert.ok(html.includes('aria-label="草稿名称"'));
assert.ok(html.includes('value="爆款复刻 · 10月15日"'));
assert.ok(html.includes('ls-replication-draft-title'));
assert.ok(!html.includes('确认新口播'));
console.log('Content workbench header keeps one editable draft identity without duplicated step navigation');
