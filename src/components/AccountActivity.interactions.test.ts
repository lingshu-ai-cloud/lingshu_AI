import assert from 'node:assert/strict';
import fs from 'node:fs';

const activity = fs.readFileSync('src/components/AccountActivity.tsx', 'utf8');
const review = fs.readFileSync('src/components/WeeklyReviewPanel.tsx', 'utf8');
const clientTypes = fs.readFileSync('src/lib/digitalEmployees.ts', 'utf8');
const starterAccess = fs.readFileSync('server/starter198/socialLegacyAccess.ts', 'utf8');

assert.match(activity, /id: 'inquiries', label: '询盘与资格'/, 'account activity must expose the inquiry qualification workbench');
assert.match(activity, /social-engagement\/interactions/, 'the inquiry workbench must read faithful interaction writebacks');
assert.match(activity, /inquiries\/\$\{encodeURIComponent\(item\.id\)\}\/qualification/, 'sales decisions must write through the qualification endpoint');
assert.match(activity, /内容：\{item\.contentId \|\| '未知来源'\}/, 'unknown content attribution must stay visible');
assert.match(review, /互动与销售资格/, 'weekly review must render the interaction review');
assert.match(review, /按经营方向—账号—内容查看/, 'weekly review must expose direction-account-content breakdowns');
assert.match(clientTypes, /interactionReview\?:/, 'the frontend snapshot contract must include interaction review data');
assert.match(starterAccess, /social-engagement\\\/\(\?:interactions\|creative-learnings\)/, 'starter workbenches must allow interaction and learning reads');
assert.match(starterAccess, /social-engagement\\\/inquiries\\\/\[\^\/\]\+\\\/qualification/, 'starter traffic workbench must allow qualification decisions');

console.log('account activity interaction review contract tests passed');
