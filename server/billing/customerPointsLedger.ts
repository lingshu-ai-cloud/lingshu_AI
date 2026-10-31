import { createHash, randomUUID } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import {
  CUSTOMER_POINTS_RESERVATION_SCHEMA,
  CUSTOMER_POINTS_WALLET_SCHEMA,
  type CustomerPointsReservation,
  type CustomerPointsSummary,
  type CustomerPointsWallet,
} from '../../shared/contracts/customerPoints.js';
import {
  CURRENT_PRODUCT_POINT_RATES,
  CUSTOMER_PRODUCT_POINT_SCALE,
  LEGACY_PRODUCT_POINT_PRICE_BOOK_VERSION,
  PRODUCT_POINT_PRICE_BOOK_VERSION,
  PRODUCT_POINT_SECTIONS,
  pointsForQuantity,
  productPointRate,
  type ProductPointSection,
} from '../../shared/pointsPolicy.js';
import { withStarterQuotaScope } from '../starter198/quota.js';

export const CUSTOMER_POINTS_WALLETS = 'customer_points_wallets';
export const CUSTOMER_POINTS_EVENTS = 'customer_points_events';

type WalletRow = Record_ & {
  tenant_id: string;
  schema_version: string;
  revision: number;
  wallet: CustomerPointsWallet;
  updated_at: string;
};

export class CustomerPointsError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
    this.name = 'CustomerPointsError';
  }
}

const safeId = (value: unknown, field: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-z0-9:_.\/-]{1,200}$/i.test(normalized)) throw new CustomerPointsError(`customer_points_${field}_invalid`);
  return normalized;
};
const points = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000_000) {
    throw new CustomerPointsError(`customer_points_${field}_invalid`);
  }
  return Number(value);
};
const timestamp = (value: unknown, field: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || !Number.isFinite(Date.parse(normalized))) throw new CustomerPointsError(`customer_points_${field}_invalid`);
  return new Date(normalized).toISOString();
};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const sectionRecord = (value = 0): Record<ProductPointSection, number> => Object.fromEntries(
  PRODUCT_POINT_SECTIONS.map(section => [section.id, value]),
) as Record<ProductPointSection, number>;
const walletPriceBookVersion = (wallet: CustomerPointsWallet): string => (
  wallet.plan.priceBookVersion || LEGACY_PRODUCT_POINT_PRICE_BOOK_VERSION
);

function exactWalletResult(items: WalletRow[], totalItems: number): WalletRow | null {
  if (totalItems > 1 || items.length > 1) throw new CustomerPointsError('customer_points_wallet_integrity_violation', 503);
  return items[0] ?? null;
}

function parseWallet(row: WalletRow | null, tenantId: string): CustomerPointsWallet | null {
  if (!row) return null;
  const wallet = row.wallet;
  if (row.tenant_id !== tenantId || row.schema_version !== CUSTOMER_POINTS_WALLET_SCHEMA
    || !wallet || wallet.schemaVersion !== CUSTOMER_POINTS_WALLET_SCHEMA || wallet.tenantId !== tenantId
    || !Number.isSafeInteger(row.revision) || row.revision !== wallet.revision || wallet.revision < 1) {
    throw new CustomerPointsError('customer_points_wallet_corrupt', 503);
  }
  const starts = Date.parse(wallet.plan.cycleStartsAt);
  const ends = Date.parse(wallet.plan.cycleEndsAt);
  const invalidPlanBalance = PRODUCT_POINT_SECTIONS.some(section => {
    const allocation = wallet.plan.allocations?.[section.id];
    const spent = wallet.plan.spent?.[section.id];
    const reserved = wallet.plan.reserved?.[section.id];
    return !Number.isSafeInteger(allocation) || allocation < 0
      || !Number.isSafeInteger(spent) || spent < 0
      || !Number.isSafeInteger(reserved) || reserved < 0
      || spent + reserved > allocation;
  });
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts
    || invalidPlanBalance) {
    throw new CustomerPointsError('customer_points_wallet_corrupt', 503);
  }
  points(wallet.addon.granted, 'addon_granted');
  points(wallet.addon.spent, 'addon_spent');
  points(wallet.addon.reserved, 'addon_reserved');
  if (wallet.addon.spent + wallet.addon.reserved > wallet.addon.granted) {
    throw new CustomerPointsError('customer_points_wallet_corrupt', 503);
  }
  return structuredClone(wallet);
}

