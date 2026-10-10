// Isolated regression worker. No provider imports or external calls.
import { withPaidOperationLock } from '../server/lib/paidOperationLock.js';
await withPaidOperationLock(process.argv[2], 'cross-process', async () => {
  process.send?.('locked');
  await new Promise<void>(resolve => process.once('message', () => resolve()));
});
process.disconnect?.();
