import { Injectable, SetMetadata, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { defer, lastValueFrom } from "rxjs";
import { services } from "../container";
import type { Actor } from "./actor";
import { IS_PUBLIC } from "./auth.guard";

const WRITABLE_GET = "writableGet";
/** Excepción explícita para GETs que registran auditoría persistente. */
export const WritableGet = () => SetMetadata(WRITABLE_GET, true);

/** Agrupa todas las consultas de un GET en una sola sesión RLS de solo lectura. */
@Injectable()
export class ReadTransactionInterceptor implements NestInterceptor {
  private readonly reflector = new Reflector();

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<{ method: string; user?: Actor; route?: { path: string } }>();
    const publicRoute = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    const writable = this.reflector.getAllAndOverride<boolean>(WRITABLE_GET, [context.getHandler(), context.getClass()]);
    const administrative = /^\/api\/v1\/(auth|platform)(\/|$)/i.test(request.route?.path ?? "");
    const actor = request.user;
    if (request.method !== "GET" || publicRoute || writable || administrative || !actor?.tenantId || !actor.role) return next.handle();
    return defer(() => services().database.asReadUser(actor, () => lastValueFrom(next.handle())));
  }
}
