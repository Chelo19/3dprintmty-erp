import { canAccessPath, roleHome, canWriteLocations, canWriteCatalog, canWriteInventory, canWriteSales, isTenantRole, type TenantRole } from "@3dprintmty/domain";
import { useAuth } from "./auth";

/** Quién puede crear o editar en cada sección; espeja los `assertRole` del API para no mostrar botones que darían 403. */
const WRITERS: Array<[string, (role: TenantRole) => boolean]> = [
  ["/app/productos", canWriteCatalog],
  ["/app/insumos", canWriteCatalog],
  ["/app/filamentos", canWriteCatalog],
  ["/app/servicios", canWriteSales],
  ["/app/clientes", canWriteSales],
  ["/app/cotizaciones", canWriteSales],
  ["/app/pedidos", canWriteSales],
  ["/app/cobranza", canWriteSales],
  ["/app/compras", canWriteInventory],
  ["/app/inventario", canWriteInventory],
  ["/app/rollos", canWriteInventory],
  ["/app/prefacturas", canWriteSales],
  ["/app/sucursales", canWriteLocations],
  ["/app/produccion", (role) => ["owner", "admin", "production"].includes(role)],
  ["/app/recetas", (role) => ["owner", "admin", "production"].includes(role)],
];

export function useRole(): TenantRole | null {
  const { user } = useAuth();
  return user?.role && isTenantRole(user.role) ? user.role : null;
}

export function canWritePath(role: TenantRole | null, path: string): boolean {
  if (!role || !canAccessPath(role, path)) return false;
  if (role === "operator" && /^\/app\/(inventario|produccion|prefacturas)(\/|$)/.test(path)) return true;
  if (role === "operator") return /^\/app\/(clientes|cotizaciones|pedidos|cobranza)\/(nuevo|nueva)\/?$/.test(path);
  const rule = WRITERS.find(([prefix]) => path.startsWith(prefix));
  return rule ? rule[1](role) : role === "owner" || role === "admin";
}

export function useCanWrite(path: string): boolean {
  return canWritePath(useRole(), path);
}

const PENDING_INVITE = "printmty.invite";

export function rememberInvite(token: string) {
  localStorage.setItem(PENDING_INVITE, token);
}

export function forgetInvite() {
  localStorage.removeItem(PENDING_INVITE);
}

/** Adónde mandar a alguien recién autenticado: a su taller, a la invitación que abrió antes de entrar, o al alta. */
export function homeFor(user: { tenantId: string | null; role?: string | null }): string {
  if (user.tenantId) return roleHome(user.role && isTenantRole(user.role) ? user.role : null);
  const invite = localStorage.getItem(PENDING_INVITE);
  return invite ? `/invitacion/${invite}` : "/alta";
}
