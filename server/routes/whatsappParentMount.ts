import type { Application, Router } from 'express';
import { whatsappOAuthRouter } from './whatsappOAuth.js';
/** Used by the production parent, alongside its existing quote/customer/webhook mounts. */
export function mountWhatsAppOAuthRoutes(app: Pick<Application, 'use'>, router: Router = whatsappOAuthRouter): void {
  app.use('/api/oauth/whatsapp', router);
}
