import { Injectable } from "@nestjs/common";
import { isTenantRole, type TenantRole } from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import { eq, sql } from "drizzle-orm";
import { SignJWT, createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { DatabaseService } from "../db/database.service";
import { platformAdmins, platformAuditLog, tenantMemberships, userAccounts } from "../db/schema";
import type { Actor } from "../http/actor";

interface TokenInput {
  userId: string;
  email: string;
  tenantId: string | null;
  role: TenantRole | null;
  platformAdmin: boolean;
  impersonator?: string | null;
  expiresIn?: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  async sign(input: TokenInput): Promise<string> {
    const secret = jwtSecret();
    return new SignJWT({
      email: input.email,
      tenant_id: input.tenantId,
      role: input.role,
      platform_admin: input.platformAdmin,
      impersonator: input.impersonator ?? null,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(input.userId)
      .setIssuedAt()
      .setExpirationTime(input.expiresIn ?? "12h")
      .sign(secret);
  }

  async verify(token: string): Promise<Actor> {
    try {
      if (isSupabaseAuth()) {
        const header = decodeProtectedHeader(token);
        if (header.alg !== "HS256") return await this.verifySupabase(token);
      }
      return await this.verifyLocal(token);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("unauthenticated", "La sesión no es válida. Vuelve a entrar.", 401);
    }
  }

  private async verifyLocal(token: string): Promise<Actor> {
    try {
      const { payload } = await jwtVerify(token, jwtSecret());
      const role = typeof payload.role === "string" && isTenantRole(payload.role) ? payload.role : null;
      return {
        userId: String(payload.sub),
        email: String(payload.email ?? ""),
        tenantId: typeof payload.tenant_id === "string" ? payload.tenant_id : null,
        role,
        platformAdmin: payload.platform_admin === true,
        impersonator: typeof payload.impersonator === "string" ? payload.impersonator : null,
      };
    } catch {
      throw new AppError("unauthenticated", "La sesión no es válida. Vuelve a entrar.", 401);
    }
  }

  private async verifySupabase(token: string): Promise<Actor> {
    const { url, jwks } = supabaseJwks();
    let userId = "";
    let email = "";
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: `${url}/auth/v1`,
        audience: "authenticated",
        clockTolerance: "15s",
      });
      userId = typeof payload.sub === "string" ? payload.sub : "";
      email = emailFromPayload(payload);
    } catch (error) {
      console.error("JWT de Supabase rechazado:", error instanceof Error ? error.message : error);
    }
    if (!userId || !email) {
      const user = await this.fetchAuthUser(url, token);
      userId = user.id;
      email = user.email;
    }
    await this.ensureAccount(userId, email);
    return this.sessionFor(userId, email);
  }

  private async fetchAuthUser(url: string, token: string): Promise<{ id: string; email: string }> {
    const apikey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey },
    });
    if (!response.ok) {
      throw new AppError("unauthenticated", "La sesión no es válida. Vuelve a entrar.", 401);
    }
    const body = (await response.json()) as { id?: string; email?: string };
    const id = typeof body.id === "string" ? body.id : "";
    const email = typeof body.email === "string" ? body.email.toLowerCase() : "";
    if (!id || !email) {
      throw new AppError("unauthenticated", "La sesión no trae correo. Vuelve a entrar.", 401);
    }
    return { id, email };
  }

  private async ensureAccount(userId: string, email: string): Promise<void> {
    await this.database.asAdmin(async (db) => {
      const [byId] = await db.select().from(userAccounts).where(eq(userAccounts.id, userId)).limit(1);
      if (byId) {
        if (byId.email !== email) {
          await db.update(userAccounts).set({ email }).where(eq(userAccounts.id, userId));
        }
        return;
      }
      const [byEmail] = await db.select().from(userAccounts).where(eq(userAccounts.email, email)).limit(1);
      if (!byEmail) {
        await db.insert(userAccounts).values({ id: userId, email });
        return;
      }
      if (byEmail.id === userId) return;
      await db.transaction(async (tx: typeof db) => {
        await tx.insert(userAccounts).values({
          id: userId,
          email: `${email}.link`,
          passwordHash: byEmail.passwordHash,
        });
        await tx.update(platformAdmins).set({ userId }).where(eq(platformAdmins.userId, byEmail.id));
        await tx.update(tenantMemberships).set({ userId }).where(eq(tenantMemberships.userId, byEmail.id));
        await tx.execute(sql`update idempotency_keys set user_id = ${userId}::uuid where user_id = ${byEmail.id}::uuid`);
        await tx.delete(userAccounts).where(eq(userAccounts.id, byEmail.id));
        await tx.update(userAccounts).set({ email }).where(eq(userAccounts.id, userId));
      });
    });
  }

  async provisionConfirmedAccount(email: string, password: string): Promise<void> {
    const { url, secret } = supabaseAdmin();
    const created = await adminAuth(url, secret, "POST", "/admin/users", {
      email,
      password,
      email_confirm: true,
    });
    if (created.ok) return;
    const exists = created.status === 422 || isEmailExists(created.body);
    if (!exists) {
      console.error("No se pudo crear la cuenta en Supabase Auth:", created.status, created.body.code ?? created.body.msg);
      throw new AppError("auth_external", "No se pudo crear la cuenta.", 502);
    }
    const listed = await adminAuth(url, secret, "GET", "/admin/users?page=1&per_page=200");
    const users = Array.isArray(listed.body.users) ? listed.body.users : [];
    const match = users.find((user) => user.email?.toLowerCase() === email);
    if (!match?.id) {
      throw new AppError("email_taken", "Ese correo ya está registrado.", 409);
    }
    if (match.email_confirmed_at) {
      throw new AppError("email_taken", "Ese correo ya está registrado.", 409);
    }
    const updated = await adminAuth(url, secret, "PUT", `/admin/users/${match.id}`, {
      email_confirm: true,
      password,
    });
    if (!updated.ok) {
      console.error("No se pudo confirmar la cuenta en Supabase Auth:", updated.status, updated.body.code ?? updated.body.msg);
      throw new AppError("auth_external", "No se pudo crear la cuenta.", 502);
    }
  }

  async confirmAccount(email: string): Promise<void> {
    const { url, secret } = supabaseAdmin();
    const listed = await adminAuth(url, secret, "GET", "/admin/users?page=1&per_page=200");
    const users = Array.isArray(listed.body.users) ? listed.body.users : [];
    const match = users.find((user) => user.email?.toLowerCase() === email);
    if (!match?.id || match.email_confirmed_at) return;
    const updated = await adminAuth(url, secret, "PUT", `/admin/users/${match.id}`, {
      email_confirm: true,
    });
    if (!updated.ok) {
      console.error("No se pudo confirmar la cuenta en Supabase Auth:", updated.status, updated.body.code ?? updated.body.msg);
      throw new AppError("auth_external", "No se pudo abrir la sesión.", 502);
    }
  }

  async sessionFor(userId: string, email: string): Promise<Actor> {
    const platformAdmin = await this.ensurePlatformAdmin(userId, email);
    const [membership] = await this.database.asAdmin((db) =>
      db
        .select()
        .from(tenantMemberships)
        .where(eq(tenantMemberships.userId, userId))
        .limit(1),
    );
    return {
      userId,
      email,
      tenantId: membership?.tenantId ?? null,
      role: membership && isTenantRole(membership.role) ? membership.role : null,
      platformAdmin,
      impersonator: null,
    };
  }

  async ensurePlatformAdmin(userId: string, email: string): Promise<boolean> {
    const allowed = platformAdminEmails();
    if (!allowed.includes(email)) return false;
    await this.database.asAdmin(async (db) => {
      await db.insert(platformAdmins).values({ userId }).onConflictDoNothing();
    });
    return true;
  }

  async auditPlatform(actorUserId: string, action: string, tenantId: string | null, metadata: Record<string, unknown>) {
    await this.database.asAdmin(async (db) => {
      await db.insert(platformAuditLog).values({
        actorUserId,
        action,
        tenantId,
        metadata,
      });
    });
  }
}

