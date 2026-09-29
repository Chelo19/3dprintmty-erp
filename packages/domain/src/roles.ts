export const TENANT_ROLES = [
  "owner",
  "admin",
  "sales",
  "production",
  "warehouse",
  "viewer",
] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];

export function isTenantRole(value: string): value is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(value);
}

const WRITE_CATALOG: readonly TenantRole[] = ["owner", "admin", "warehouse"];
const WRITE_INVENTORY: readonly TenantRole[] = ["owner", "admin", "warehouse"];
const WRITE_SALES: readonly TenantRole[] = ["owner", "admin", "sales"];
const APPROVE_NEGATIVE_STOCK: readonly TenantRole[] = ["owner", "admin"];
const OVERRIDE_CREDIT: readonly TenantRole[] = ["owner", "admin"];
const WRITE_LOCATIONS: readonly TenantRole[] = ["owner", "admin", "warehouse"];
const MANAGE_TEAM: readonly TenantRole[] = ["owner", "admin"];
const FISCAL_SETTINGS: readonly TenantRole[] = ["owner"];
const READ_SALE_PRICE: readonly TenantRole[] = ["owner", "admin", "sales", "warehouse", "viewer"];
const READ_PAYMENT_SETTINGS: readonly TenantRole[] = ["owner", "admin", "sales"];

export function canWriteCatalog(role: TenantRole): boolean {
  return WRITE_CATALOG.includes(role);
}

export function canWriteInventory(role: TenantRole): boolean {
  return WRITE_INVENTORY.includes(role);
}

export function canWriteSales(role: TenantRole): boolean {
  return WRITE_SALES.includes(role);
}

export function canApproveNegativeStock(role: TenantRole): boolean {
  return APPROVE_NEGATIVE_STOCK.includes(role);
}

export function canOverrideCredit(role: TenantRole): boolean {
  return OVERRIDE_CREDIT.includes(role);
}

export function canWriteLocations(role: TenantRole): boolean {
  return WRITE_LOCATIONS.includes(role);
}

export function canManageTeam(role: TenantRole): boolean {
  return MANAGE_TEAM.includes(role);
}

export function canEditFiscalSettings(role: TenantRole): boolean {
  return FISCAL_SETTINGS.includes(role);
}

export function canReadSalePrice(role: TenantRole): boolean {
  return READ_SALE_PRICE.includes(role);
}

export function canReadPaymentSettings(role: TenantRole): boolean {
  return READ_PAYMENT_SETTINGS.includes(role);
}

export const INVITABLE_ROLES = [
  "admin",
  "sales",
  "production",
  "warehouse",
  "viewer",
] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];
