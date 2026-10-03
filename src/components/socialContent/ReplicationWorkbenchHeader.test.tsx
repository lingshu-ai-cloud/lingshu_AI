import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReplicationWorkbenchHeader from './ReplicationWorkbenchHeader';

const html = renderToStaticMarkup(<ReplicationWorkbenchHeader activeStep={1} />);
assert.ok(html.includes('1 口播替换与确认'));
assert.ok(html.includes('2 分镜匹配与制作'));
assert.ok(html.includes('3 成片渲染和导出'));
assert.ok(!html.includes('确认新口播'));
console.log('Replication navigation has three steps');
