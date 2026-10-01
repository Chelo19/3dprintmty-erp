export const TENANT_ROLES = [
  "owner",
  "admin",
  "sales",
  "operator",
  "production",
  "warehouse",
  "viewer",
] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];

export function isTenantRole(value: string): value is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(value);
}

const WRITE_CATALOG: readonly TenantRole[] = ["owner", "admin", "warehouse"];
const WRITE_INVENTORY: readonly TenantRole[] = ["owner", "admin", "warehouse", "operator"];
const WRITE_SALES: readonly TenantRole[] = ["owner", "admin", "sales"];
const APPROVE_NEGATIVE_STOCK: readonly TenantRole[] = ["owner", "admin"];
const OVERRIDE_CREDIT: readonly TenantRole[] = ["owner", "admin"];
const WRITE_LOCATIONS: readonly TenantRole[] = ["owner", "admin", "warehouse"];
const MANAGE_TEAM: readonly TenantRole[] = ["owner", "admin"];
const FISCAL_SETTINGS: readonly TenantRole[] = ["owner"];
const READ_SALE_PRICE: readonly TenantRole[] = ["owner", "admin", "sales", "operator", "warehouse", "viewer"];
const READ_PAYMENT_SETTINGS: readonly TenantRole[] = ["owner", "admin", "sales", "operator"];

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
  "operator",
  "production",
  "warehouse",
  "viewer",
] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const ROLE_LABELS: Record<TenantRole, string> = {
  owner: "Dueño",
  admin: "Administrador",
  sales: "Ventas",
  operator: "Operador",
  production: "Producción",
  warehouse: "Almacén",
  viewer: "Solo consulta",
};

export const ROLE_DESCRIPTIONS: Record<TenantRole, string> = {
  owner: "Todo el taller, incluidos los datos fiscales y la configuración de calidad.",
  admin: "Todo el día a día: ventas, catálogo, inventario, compras, producción y equipo. No cambia los datos fiscales.",
  sales: "Clientes, cotizaciones, pedidos, cobranza, prefacturas, servicios y consulta del catálogo.",
  operator: "Atiende el taller: registra clientes, cobros, cotizaciones y pedidos, sin editar registros. Opera inventario y fabricación y emite prefacturas sin cancelarlas. Consulta catálogos y recetas sin costos ni márgenes.",
  production: "Producción, recetas, consulta del catálogo e inventario y consumo de filamento. No ve precios de venta.",
  warehouse: "Catálogo de productos, insumos y filamentos, inventario, compras, sucursales y embarques.",
  viewer: "Consulta los módulos operativos sin modificar nada. Puede descargar el paquete del contador. Sin acceso al equipo ni a la configuración.",
};

export function roleLabel(role: string | null | undefined): string {
  return role && isTenantRole(role) ? ROLE_LABELS[role] : "Sin rol";
}

/** Roles que `role` puede asignar al invitar o al cambiar el rol de alguien. */
export function assignableRoles(role: TenantRole): readonly InvitableRole[] {
  if (role === "owner") return INVITABLE_ROLES;
  if (role === "admin") return INVITABLE_ROLES.filter((item) => item !== "admin");
  return [];
}

/** El dueño administra a todos menos a sí mismo; un administrador no toca al dueño ni a otros administradores. */
export function canManageMember(actor: TenantRole, target: TenantRole): boolean {
  if (target === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && target !== "admin";
}

/** Acceso a módulos; las consultas auxiliares de catálogo se autorizan aparte. */
export const MODULE_ROLES = {
  dashboard: ["owner", "admin", "viewer"],
  sales: ["owner", "admin", "sales", "operator", "viewer"],
  orders: ["owner", "admin", "sales", "operator", "warehouse", "viewer"],
  production: ["owner", "admin", "production", "operator", "viewer"],
  catalog: ["owner", "admin", "warehouse", "production", "sales", "operator", "viewer"],
  inventory: ["owner", "admin", "warehouse", "production", "operator", "viewer"],
  purchasing: ["owner", "admin", "warehouse", "viewer"],
  settings: ["owner", "admin"],
  locations: ["owner", "admin", "warehouse", "viewer"],
  team: ["owner", "admin"],
} as const satisfies Record<string, readonly TenantRole[]>;

export type AppModule = keyof typeof MODULE_ROLES;

export function canAccessModule(role: TenantRole | null, module: AppModule): boolean {
  return role !== null && (MODULE_ROLES[module] as readonly TenantRole[]).includes(role);
}

export function moduleForPath(path: string): AppModule | null {
  const section = path.split("/")[2];
  if (!section) return path === "/app" || path === "/app/" ? "dashboard" : null;
  const modules: Record<string, AppModule> = {
    clientes: "sales", cotizaciones: "sales", servicios: "sales", cobranza: "sales", prefacturas: "sales",
    pedidos: "orders", productos: "catalog", insumos: "catalog", filamentos: "catalog", costeo: "sales",
    inventario: "inventory", rollos: "inventory", produccion: "production", recetas: "production",
    manufactura: "production", calidad: "production", compras: "purchasing", sucursales: "locations",
    configuracion: "settings", equipo: "team",
  };
  return modules[section] ?? null;
}

export function canAccessPath(role: TenantRole | null, path: string): boolean {
  if (role === "operator" && ["costeo"].includes(path.split("/")[2] ?? "")) return false;
  const module = moduleForPath(path);
  return module !== null && canAccessModule(role, module);
}

export function roleHome(role: TenantRole | null): string {
  if (role === "sales" || role === "operator") return "/app/clientes";
  if (role === "production") return "/app/produccion";
  if (role === "warehouse") return "/app/inventario/filamentos";
  return "/app";
}

export function canReadMargins(role: TenantRole): boolean {
  return role !== "operator";
}

export function canCreateSales(role: TenantRole): boolean {
  return role === "operator" || canWriteSales(role);
}