async function readWalletRow(store: DataStore, tenantId: string): Promise<WalletRow | null> {
  try {
    const result = await store.list<WalletRow>(CUSTOMER_POINTS_WALLETS, { where: { tenant_id: tenantId }, perPage: 2 });
    return exactWalletResult(result.items, result.totalItems);
  } catch (error) {
    if (/collection|not found|404/i.test(error instanceof Error ? error.message : String(error))) return null;
    throw error;
  }
}

function planAvailable(wallet: CustomerPointsWallet, section: ProductPointSection): number {
  return Math.max(0, wallet.plan.allocations[section] - wallet.plan.spent[section] - wallet.plan.reserved[section]);
}
function addonAvailable(wallet: CustomerPointsWallet): number {
  return Math.max(0, wallet.addon.granted - wallet.addon.spent - wallet.addon.reserved);
}

function assertCycleOpen(wallet: CustomerPointsWallet, now: Date): void {
  if (now.getTime() < Date.parse(wallet.plan.cycleStartsAt) || now.getTime() >= Date.parse(wallet.plan.cycleEndsAt)) {
    throw new CustomerPointsError('customer_points_plan_cycle_closed', 409);
  }
}

async function appendEvent(store: DataStore, input: {
  tenantId: string;
  eventId: string;
  operationId: string;
  type: 'plan_provisioned' | 'addon_granted' | 'reserved' | 'settled' | 'released';
  section?: ProductPointSection;
  featureRateId?: string;
  points: number;
  payload: Record<string, unknown>;
  occurredAt: string;
}): Promise<void> {
  const existing = await store.list<Record_>(CUSTOMER_POINTS_EVENTS, { where: { tenant_id: input.tenantId, event_id: input.eventId }, perPage: 2 });
  if (existing.totalItems > 1 || existing.items.length > 1) throw new CustomerPointsError('customer_points_event_integrity_violation', 503);
  if (existing.items.length) return;
  const created = await store.create(CUSTOMER_POINTS_EVENTS, {
    tenant_id: input.tenantId,
    event_id: input.eventId,
    operation_id: input.operationId,
    event_type: input.type,
    section: input.section || '',
    feature_rate_id: input.featureRateId || '',
    points: input.points,
    payload: input.payload,
    occurred_at: input.occurredAt,
  });
  if (!created) throw new CustomerPointsError('customer_points_event_write_failed', 503);
}

async function casWallet(store: DataStore, row: WalletRow, wallet: CustomerPointsWallet): Promise<boolean> {
  if (!store.compareAndSwap) throw new CustomerPointsError('customer_points_atomic_store_required', 503);
  return store.compareAndSwap(CUSTOMER_POINTS_WALLETS, row.id, { revision: row.revision }, {
    revision: wallet.revision,
    wallet,
    updated_at: wallet.updatedAt,
  });
}