function jwtSecret(): Uint8Array {
  const configured = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!configured || configured.length < 32 || process.env.AUTH_DRIVER === "local") {
      throw new Error("En producción define JWT_SECRET de al menos 32 caracteres y AUTH_DRIVER=supabase.");
    }
  }
  const secret = configured && configured.length >= 16 ? configured : "dev-only-change-me-please-32chars";
  return new TextEncoder().encode(secret);
}

function emailFromPayload(payload: JWTPayload): string {
  if (typeof payload.email === "string" && payload.email.includes("@")) return payload.email.toLowerCase();
  const meta = payload.user_metadata;
  if (meta && typeof meta === "object" && "email" in meta && typeof (meta as { email?: unknown }).email === "string") {
    return String((meta as { email: string }).email).toLowerCase();
  }
  return "";
}

export function isSupabaseAuth(): boolean {
  return process.env.AUTH_DRIVER === "supabase";
}

const jwksByProject = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

interface AuthAdminBody {
  code?: string | number;
  msg?: string;
  message?: string;
  error_code?: string;
  users?: Array<{ id?: string; email?: string; email_confirmed_at?: string | null }>;
}

function supabaseAdmin(): { url: string; secret: string } {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !secret) {
    throw new AppError("internal_error", "Falta SUPABASE_URL o SUPABASE_SECRET_KEY.", 500);
  }
  return { url, secret };
}

async function adminAuth(
  url: string,
  secret: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: AuthAdminBody }> {
  const response = await fetch(`${url}/auth/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      apikey: secret,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as AuthAdminBody;
  return { ok: response.ok, status: response.status, body: payload };
}

function isEmailExists(body: AuthAdminBody): boolean {
  const code = String(body.error_code ?? body.code ?? "").toLowerCase();
  const message = String(body.msg ?? body.message ?? "").toLowerCase();
  return code.includes("email_exists") || message.includes("already");
}

function supabaseJwks(): { url: string; jwks: ReturnType<typeof createRemoteJWKSet> } {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!url) throw new Error("Define SUPABASE_URL para verificar la sesión de Supabase.");
  let jwks = jwksByProject.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
    jwksByProject.set(url, jwks);
  }
  return { url, jwks };
}

export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export { userAccounts };
