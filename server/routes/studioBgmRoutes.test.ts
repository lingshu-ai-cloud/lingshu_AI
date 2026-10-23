import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudioBgmRouter } from './studioBgmRoutes.js';

test('Studio BGM subrouter preserves stream, list, upload and delete paths', () => {
  const router = createStudioBgmRouter() as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
  };
  const routes = router.stack.flatMap(layer => layer.route
    ? Object.keys(layer.route.methods).map(method => `${method.toUpperCase()} ${layer.route!.path}`)
    : []);
  assert.deepEqual(routes, ['GET /media/:id', 'GET /', 'POST /', 'DELETE /:id']);
});