export function summarizeCustomerPoints(wallet: CustomerPointsWallet | null): CustomerPointsSummary {
  const displayScale = wallet && walletPriceBookVersion(wallet) === LEGACY_PRODUCT_POINT_PRICE_BOOK_VERSION
    ? CUSTOMER_PRODUCT_POINT_SCALE
    : 1;
  const sections = PRODUCT_POINT_SECTIONS.map(section => {
    const totalPoints = (wallet?.plan.allocations[section.id] ?? 0) * displayScale;
    const usedPoints = (wallet?.plan.spent[section.id] ?? 0) * displayScale;
    const reservedPoints = (wallet?.plan.reserved[section.id] ?? 0) * displayScale;
    return { id: section.id, totalPoints, usedPoints, reservedPoints, remainingPoints: Math.max(0, totalPoints - usedPoints - reservedPoints) };
  });
  const planTotal = sections.reduce((sum, section) => sum + section.totalPoints, 0);
  const planUsed = sections.reduce((sum, section) => sum + section.usedPoints, 0);
  const planReserved = sections.reduce((sum, section) => sum + section.reservedPoints, 0);
  const addonGranted = (wallet?.addon.granted ?? 0) * displayScale;
  const addonUsed = (wallet?.addon.spent ?? 0) * displayScale;
  const addonReserved = (wallet?.addon.reserved ?? 0) * displayScale;
  const addonRemaining = Math.max(0, addonGranted - addonUsed - addonReserved);
  return {
    configured: Boolean(wallet),
    priceBookVersion: PRODUCT_POINT_PRICE_BOOK_VERSION,
    plan: wallet ? {
      id: wallet.plan.id,
      label: wallet.plan.label,
      cycleStartsAt: wallet.plan.cycleStartsAt,
      cycleEndsAt: wallet.plan.cycleEndsAt,
      totalPoints: planTotal,
      usedPoints: planUsed,
      reservedPoints: planReserved,
      remainingPoints: Math.max(0, planTotal - planUsed - planReserved),
    } : null,
    addon: { grantedPoints: addonGranted, usedPoints: addonUsed, reservedPoints: addonReserved, remainingPoints: addonRemaining },
    sections,
    totalRemainingPoints: Math.max(0, planTotal - planUsed - planReserved) + addonRemaining,
  };
}

