import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { assignableRoles, canManageMember, INVITABLE_ROLES, isTenantRole, roleLabel, type TenantRole } from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";
import { services } from "../container";
import { auditEvents, companyProfiles, invitations, tenantMemberships, userAccounts } from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor, type TenantActor } from "../http/actor";
import { Public } from "../http/auth.guard";
import { isSupabaseAuth } from "./auth.service";
import { hashPassword, hashToken, newToken, verifyPassword } from "./passwords";

const INVITE_DAYS = 7;

const inviteSchema = z.object({
  email: z.string().trim().email("Escribe un correo válido."),
  role: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: "Elige un rol." }) }),
});

const roleSchema = z.object({
  role: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: "Elige un rol." }) }),
});

const acceptSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").optional(),
});

interface MemberRow {
  userId: string;
  email: string;
  role: string;
  createdAt: Date;
}

interface InvitationRow {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

function expiresAt() {
  return new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
}

function isExpired(invite: { expiresAt: Date | string }) {
  return new Date(invite.expiresAt).getTime() < Date.now();
}

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
    const manager = ["owner", "admin"].includes(tenant.role);
    const members: MemberRow[] = await this.database.asUser(tenant, (db) =>
      db.select().from(tenantMemberships).orderBy(asc(tenantMemberships.createdAt)),
    );
    const pending: InvitationRow[] = manager
      ? await this.database.asUser(tenant, (db) =>
          db.select().from(invitations).where(isNull(invitations.acceptedAt)).orderBy(asc(invitations.createdAt)),
        )
      : [];
    return {
      assignableRoles: assignableRoles(tenant.role),
      members: members.map((member) => ({
        userId: member.userId,
        email: member.email,
        role: member.role,
        since: member.createdAt,
        self: member.userId === tenant.userId,
        manageable:
          member.userId !== tenant.userId && isTenantRole(member.role) && canManageMember(tenant.role, member.role),
      })),
      invitations: pending.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
        expired: isExpired(invite),
        manageable: isTenantRole(invite.role) && canManageMember(tenant.role, invite.role),
      })),
    };
  }

  @Post("invitations")
  async invite(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const input = inviteSchema.parse(body);
    this.assertAssignable(tenant, input.role);
    const email = input.email.toLowerCase();
    const [member] = await this.database.asAdmin((db) =>
      db.select().from(tenantMemberships).where(eq(tenantMemberships.email, email)).limit(1),
    );
    if (member) {
      throw member.tenantId === tenant.tenantId
        ? new AppError("member_exists", "Esa persona ya está en el equipo.", 409)
        : new AppError("member_elsewhere", "Ese correo ya pertenece a otro taller. Pídele que use otro correo.", 409);
    }
    const token = newToken();
    await this.database.asUser(tenant, async (db) => {
      // Una invitación nueva al mismo correo reemplaza a la anterior: solo el último enlace sirve.
      await db
        .delete(invitations)
        .where(and(eq(invitations.tenantId, tenant.tenantId), eq(invitations.email, email), isNull(invitations.acceptedAt)));
      await db.insert(invitations).values({
        tenantId: tenant.tenantId,
        email,
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt: expiresAt(),
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
    return { email, role: input.role, acceptPath: `/invitacion/${token}` };
  }

  @Post("invitations/:id/renew")
  async renew(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const invite = await this.pendingInvite(tenant, id);
    const token = newToken();
    await this.database.asUser(tenant, async (db) => {
      await db
        .update(invitations)
        .set({ tokenHash: hashToken(token), expiresAt: expiresAt() })
        .where(eq(invitations.id, invite.id));
    });
    return { email: invite.email, role: invite.role, acceptPath: `/invitacion/${token}` };
  }

  @Delete("invitations/:id")
  async revoke(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const invite = await this.pendingInvite(tenant, id);
    await this.database.asUser(tenant, async (db) => {
      await db.delete(invitations).where(eq(invitations.id, invite.id));
      await db.insert(auditEvents).values({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: "team.invitation_revoked",
        entityType: "invitation",
        metadata: { email: invite.email, role: invite.role },
      });
    });
    return { ok: true };
  }

  @Patch("team/members/:userId")
  async changeRole(@CurrentUser() actor: Actor, @Param("userId") userId: string, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const input = roleSchema.parse(body);
    const member = await this.manageableMember(tenant, userId);
    this.assertAssignable(tenant, input.role);
    await this.database.asAdmin(async (db) => {
      await db
        .update(tenantMemberships)
        .set({ role: input.role })
        .where(and(eq(tenantMemberships.tenantId, tenant.tenantId), eq(tenantMemberships.userId, userId)));
      await db.insert(auditEvents).values({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: "team.role_changed",
        entityType: "membership",
        metadata: { email: member.email, from: member.role, to: input.role },
      });
    });
    return { userId, role: input.role };
  }

  @Delete("team/members/:userId")
  async remove(@CurrentUser() actor: Actor, @Param("userId") userId: string) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const member = await this.manageableMember(tenant, userId);
    await this.database.asAdmin(async (db) => {
      await db
        .delete(tenantMemberships)
        .where(and(eq(tenantMemberships.tenantId, tenant.tenantId), eq(tenantMemberships.userId, userId)));
      await db.insert(auditEvents).values({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: "team.member_removed",
        entityType: "membership",
        metadata: { email: member.email, role: member.role },
      });
    });
    return { ok: true };
  }

  @Public()
  @Get("invitations/preview/:token")
  async preview(@Param("token") token: string) {
    const invite = await this.inviteByToken(token);
    const [company] = await this.database.asAdmin((db) =>
      db.select().from(companyProfiles).where(eq(companyProfiles.tenantId, invite.tenantId)).limit(1),
    );
    return {
      email: invite.email,
      role: invite.role,
      roleLabel: roleLabel(invite.role),
      workshop: company?.tradeName || company?.legalName || "el taller",
      expiresAt: invite.expiresAt,
    };
  }

  @Public()
  @Post("invitations/accept")
  async accept(@Body() body: unknown, @Req() request: Request) {
    const input = acceptSchema.parse(body);
    const invite = await this.inviteByToken(input.token);
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
        throw new AppError("invite_wrong_account", `Entraste como ${actor.email}. La invitación es para ${email}.`, 403);
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
          throw new AppError("invalid_credentials", "Ya tienes cuenta con ese correo y la contraseña no coincide.", 401);
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
      throw membership.tenantId === invite.tenantId
        ? new AppError("member_exists", "Ya eres parte de este taller.", 409)
        : new AppError("tenant_exists", "Esa cuenta ya pertenece a otro taller.", 409);
    }
    await this.database.asAdmin(async (db) => {
      await db.insert(tenantMemberships).values({
        tenantId: invite.tenantId,
        userId,
        role: invite.role,
        email,
      });
      await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
      await db.insert(auditEvents).values({
        tenantId: invite.tenantId,
        actorUserId: userId,
        action: "team.joined",
        entityType: "membership",
        metadata: { email, role: invite.role },
      });
    });
    const actor = await this.auth.sessionFor(userId, email);
    return {
      token: isSupabaseAuth() ? null : await this.auth.sign(actor),
      user: { id: userId, email, role: actor.role, tenantId: actor.tenantId },
    };
  }

  private async inviteByToken(token: string): Promise<InvitationRow> {
    const [invite]: InvitationRow[] = await this.database.asAdmin((db) =>
      db.select().from(invitations).where(eq(invitations.tokenHash, hashToken(token))).limit(1),
    );
    if (!invite || invite.acceptedAt) {
      throw new AppError("invite_invalid", "La invitación no es válida o ya se usó. Pide un enlace nuevo.", 400);
    }
    if (isExpired(invite)) {
      throw new AppError("invite_expired", "La invitación venció. Pide un enlace nuevo a quien te invitó.", 400);
    }
    if (!isTenantRole(invite.role) || invite.role === "owner") {
      throw new AppError("invite_invalid", "La invitación no es válida.", 400);
    }
    return invite;
  }

  private async pendingInvite(tenant: TenantActor, id: string): Promise<InvitationRow> {
    const [invite]: InvitationRow[] = await this.database.asUser(tenant, (db) =>
      db
        .select()
        .from(invitations)
        .where(and(eq(invitations.tenantId, tenant.tenantId), eq(invitations.id, id), isNull(invitations.acceptedAt)))
        .limit(1),
    );
    if (!invite) throw new AppError("not_found", "No encontramos esa invitación.", 404);
    if (!isTenantRole(invite.role) || !canManageMember(tenant.role, invite.role)) {
      throw new AppError("forbidden", "No puedes administrar esa invitación.", 403);
    }
    return invite;
  }

  private async manageableMember(tenant: TenantActor, userId: string): Promise<MemberRow> {
    if (userId === tenant.userId) {
      throw new AppError("forbidden", "No puedes cambiar tu propio rol ni darte de baja.", 403);
    }
    const [member]: MemberRow[] = await this.database.asUser(tenant, (db) =>
      db
        .select()
        .from(tenantMemberships)
        .where(and(eq(tenantMemberships.tenantId, tenant.tenantId), eq(tenantMemberships.userId, userId)))
        .limit(1),
    );
    if (!member) throw new AppError("not_found", "Esa persona no está en el equipo.", 404);
    if (!isTenantRole(member.role) || !canManageMember(tenant.role, member.role)) {
      throw new AppError(
        "forbidden",
        member.role === "owner" ? "Nadie puede cambiar al dueño del taller." : "Solo el dueño administra a otros administradores.",
        403,
      );
    }
    return member;
  }

  private assertAssignable(tenant: TenantActor, role: TenantRole) {
    if (!assignableRoles(tenant.role).some((item) => item === role)) {
      throw new AppError("forbidden", "Solo el dueño puede asignar el rol de administrador.", 403);
    }
  }
}
