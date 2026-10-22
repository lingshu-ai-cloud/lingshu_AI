import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve('src/components/AiCreateStudio.tsx'), 'utf8');
const overlaySource = fs.readFileSync(path.resolve('src/components/studio/StudioProjectsOverlay.tsx'), 'utf8');
const historySource = fs.readFileSync(path.resolve('src/components/socialContent/SocialContentHistoryHome.tsx'), 'utf8');
const apiSource = fs.readFileSync(path.resolve('src/lib/studioApi.ts'), 'utf8');

assert.match(overlaySource, /import \{ Button, Popconfirm \} from 'antd'/, 'project deletion must use the shared Ant Popconfirm');
assert.match(overlaySource, /title="删除这条创作？"[\s\S]{0,500}description=\{`“\$\{p\.title\}”删除后无法恢复。`\}/, 'confirmation must identify the project and explain that deletion is irreversible');
assert.match(overlaySource, /okButtonProps=\{\{ danger: true \}\}/, 'the confirmed delete action must use danger semantics');
assert.match(overlaySource, /aria-label=\{`删除创作：\$\{p\.title\}`\}[\s\S]{0,180}>[\s\S]{0,80}删除/, 'each project card must expose an always visible, named delete action');
assert.doesNotMatch(overlaySource, /opacity-0 group-hover:opacity-100[\s\S]{0,120}<Trash2/, 'deletion must not be hidden behind hover-only presentation');
assert.match(source, /const result = await studioApi\.deleteProject\(id\);[\s\S]{0,250}if \(!result\.ok\)[\s\S]{0,250}throw new Error\(reason\)/, 'failed deletion must be reported instead of silently removing the card');
assert.match(source, /setProjects\(items => items\.filter\(item => item\.id !== id\)\)/, 'successful deletion must remove the project from the visible list');
assert.match(source, /if \(projectDeleteInFlightRef\.current\) \{[\s\S]{0,180}return false/, 'autosave must pause while the active project is being deleted');
assert.match(source, /currentProjectRef\.current = null[\s\S]{0,450}openCreationHome\(false\)/, 'deleting the active project must leave the editor so autosave cannot recreate it');
assert.match(historySource, /import \{ App as AntApp, Button, Drawer, Pagination, Popconfirm, Segmented \} from 'antd'/, 'the primary content creation history must expose Ant confirmation');
assert.match(historySource, /onConfirm=\{\(\) => deleteProject\(project\)\}/, 'each creation history card must confirm deletion');
assert.match(historySource, /aria-label=\{`删除创作：\$\{project\.title\}`\}/, 'each primary history card must expose a named delete action');
assert.match(historySource, /setProjects\(remaining\)/, 'the primary history must update immediately after deletion');
assert.match(apiSource, /del\(`projects\/\$\{encodeURIComponent\(id\)\}`\)/, 'project ids must be encoded before deletion');
assert.match(apiSource, /const data = await r\.json\(\)\.catch\(\(\) => \(\{\}\)\)/, 'delete failures must preserve the server error for the UI');

console.log('Content creation project deletion contract passed');