export function createCustomerPointsLedger(store: DataStore, clock: () => Date = () => new Date()) {
  const read = async (tenantIdInput: string): Promise<{ row: WalletRow | null; wallet: CustomerPointsWallet | null }> => {
    const tenantId = safeId(tenantIdInput, 'tenant');
    const row = await readWalletRow(store, tenantId);
    return { row, wallet: parseWallet(row, tenantId) };
  };

  const mutate = async <T>(tenantIdInput: string, operation: (wallet: CustomerPointsWallet) => { wallet: CustomerPointsWallet; result: T; event: Parameters<typeof appendEvent>[1] }): Promise<T> => {
    const tenantId = safeId(tenantIdInput, 'tenant');
    return withStarterQuotaScope(`customer-points:${tenantId}`, async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const { row, wallet } = await read(tenantId);
        if (!row || !wallet) throw new CustomerPointsError('customer_points_wallet_not_provisioned', 409);
        const next = operation(wallet);
        if (!await casWallet(store, row, next.wallet)) continue;
        await appendEvent(store, next.event);
        return next.result;
      }
      throw new CustomerPointsError('customer_points_concurrent_update', 409);
    });
  };

  return {
    async summary(tenantId: string): Promise<CustomerPointsSummary> {
      return summarizeCustomerPoints((await read(tenantId)).wallet);
    },

    async provisionPlan(input: {
      tenantId: string;
      planId: string;
      planLabel: string;
      cycleStartsAt: string;
      cycleEndsAt: string;
      allocations: Partial<Record<ProductPointSection, number>>;
      idempotencyKey: string;
    }): Promise<CustomerPointsSummary> {
      const tenantId = safeId(input.tenantId, 'tenant');
      const planId = safeId(input.planId, 'plan');
      const idempotencyKey = safeId(input.idempotencyKey, 'idempotency_key');
      const cycleStartsAt = timestamp(input.cycleStartsAt, 'cycle_start');
      const cycleEndsAt = timestamp(input.cycleEndsAt, 'cycle_end');
      if (Date.parse(cycleEndsAt) <= Date.parse(cycleStartsAt)) throw new CustomerPointsError('customer_points_cycle_invalid');
      const allocations = sectionRecord();
      for (const section of PRODUCT_POINT_SECTIONS) allocations[section.id] = points(input.allocations[section.id] ?? 0, `allocation_${section.id}`);
      return withStarterQuotaScope(`customer-points:${tenantId}`, async () => {
        const event = (occurredAt: string): Parameters<typeof appendEvent>[1] => ({
          tenantId, eventId: `plan:${idempotencyKey}`, operationId: idempotencyKey,
          type: 'plan_provisioned',
          points: Object.values(allocations).reduce((sum, value) => sum + value, 0),
          payload: { planId, cycleStartsAt, cycleEndsAt, allocations }, occurredAt,
        });
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const existing = await read(tenantId);
          if (existing.wallet && existing.row) {
            const same = existing.wallet.plan.id === planId
              && existing.wallet.plan.cycleStartsAt === cycleStartsAt
              && existing.wallet.plan.cycleEndsAt === cycleEndsAt
              && digest(existing.wallet.plan.allocations) === digest(allocations);
            if (same) {
              await appendEvent(store, event(existing.wallet.updatedAt));
              return summarizeCustomerPoints(existing.wallet);
            }
            if (Date.parse(cycleStartsAt) < Date.parse(existing.wallet.plan.cycleEndsAt)
              || clock().getTime() < Date.parse(cycleStartsAt)) {
              throw new CustomerPointsError('customer_points_plan_already_provisioned', 409);
            }
            if (Object.values(existing.wallet.plan.reserved).some(value => value > 0)) {
              throw new CustomerPointsError('customer_points_plan_renewal_has_reservations', 409);
            }
            const now = clock().toISOString();
            const renewed = structuredClone(existing.wallet);
            renewed.revision += 1;
            renewed.plan = {
              id: planId, label: input.planLabel.trim() || planId, cycleStartsAt, cycleEndsAt,
              priceBookVersion: PRODUCT_POINT_PRICE_BOOK_VERSION,
              allocations, spent: sectionRecord(), reserved: sectionRecord(),
            };
            if (walletPriceBookVersion(existing.wallet) === LEGACY_PRODUCT_POINT_PRICE_BOOK_VERSION) {
              renewed.addon.granted *= CUSTOMER_PRODUCT_POINT_SCALE;
              renewed.addon.spent *= CUSTOMER_PRODUCT_POINT_SCALE;
              renewed.addon.reserved *= CUSTOMER_PRODUCT_POINT_SCALE;
            }
            renewed.updatedAt = now;
            if (!await casWallet(store, existing.row, renewed)) continue;
            await appendEvent(store, event(now));
            return summarizeCustomerPoints(renewed);
          }
          const now = clock().toISOString();
          const wallet: CustomerPointsWallet = {
            schemaVersion: CUSTOMER_POINTS_WALLET_SCHEMA,
            tenantId,
            revision: 1,
            plan: { id: planId, label: input.planLabel.trim() || planId, priceBookVersion: PRODUCT_POINT_PRICE_BOOK_VERSION, cycleStartsAt, cycleEndsAt, allocations, spent: sectionRecord(), reserved: sectionRecord() },
            addon: { granted: 0, spent: 0, reserved: 0 },
            reservations: {},
            updatedAt: now,
          };
          let created: Record_ | null = null;
          try {
            created = await store.create(CUSTOMER_POINTS_WALLETS, { tenant_id: tenantId, schema_version: CUSTOMER_POINTS_WALLET_SCHEMA, revision: 1, wallet, updated_at: now });
          } catch (error) {
            if ((await read(tenantId)).wallet) continue;
            throw error;
          }
          if (!created) continue;
          await appendEvent(store, event(now));
          return summarizeCustomerPoints(wallet);
        }
        throw new CustomerPointsError('customer_points_concurrent_update', 409);
      });
    },

    async grantAddon(input: { tenantId: string; points: number; purchaseId: string; idempotencyKey: string }): Promise<CustomerPointsSummary> {
      const amount = points(input.points, 'addon_grant');
      const purchaseId = safeId(input.purchaseId, 'purchase');
      const idempotencyKey = safeId(input.idempotencyKey, 'idempotency_key');
      return mutate(input.tenantId, wallet => {
        const marker = wallet.reservations[`addon:${idempotencyKey}`];
        if (marker) return {
          wallet,
          result: summarizeCustomerPoints(wallet),
          event: { tenantId: wallet.tenantId, eventId: `addon:${idempotencyKey}`, operationId: purchaseId, type: 'addon_granted', points: amount, payload: { purchaseId }, occurredAt: wallet.updatedAt },
        };
        const now = clock().toISOString();
        const reservation: CustomerPointsReservation = {
          schemaVersion: CUSTOMER_POINTS_RESERVATION_SCHEMA, id: `addon:${idempotencyKey}`, idempotencyKey,
          operationId: purchaseId, requestHash: digest({ purchaseId, amount }), featureRateId: 'addon-grant', priceBookVersion: walletPriceBookVersion(wallet),
          section: 'business_operations', quantity: 1, quotedPoints: amount, allocation: { planPoints: 0, addonPoints: 0 },
          state: 'settled', actualQuantity: 1, settledPoints: amount, releasedPoints: 0, createdAt: now, updatedAt: now,
        };
        const next = structuredClone(wallet);
        next.revision += 1; next.addon.granted += amount; next.reservations[reservation.id] = reservation; next.updatedAt = now;
        return { wallet: next, result: summarizeCustomerPoints(next), event: { tenantId: wallet.tenantId, eventId: `addon:${idempotencyKey}`, operationId: purchaseId, type: 'addon_granted', points: amount, payload: { purchaseId }, occurredAt: now } };
      });
    },

    async reserve(input: { tenantId: string; operationId: string; idempotencyKey: string; featureRateId: string; quantity: number }): Promise<CustomerPointsReservation> {
      const operationId = safeId(input.operationId, 'operation');
      const idempotencyKey = safeId(input.idempotencyKey, 'idempotency_key');
      const currentRate = productPointRate(input.featureRateId);
      const quantity = Number(input.quantity);
      return mutate(input.tenantId, wallet => {
        assertCycleOpen(wallet, clock());
        const priceBookVersion = walletPriceBookVersion(wallet);
        const rate = productPointRate(currentRate.id, priceBookVersion);
        const quotedPoints = pointsForQuantity(rate, quantity);
        const requestHash = digest({ operationId, featureRateId: rate.id, quantity, priceBookVersion });
        const prior = wallet.reservations[idempotencyKey];
        if (prior) {
          if (prior.requestHash !== requestHash) throw new CustomerPointsError('customer_points_idempotency_conflict', 409);
          return { wallet, result: prior, event: { tenantId: wallet.tenantId, eventId: `reserve:${idempotencyKey}`, operationId, type: 'reserved', section: rate.section, featureRateId: rate.id, points: prior.quotedPoints, payload: { reservationId: prior.id }, occurredAt: prior.createdAt } };
        }
        const availablePlan = planAvailable(wallet, rate.section);
        const planPoints = Math.min(quotedPoints, availablePlan);
        const remainder = quotedPoints - planPoints;
        const addonPoints = rate.billingMode === 'free' ? 0 : rate.billingMode === 'plan_included' ? 0 : remainder;
        if (rate.billingMode === 'plan_included' && remainder > 0) throw new CustomerPointsError('customer_points_plan_included_quota_exhausted', 409);
        if (addonPoints > addonAvailable(wallet)) throw new CustomerPointsError('customer_points_balance_insufficient', 409);
        const now = clock().toISOString();
        const reservation: CustomerPointsReservation = {
          schemaVersion: CUSTOMER_POINTS_RESERVATION_SCHEMA,
          id: `points-${randomUUID()}`, idempotencyKey, operationId, requestHash, featureRateId: rate.id,
          priceBookVersion, section: rate.section, quantity, quotedPoints,
          allocation: { planPoints, addonPoints }, state: 'reserved', actualQuantity: null, settledPoints: 0,
          releasedPoints: 0, createdAt: now, updatedAt: now,
        };
        const next = structuredClone(wallet);
        next.revision += 1;
        next.plan.reserved[rate.section] += planPoints;
        next.addon.reserved += addonPoints;
        next.reservations[idempotencyKey] = reservation;
        next.updatedAt = now;
        return { wallet: next, result: reservation, event: { tenantId: wallet.tenantId, eventId: `reserve:${idempotencyKey}`, operationId, type: 'reserved', section: rate.section, featureRateId: rate.id, points: quotedPoints, payload: { reservationId: reservation.id, allocation: reservation.allocation, priceBookVersion: reservation.priceBookVersion }, occurredAt: now } };
      });
    },

    async settle(input: { tenantId: string; idempotencyKey: string; actualQuantity: number }): Promise<CustomerPointsReservation> {
      const idempotencyKey = safeId(input.idempotencyKey, 'idempotency_key');
      return mutate(input.tenantId, wallet => {
        const current = wallet.reservations[idempotencyKey];
        if (!current) throw new CustomerPointsError('customer_points_reservation_not_found', 404);
        const rate = productPointRate(current.featureRateId, current.priceBookVersion);
        const actualQuantity = Number(input.actualQuantity);
        const settledPoints = pointsForQuantity(rate, actualQuantity);
        if (current.state === 'settled') {
          if (current.actualQuantity !== actualQuantity) throw new CustomerPointsError('customer_points_settlement_conflict', 409);
          return { wallet, result: current, event: { tenantId: wallet.tenantId, eventId: `settle:${idempotencyKey}`, operationId: current.operationId, type: 'settled', section: current.section, featureRateId: current.featureRateId, points: current.settledPoints, payload: { reservationId: current.id }, occurredAt: current.updatedAt } };
        }
        if (current.state !== 'reserved') throw new CustomerPointsError('customer_points_reservation_released', 409);
        if (settledPoints > current.quotedPoints) throw new CustomerPointsError('customer_points_actual_exceeds_reservation', 409);
        const planSpent = Math.min(settledPoints, current.allocation.planPoints);
        const addonSpent = settledPoints - planSpent;
        if (addonSpent > current.allocation.addonPoints) throw new CustomerPointsError('customer_points_allocation_invalid', 503);
        const now = clock().toISOString();
        const next = structuredClone(wallet);
        next.revision += 1;
        next.plan.reserved[current.section] -= current.allocation.planPoints;
        next.plan.spent[current.section] += planSpent;
        next.addon.reserved -= current.allocation.addonPoints;
        next.addon.spent += addonSpent;
        const settled = { ...current, state: 'settled' as const, actualQuantity, settledPoints, releasedPoints: current.quotedPoints - settledPoints, updatedAt: now };
        next.reservations[idempotencyKey] = settled;
        next.updatedAt = now;
        return { wallet: next, result: settled, event: { tenantId: wallet.tenantId, eventId: `settle:${idempotencyKey}`, operationId: current.operationId, type: 'settled', section: current.section, featureRateId: current.featureRateId, points: settledPoints, payload: { reservationId: current.id, actualQuantity, releasedPoints: settled.releasedPoints }, occurredAt: now } };
      });
    },

    async release(input: { tenantId: string; idempotencyKey: string; reason: string }): Promise<CustomerPointsReservation> {
      const idempotencyKey = safeId(input.idempotencyKey, 'idempotency_key');
      return mutate(input.tenantId, wallet => {
        const current = wallet.reservations[idempotencyKey];
        if (!current) throw new CustomerPointsError('customer_points_reservation_not_found', 404);
        if (current.state === 'released') return { wallet, result: current, event: { tenantId: wallet.tenantId, eventId: `release:${idempotencyKey}`, operationId: current.operationId, type: 'released', section: current.section, featureRateId: current.featureRateId, points: current.releasedPoints, payload: { reservationId: current.id }, occurredAt: current.updatedAt } };
        if (current.state !== 'reserved') throw new CustomerPointsError('customer_points_reservation_already_settled', 409);
        const now = clock().toISOString();
        const next = structuredClone(wallet);
        next.revision += 1;
        next.plan.reserved[current.section] -= current.allocation.planPoints;
        next.addon.reserved -= current.allocation.addonPoints;
        const released = { ...current, state: 'released' as const, releasedPoints: current.quotedPoints, updatedAt: now };
        next.reservations[idempotencyKey] = released;
        next.updatedAt = now;
        return { wallet: next, result: released, event: { tenantId: wallet.tenantId, eventId: `release:${idempotencyKey}`, operationId: current.operationId, type: 'released', section: current.section, featureRateId: current.featureRateId, points: current.quotedPoints, payload: { reservationId: current.id, reason: String(input.reason || '').slice(0, 300) }, occurredAt: now } };
      });
    },

    rateCard() {
      return { version: PRODUCT_POINT_PRICE_BOOK_VERSION, items: CURRENT_PRODUCT_POINT_RATES };
    },
  };
}
