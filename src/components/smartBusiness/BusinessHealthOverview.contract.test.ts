import assert from 'node:assert/strict';
import fs from 'node:fs';

const overview = fs.readFileSync('src/components/smartBusiness/BusinessHealthOverview.tsx', 'utf8');
const page = fs.readFileSync('src/components/DigitalEmployeePage.tsx', 'utf8');

assert.match(overview, /<DatePicker\.RangePicker/, 'health range selection must use the shared Ant RangePicker');
assert.match(overview, /allowClear=\{false\}/, 'the selected health range must remain explicit');
assert.match(overview, /startsAt:\s*dates\[0\]\.format\('YYYY-MM-DD'\)[\s\S]*endsAt:\s*dates\[1\]\.format\('YYYY-MM-DD'\)/, 'a complete range must be submitted as date-only API values');
assert.match(overview, /\[refresh, snapshotStartsAt, snapshotEndsAt\]/, 'account performance must be synchronized again after the selected range changes');
assert.match(page, /digitalEmployeeApi\.overview\(viewGoalId, nextRange\)/, 'range selection must reload the persisted overview rather than only changing its label');
assert.match(page, /productionRangeRef\.current = nextRange;[\s\S]{0,120}setData\(next\)/, 'the accepted range and overview data must update only after a successful response');
assert.match(page, /overviewRangeBusy=\{busy === "overview-range"\}[\s\S]{0,120}onOverviewRangeChange=\{changeOverviewDateRange\}/, 'the health range control must receive the real request state and handler');
assert.match(overview, /title="四领域评分口径覆盖结构"[\s\S]{0,180}horizontal stacked unit="项"/, 'criteria coverage must use the shared stacked data chart');
assert.match(overview, /label: '已评分'[\s\S]{0,280}label: '待数据'[\s\S]{0,280}label: '不适用'/, 'the chart must distinguish scored, pending and inapplicable criteria');
assert.match(overview, /评分证据覆盖 \$\{totals\.scored\}\/\$\{totals\.applicable\} 项/, 'coverage progress must expose its real numerator and applicable denominator');
assert.match(overview, /criterion\.score === null \? '—' : criterion\.score/, 'missing criterion scores must stay visibly unknown instead of becoming zero');
assert.match(overview, /label: '查看完整计算口径'/, 'the full textual basis must remain available on demand');

console.log('Business Health range contract tests passed');
