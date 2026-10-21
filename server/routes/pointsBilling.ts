import { Router } from 'express';
import { requireAuth, enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { createCustomerPointsLedger, CustomerPointsError } from '../billing/customerPointsLedger.js';

export const pointsBillingRouter = Router();
const ledger = createCustomerPointsLedger(store);

pointsBillingRouter.use(requireAuth);
pointsBillingRouter.use(enforceSupportSessionReadOnly);

pointsBillingRouter.get('/summary', async (_req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    res.setHeader('Cache-Control', 'no-store');
    res.json(await ledger.summary(tenantId));
  } catch (error) {
    if (error instanceof CustomerPointsError) {
      res.status(error.status).json({ error: error.code });
      return;
    }
    throw error;
  }
});

pointsBillingRouter.get('/rate-card', (_req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.json(ledger.rateCard());
});
