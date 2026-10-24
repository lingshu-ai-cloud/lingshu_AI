import '../loadEnvironment.js';
import {createRequire} from 'node:module';
// This import must precede application/adaptor modules in server/index.ts.
// A local preview must not depend on somebody remembering a CLI --import flag.
if (process.env.LINGSHU_LOCAL_PREVIEW === '1' || process.env.CUSTOMER_SIMULATION_ENABLED === '1') {
  if (process.env.NODE_ENV !== 'development') throw Error('customer_preview_requires_development');
  // Synchronous require(ESM), supported by the repository's Node >=22.19.
  // Top-level await here would let sibling adapter modules evaluate first.
  const guard = createRequire(import.meta.url)('../../scripts/customer-isolated-test-guard.mjs') as typeof import('../../scripts/customer-isolated-test-guard.mjs');
  guard.assertCustomerIsolationInstalled();
  Object.assign(process.env, {
    PROCESS_ROLE: 'web', PROCESS_ROLE_SPLIT_ENABLED: 'true', PB_AUTO_START: 'false',
    LINGSHU_LISTEN_HOST: process.env.LINGSHU_LISTEN_HOST || '127.0.0.1',
  });
}
