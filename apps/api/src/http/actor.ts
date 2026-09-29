import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { isTenantRole, type TenantRole } from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";

export interface Actor {
  userId: string;
  email: string;
  tenantId: string | null;
  role: TenantRole | null;
  platformAdmin: boolean;
  impersonator: string | null;
}

export interface TenantActor extends Actor {
  tenantId: string;
  role: TenantRole;
}

export function requireTenant(actor: Actor): TenantActor {
  if (!actor.tenantId || !actor.role || !isTenantRole(actor.role)) {
    throw new AppError(
      "tenant_required",
      "Termina la configuración del taller para continuar.",
      409,
    );
  }
  return actor as TenantActor;
}

export function assertRole(actor: Actor, roles: readonly TenantRole[]): TenantActor {
  const tenant = requireTenant(actor);
  if (!roles.includes(tenant.role)) {
    throw new AppError("forbidden", "No tienes permiso para esta acción.", 403);
  }
  return tenant;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const request = ctx.switchToHttp().getRequest<{ user?: Actor }>();
  if (!request.user) {
    throw new AppError("unauthenticated", "Inicia sesión para continuar.", 401);
  }
  return request.user;
});
