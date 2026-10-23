import { createWeComCustomerIngress } from './wecomCustomerIngress.js';
import type { Application, Router } from 'express';
import { wecomCustomerServiceRouter } from './wecomCustomerService.js';
import { whatsappOAuthRouter } from './whatsappOAuth.js';
/** Used by the production parent, alongside its existing quote/customer/webhook mounts. */
export function mountWhatsAppOAuthRoutes(app: Pick<Application, 'use'>, router: Router = whatsappOAuthRouter): void {
  app.use('/api/oauth/whatsapp', router);
  app.use('/api/overseas/wecom-customer-service', wecomCustomerServiceRouter);
  app.use('/api/webhooks/wecom', createWeComCustomerIngress());
}
