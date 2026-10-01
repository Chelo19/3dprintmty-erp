import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { map } from "rxjs";
import type { Actor } from "./actor";

/** El operador ve cantidades y precios comerciales, pero no costos ni utilidad. */
export function hideOperatorCosts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hideOperatorCosts);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key, /cost|margin|profit|hourlyRate/i.test(key) || key === "value" || key === "valueMinor" ? null : hideOperatorCosts(child),
  ]));
}

@Injectable()
export class OperatorCostsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<{ user?: Actor; route?: { path: string } }>();
    const operational = /\/(inventory|spools|production-orders|boms|routings|work-centers|quality)(\/|$)/.test(request.route?.path ?? "");
    return next.handle().pipe(map((value) => request.user?.role === "operator" && operational ? hideOperatorCosts(value) : value));
  }
}
