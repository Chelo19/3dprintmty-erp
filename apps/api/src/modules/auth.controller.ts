import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { AppError } from "@3dprintmty/shared";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";
import { services } from "../container";
import { tenantMemberships, userAccounts } from "../db/schema";
import { CurrentUser, type Actor } from "../http/actor";
import { assertRateLimit } from "../http/errors";
import { Public } from "../http/auth.guard";
import { isSupabaseAuth } from "./auth.service";
import { hashPassword, verifyPassword } from "./passwords";

const credentialsSchema = z.object({
  email: z.string().email("Escribe un correo válido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
});

@Controller("auth")
export class AuthController {
  private get database() {
    return services().database;
  }

  private get auth() {
    return services().auth;
  }

  @Public()
  @Post("register")
  async register(@Body() body: unknown) {
    if (isSupabaseAuth() && process.env.VITEST !== "1") {
      const input = credentialsSchema.parse(body);
      await this.auth.provisionConfirmedAccount(input.email.toLowerCase(), input.password);
      return { ready: true };
    }
    const input = credentialsSchema.parse(body);
    const email = input.email.toLowerCase();
    const passwordHash = await hashPassword(input.password);
    let userId = "";
    try {
      const [created] = await this.database.asAdmin(async (db) =>
        db.insert(userAccounts).values({ email, passwordHash }).returning({ id: userAccounts.id }),
      );
      userId = created.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("user_accounts_email") || message.includes("duplicate") || message.includes("unique")) {
        throw new AppError("email_taken", "Ese correo ya está registrado.", 409);
      }
      throw error;
    }
    const actor = await this.auth.sessionFor(userId, email);
    await this.auth.auditPlatform(userId, "auth.register", null, { email });
    return { token: await this.auth.sign(actor), user: publicUser(actor) };
  }

  @Public()
  @Post("confirm")
  async confirm(@Body() body: unknown) {
    if (isSupabaseAuth() && process.env.VITEST !== "1") {
      const input = z.object({ email: z.string().email("Escribe un correo válido.") }).parse(body);
      await this.auth.confirmAccount(input.email.toLowerCase());
    }
    return { ready: true };
  }

  @Public()
  @Post("login")
  async login(@Body() body: unknown, @Req() request: Request) {
    if (isSupabaseAuth()) {
      throw new AppError("auth_external", "La sesión entra por Supabase Auth.", 400);
    }
    assertRateLimit(`login:${request.ip ?? "local"}`);
    const input = credentialsSchema.parse(body);
    const email = input.email.toLowerCase();
    const [account] = await this.database.asAdmin((db) =>
      db.select().from(userAccounts).where(eq(userAccounts.email, email)).limit(1),
    );
    if (!account?.passwordHash || !(await verifyPassword(input.password, account.passwordHash))) {
      throw new AppError("invalid_credentials", "Correo o contraseña incorrectos.", 401);
    }
    const actor = await this.auth.sessionFor(account.id, email);
    await this.auth.auditPlatform(account.id, "auth.login", actor.tenantId, {});
    return { token: await this.auth.sign(actor), user: publicUser(actor) };
  }

  @Get("me")
  async me(@CurrentUser() actor: Actor) {
    const [membership] = actor.tenantId
      ? await this.database.asAdmin((db) =>
          db.select().from(tenantMemberships).where(eq(tenantMemberships.userId, actor.userId)).limit(1),
        )
      : [];
    return { user: publicUser(actor), membership: membership ?? null };
  }
}

function publicUser(actor: Actor) {
  return {
    id: actor.userId,
    email: actor.email,
    tenantId: actor.tenantId,
    role: actor.role,
    platformAdmin: actor.platformAdmin,
    impersonator: actor.impersonator,
  };
}
