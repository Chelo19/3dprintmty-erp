import { SetMetadata, type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError } from "@3dprintmty/shared";
import { canAccessModule, type AppModule } from "@3dprintmty/domain";
import { requireTenant, type Actor } from "./actor";
import { services } from "../container";

export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly reflector = new Reflector();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: Actor;
      path: string;
      route?: { path: string };
      method: string;
    }>();
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!token) {
      throw new AppError("unauthenticated", "Inicia sesión para continuar.", 401);
    }
    request.user = await services().auth.verify(token);
    // Usa la ruta registrada: Express acepta variaciones de mayúsculas en la URL.
    const route = request.route?.path ?? request.path;
    const section = route.replace(/^\/api\/v1\//i, "").split("/")[0]?.toLowerCase() ?? "";
    if (request.user.role === "operator") {
      const path = route.replace(/^\/api\/v1\//i, "").replace(/\/$/, "").toLowerCase();
      const read = request.method === "GET" && /^(auth\/me|customers(?:\/[^/]+)?|quotes(?:\/[^/]+(?:\/pdf)?)?|orders(?:\/[^/]+(?:\/pdf)?)?|payments|products(?:\/[^/]+)?|filaments(?:\/[^/]+)?|services(?:\/[^/]+)?|company|locations|payment-methods|prefacturas(?:\/[^/]+)?|inventory(?:\/(balances|ledger))?|spools|production-orders(?:\/[^/]+)?|boms(?:\/[^/]+)?|routings\/[^/]+|work-centers|quality\/(queue|inspections|defect-types|settings))$/.test(path);
      const create = request.method === "POST" && ["customers", "quotes", "orders", "payments", "prefacturas", "production-orders", "spools", "spools/empty", "inventory/movements"].includes(path);
      const operate = request.method === "POST" && /^(inventory\/filaments\/[^/]+\/adjust|spools\/[^/]+\/(weigh|scrap)|production-orders\/(from-sales-order\/[^/]+|[^/]+\/(release|transition|consume|complete|inspections|close|operations\/[^/]+)))$/.test(path);
      if (!read && !create && !operate) throw new AppError("forbidden", "El operador no tiene permiso para esta acción.", 403);
    }
    const modules: Record<string, AppModule> = {
      dashboard: "dashboard", customers: "sales", quotes: "sales", payments: "sales",
      prefacturas: "sales", exports: "sales", orders: "orders", shipments: "orders",
      "production-orders": "production", quality: "production", inventory: "inventory", spools: "inventory",
      vendors: "purchasing", expenses: "purchasing", "purchase-orders": "purchasing", lots: "inventory",
      team: "team", "work-centers": "production",
    };
    const module = modules[section] ?? (["boms", "routings"].includes(section) && request.method !== "GET" ? "production" : undefined);
    if (module && !canAccessModule(requireTenant(request.user).role, module)) {
      throw new AppError("forbidden", "Tu rol no tiene acceso a este módulo.", 403);
    }
    return true;
  }
}
