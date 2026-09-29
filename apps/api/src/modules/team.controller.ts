import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { INVITABLE_ROLES, isTenantRole } from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";
import { services } from "../container";
import { auditEvents, invitations, tenantMemberships, userAccounts } from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor } from "../http/actor";
import { Public } from "../http/auth.guard";
import { isSupabaseAuth } from "./auth.service";
import { hashPassword, hashToken, newToken, verifyPassword } from "./passwords";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(INVITABLE_ROLES),
});

const acceptSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8).optional(),
});

@Controller()
export class TeamController {
  private get database() {
    return services().database;
  }

  private get auth() {
    return services().auth;
  }

  @Get("team")
  async list(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const members = await this.database.asUser(tenant, (db) => db.select().from(tenantMemberships));
    const pending = ["owner", "admin"].includes(tenant.role)
      ? await this.database.asUser(tenant, (db) =>
          db.select().from(invitations).where(isNull(invitations.acceptedAt)),
        )
      : [];
    return {
      members: members.map((member: { userId: string; email: string; role: string }) => ({
        userId: member.userId,
        email: member.email,
        role: member.role,
      })),
      invitations: pending.map((invite: { id: string; email: string; role: string; expiresAt: Date }) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      })),
    };
  }

  @Post("invitations")
  async invite(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const input = inviteSchema.parse(body);
    const email = input.email.toLowerCase();
    const token = newToken();
    await this.database.asUser(tenant, async (db) => {
      await db.insert(invitations).values({
        tenantId: tenant.tenantId,
        email,
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdBy: tenant.userId,
      });
      await db.insert(auditEvents).values({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: "team.invited",
        entityType: "invitation",
        metadata: { email, role: input.role },
      });
    });
    return {
      email,
      role: input.role,
      acceptPath: `/invitacion/${token}`,
    };
  }

  @Public()
  @Post("invitations/accept")
  async accept(@Body() body: unknown, @Req() request: Request) {
    const input = acceptSchema.parse(body);
    const tokenHash = hashToken(input.token);
    const [invite] = await this.database.asAdmin((db) =>
      db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).limit(1),
    );
    if (!invite || invite.acceptedAt || new Date(invite.expiresAt).getTime() < Date.now()) {
      throw new AppError("invite_invalid", "La invitación no es válida o ya venció.", 400);
    }
    if (!isTenantRole(invite.role) || invite.role === "owner") {
      throw new AppError("invite_invalid", "La invitación no es válida.", 400);
    }
    const email = invite.email.toLowerCase();
    let userId: string | undefined;
    if (isSupabaseAuth()) {
      const header = request.headers.authorization ?? "";
      const access = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
      if (!access) {
        throw new AppError("unauthenticated", "Entra con tu cuenta para aceptar la invitación.", 401);
      }
      const actor = await this.auth.verify(access);
      if (actor.email.toLowerCase() !== email) {
        throw new AppError("invite_invalid", "Entra con el correo de la invitación.", 403);
      }
      userId = actor.userId;
    } else {
      if (!input.password) {
        throw new AppError("validation_error", "La contraseña debe tener al menos 8 caracteres.", 400);
      }
      const [existing] = await this.database.asAdmin((db) =>
        db.select().from(userAccounts).where(eq(userAccounts.email, email)).limit(1),
      );
      userId = existing?.id as string | undefined;
      if (existing?.passwordHash) {
        const matches = await verifyPassword(input.password, existing.passwordHash);
        if (!matches) {
          throw new AppError("invalid_credentials", "La contraseña no coincide con la cuenta.", 401);
        }
      } else if (!existing) {
        const passwordHash = await hashPassword(input.password);
        const [created] = await this.database.asAdmin((db) =>
          db.insert(userAccounts).values({ email, passwordHash }).returning({ id: userAccounts.id }),
        );
        userId = created.id;
      } else {
        throw new AppError("invite_invalid", "Esa cuenta no puede aceptar invitaciones locales.", 409);
      }
    }
    if (!userId) throw new AppError("internal_error", "No se pudo crear la cuenta.", 500);
    const [membership] = await this.database.asAdmin((db) =>
      db.select().from(tenantMemberships).where(eq(tenantMemberships.userId, userId)).limit(1),
    );
    if (membership) {
      throw new AppError("tenant_exists", "Esa cuenta ya pertenece a un taller.", 409);
    }
    await this.database.asAdmin(async (db) => {
      await db.insert(tenantMemberships).values({
        tenantId: invite.tenantId,
        userId,
        role: invite.role,
        email,
      });
      await db
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(and(eq(invitations.id, invite.id)));
    });
    const actor = await this.auth.sessionFor(userId, email);
    return {
      token: isSupabaseAuth() ? null : await this.auth.sign(actor),
      user: { id: userId, email, role: actor.role, tenantId: actor.tenantId },
    };
  }
}
