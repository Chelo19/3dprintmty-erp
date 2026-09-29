import { Body, Controller, Get, Post } from "@nestjs/common";
import { AppError } from "@3dprintmty/shared";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import { companyProfiles, platformAuditLog, tenants } from "../db/schema";
import { CurrentUser, type Actor } from "../http/actor";

const impersonateSchema = z.object({
  tenantId: z.string().uuid(),
});

@Controller("platform")
export class PlatformController {
  private get database() {
    return services().database;
  }

  private get auth() {
    return services().auth;
  }

  @Get("tenants")
  async tenants(@CurrentUser() actor: Actor) {
    this.assertPlatform(actor);
    const rows = await this.database.asAdmin((db) =>
      db
        .select({
          id: tenants.id,
          slug: tenants.slug,
          status: tenants.status,
          rfc: tenants.rfc,
          legalName: companyProfiles.legalName,
          createdAt: tenants.createdAt,
        })
        .from(tenants)
        .leftJoin(companyProfiles, eq(companyProfiles.tenantId, tenants.id))
        .orderBy(desc(tenants.createdAt)),
    );
    return { data: rows };
  }

  @Post("impersonate")
  async impersonate(@CurrentUser() actor: Actor, @Body() body: unknown) {
    this.assertPlatform(actor);
    if (actor.impersonator) {
      throw new AppError("forbidden", "Ya estás dentro de una sesión de soporte.", 409);
    }
    const input = impersonateSchema.parse(body);
    const [tenant] = await this.database.asAdmin((db) =>
      db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1),
    );
    if (!tenant) throw new AppError("not_found", "No encontramos ese taller.", 404);
    await this.auth.ensurePlatformAdmin(actor.userId, actor.email);
    await this.auth.auditPlatform(actor.userId, "support.impersonation_started", tenant.id, {
      rfc: tenant.rfc,
    });
    const token = await this.auth.sign({
      userId: actor.userId,
      email: actor.email,
      tenantId: tenant.id,
      role: "admin",
      platformAdmin: true,
      impersonator: actor.userId,
      expiresIn: "1h",
    });
    return { token, tenant: { id: tenant.id, rfc: tenant.rfc, slug: tenant.slug } };
  }

  @Post("impersonate/stop")
  async stop(@CurrentUser() actor: Actor) {
    if (!actor.impersonator) {
      throw new AppError("forbidden", "No hay una sesión de soporte activa.", 409);
    }
    await this.auth.auditPlatform(actor.impersonator, "support.impersonation_stopped", actor.tenantId, {});
    const session = await this.auth.sessionFor(actor.impersonator, actor.email);
    return { token: await this.auth.sign(session) };
  }

  @Get("audit")
  async audit(@CurrentUser() actor: Actor) {
    this.assertPlatform(actor);
    const rows = await this.database.asAdmin((db) =>
      db.select().from(platformAuditLog).orderBy(desc(platformAuditLog.createdAt)).limit(50),
    );
    return { data: rows };
  }

  private assertPlatform(actor: Actor): void {
    if (!actor.platformAdmin || actor.impersonator) {
      throw new AppError("forbidden", "Esta consola es solo para el equipo de la plataforma.", 403);
    }
  }
}
