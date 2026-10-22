import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const shell = fs.readFileSync('src/components/AppDeferredShell.tsx', 'utf8');

assert.match(app, /import \{ Layout, AuthScreen \} from '\.\/components\/AppDeferredShell'/);
assert.doesNotMatch(app, /^import Layout from '\.\/components\/Layout'/m);
assert.doesNotMatch(app, /^import AuthScreen from '\.\/components\/AuthScreen'/m);
assert.match(shell, /lazy\(\(\) => import\('\.\/Layout'\)\)/);
assert.match(shell, /lazy\(\(\) => import\('\.\/AuthScreen'\)\)/);
assert.match(app, /<Suspense fallback=\{<PageLoading \/>\}><AuthScreen/);
assert.match(app, /<Suspense fallback=\{<PageLoading \/>\}><Layout/);

console.log('App shell deferred loading contract passed');
