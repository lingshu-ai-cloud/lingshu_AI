import type { ProductPointSection } from '../pointsPolicy.js';

export const CUSTOMER_POINTS_WALLET_SCHEMA = 'customer-points.wallet.v1' as const;
export const CUSTOMER_POINTS_RESERVATION_SCHEMA = 'customer-points.reservation.v1' as const;

export type CustomerPointsReservationState = 'reserved' | 'settled' | 'released';

export interface CustomerPointsAllocation {
  planPoints: number;
  addonPoints: number;
}

export interface CustomerPointsReservation {
  schemaVersion: typeof CUSTOMER_POINTS_RESERVATION_SCHEMA;
  id: string;
  idempotencyKey: string;
  operationId: string;
  requestHash: string;
  featureRateId: string;
  priceBookVersion: string;
  section: ProductPointSection;
  quantity: number;
  quotedPoints: number;
  allocation: CustomerPointsAllocation;
  state: CustomerPointsReservationState;
  actualQuantity: number | null;
  settledPoints: number;
  releasedPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPointsWallet {
  schemaVersion: typeof CUSTOMER_POINTS_WALLET_SCHEMA;
  tenantId: string;
  revision: number;
  plan: {
    id: string;
    label: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
    allocations: Record<ProductPointSection, number>;
    spent: Record<ProductPointSection, number>;
    reserved: Record<ProductPointSection, number>;
  };
  addon: {
    granted: number;
    spent: number;
    reserved: number;
  };
  reservations: Record<string, CustomerPointsReservation>;
  updatedAt: string;
}

export interface CustomerPointsSectionSummary {
  id: ProductPointSection;
  totalPoints: number;
  usedPoints: number;
  reservedPoints: number;
  remainingPoints: number;
}

export interface CustomerPointsSummary {
  configured: boolean;
  priceBookVersion: string;
  plan: null | {
    id: string;
    label: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
    totalPoints: number;
    usedPoints: number;
    reservedPoints: number;
    remainingPoints: number;
  };
  addon: {
    grantedPoints: number;
    usedPoints: number;
    reservedPoints: number;
    remainingPoints: number;
  };
  sections: CustomerPointsSectionSummary[];
  totalRemainingPoints: number;
}
