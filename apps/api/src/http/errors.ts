import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { AppError } from "@3dprintmty/shared";
import { ZodError } from "zod";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();
    if (exception instanceof ZodError) {
      response.status(400).json({
        code: "validation_error",
        message: "Revisa los datos capturados.",
        details: exception.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }
    if (exception instanceof AppError) {
      response.status(exception.httpStatus).json({
        code: exception.code,
        message: exception.message,
        details: exception.details ?? null,
      });
      return;
    }
    const db = readDbError(exception);
    if (db) {
      response.status(409).json({ code: "conflict", message: db, details: null });
      return;
    }
    console.error(exception);
    response.status(500).json({
      code: "internal_error",
      message: "Ocurrió un error interno.",
      details: null,
    });
  }
}

function readDbError(error: unknown): string | null {
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    const record = current as { code?: string; message?: string; constraint?: string; cause?: unknown };
    if (record.code === "23503") {
      return "No se puede eliminar porque ya se usó en el taller. Márcalo como inactivo.";
    }
    if (record.code === "23505") {
      const name = `${record.constraint ?? ""} ${record.message ?? ""}`;
      if (name.includes("rfc")) return "Ese RFC ya está registrado.";
      if (name.includes("sku")) return "Ese SKU ya existe en tu taller.";
      if (name.includes("email")) return "Ese correo ya está registrado.";
      return "Ese dato ya existe.";
    }
    if (record.cause) queue.push(record.cause);
  }
  return null;
}

const hits = new Map<string, number[]>();

export function assertRateLimit(key: string, limit = 10, windowMs = 60_000): void {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    throw new AppError("rate_limited", "Demasiados intentos. Espera un minuto.", 429);
  }
  recent.push(now);
  hits.set(key, recent);
}
