import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import { writeAuditLog } from '../lib/auditLog.js';
import { requireAdminUser, type AdminIdentity } from '../lib/demoAccounts.js';
import { getLocalTenant } from '../lib/localTenants.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import {
  createDeliveryInviteCode,
  createPendingDeliveryTenant,
  deliveryProvisioningHidden,
  DeliveryTenantProvisioningNeedsAttentionError,
  provisionDeliveryStarter198,
  provisionNewDeliveryTenant,
} from '../starter198/deliveryProvisioning.js';
import { Starter198ProvisioningError } from '../starter198/provisioning.js';
import type { Starter198Repository } from '../starter198/repository.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';

function bodyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const DELIVERY_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function deliveryTenantIdForRequest(adminTenantId: string, requestId: string): string {
  return createHash('sha256')
    .update(`delivery-tenant\0${adminTenantId}\0${requestId.toLowerCase()}`)
    .digest('hex')
    .slice(0, 15);
}

export interface AdminDeliveryStarterRouterOptions {
  presentTenant(req: Request, tenant: Record<string, unknown>): unknown;
  authenticateAdmin?: (req: Request) => Promise<AdminIdentity | null>;
  dataStore?: DataStore;
  repository?: Starter198Repository;
}

export function createAdminDeliveryStarterRouter(options: AdminDeliveryStarterRouterOptions) {
  const router = Router();
  const authenticateAdmin = options.authenticateAdmin ?? requireAdminUser;
  const dataStore = options.dataStore ?? store;

  router.post('/delivery/tenants/:tenantId/starter-198', async (req, res) => {
    const admin = await authenticateAdmin(req);
    if (!admin) {
      res.status(403).json({ error: 'admin_required' });
      return;
    }
    const tenantId = String(req.params.tenantId || '').trim();
    if (!tenantId) {
      res.status(400).json({ error: 'tenant_id_required' });
      return;
    }
    try {
      const tenant = await dataStore.getById<Record<string, unknown>>('tenants', tenantId)
        || (dataStore === store && localFallbacksEnabled() ? getLocalTenant(tenantId) : null);
      if (!tenant) {
        res.status(404).json({ error: 'tenant_not_found' });
        return;
      }
      const provisioned = deliveryProvisioningHidden(tenant)
        ? await provisionNewDeliveryTenant({
          tenantId,
          actorUserId: admin.userId,
          inviteCode: createDeliveryInviteCode(),
          dataStore,
          repository: options.repository,
          compatibilityStore: dataStore,
        })
        : await provisionDeliveryStarter198({
          tenantId,
          actorUserId: admin.userId,
          repository: options.repository,
          compatibilityStore: dataStore,
        });
      await writeAuditLog({
        tenantId,
        actorUserId: admin.userId,
        action: 'starter_198_provisioned',
        targetType: 'tenant',
        targetId: tenantId,
        metadata: { created: provisioned.created, source: 'admin_delivery' },
      });
      res.json({ ok: true, created: provisioned.created, access: provisioned.access });
    } catch (error) {
      if (error instanceof Starter198ProvisioningError) {
        res.status(error.status).json({ error: error.code, blockers: error.blockers });
        return;
      }
      if (error instanceof DeliveryTenantProvisioningNeedsAttentionError) {
        res.status(error.status).json({ error: error.code, tenantId: error.tenantId });
        return;
      }
      res.status(503).json({ error: 'starter_198_provisioning_unavailable' });
    }
  });

  router.post('/delivery/tenants', async (req, res) => {
    const admin = await authenticateAdmin(req);
    if (!admin) {
      res.status(403).json({ error: 'admin_required' });
      return;
    }
    const companyName = bodyText(req.body?.companyName) || bodyText(req.body?.name);
    if (!companyName) {
      res.status(400).json({ error: 'company_name_required', message: '公司名称必填' });
      return;
    }
    const headerRequestId = bodyText(req.get('Idempotency-Key')).toLowerCase();
    const bodyRequestId = bodyText(req.body?.requestId).toLowerCase();
    if (!headerRequestId && !bodyRequestId) {
      res.status(400).json({ error: 'delivery_request_id_required' });
      return;
    }
    if (headerRequestId && bodyRequestId && headerRequestId !== bodyRequestId) {
      res.status(400).json({ error: 'delivery_request_id_invalid' });
      return;
    }
    const requestId = headerRequestId || bodyRequestId;
    if (!DELIVERY_REQUEST_ID.test(requestId)) {
      res.status(400).json({ error: 'delivery_request_id_invalid' });
      return;
    }
    const tenantId = deliveryTenantIdForRequest(admin.tenantId, requestId);
    try {
      await createPendingDeliveryTenant({
        tenantId,
        dataStore,
        data: {
          name: companyName,
          companyName,
          contactName: bodyText(req.body?.contactName) || bodyText(req.body?.contact),
          contact: bodyText(req.body?.contactName) || bodyText(req.body?.contact),
          industry: bodyText(req.body?.industry),
          notes: bodyText(req.body?.notes),
          createdAt: new Date().toISOString(),
        },
      });
      const provisioned = await provisionNewDeliveryTenant({
        tenantId,
        actorUserId: admin.userId,
        inviteCode: createDeliveryInviteCode(),
        dataStore,
        repository: options.repository,
        compatibilityStore: dataStore,
      });
      res.json({ ok: true, tenant: options.presentTenant(req, provisioned.tenant) });
    } catch (error) {
      const provisioning = error instanceof Starter198ProvisioningError;
      const needsAttention = error instanceof DeliveryTenantProvisioningNeedsAttentionError;
      res.status(provisioning ? error.status : needsAttention ? error.status : 500).json({
        error: provisioning ? error.code : needsAttention ? error.code : 'tenant_create_failed',
        tenantId,
        detail: provisioning || needsAttention ? undefined : error instanceof Error ? error.message : 'unknown_error',
      });
    }
  });

  return router;
}
