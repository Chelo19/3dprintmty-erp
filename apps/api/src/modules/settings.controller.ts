import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  assertMxState,
  assertPostalCode,
  assertRfc,
  assertTaxRegime,
  canReadPaymentSettings,
} from "@3dprintmty/domain";
import { PAYMENT_METHODS } from "@3dprintmty/payments";
import { AppError } from "@3dprintmty/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import {
  auditEvents,
  companyProfiles,
  locations,
  paymentMethodSettings,
  taxRates,
  tenants,
} from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor } from "../http/actor";

const companySchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().max(200).optional(),
  rfc: z.string(),
  taxRegime: z.string(),
  fiscalPostalCode: z.string(),
  vatRate: z.enum(["0.16", "0.08", "0"]),
});

const locationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["warehouse", "floor", "showroom"]).default("warehouse"),
  postalCode: z.string(),
  state: z.string(),
});

const methodsSchema = z.object({
  methods: z.record(z.enum(PAYMENT_METHODS), z.boolean()),
});

@Controller()
export class SettingsController {
  private get database() {
    return services().database;
  }

  @Get("company")
  async company(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const [profile] = await this.database.asUser(tenant, (db) =>
      db.select().from(companyProfiles).limit(1),
    );
    if (!profile) throw new AppError("not_found", "No encontramos la empresa.", 404);
    return {
      legalName: profile.legalName,
      tradeName: profile.tradeName,
      rfc: profile.rfc,
      taxRegime: profile.taxRegime,
      fiscalPostalCode: profile.fiscalPostalCode,
      currency: profile.currency,
      timezone: profile.timezone,
      locale: profile.locale,
      vatRate: profile.defaultVatRate,
      preinvoiceSeries: profile.preinvoiceSeries,
    };
  }

  @Patch("company")
  async updateCompany(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner"]);
    const input = companySchema.parse(body);
    const rfc = assertRfc(input.rfc);
    const next = {
      legalName: input.legalName,
      tradeName: input.tradeName || input.legalName,
      rfc,
      taxRegime: assertTaxRegime(input.taxRegime),
      fiscalPostalCode: assertPostalCode(input.fiscalPostalCode),
      defaultVatRate: Number(input.vatRate).toFixed(4),
    };
    await this.database.asUser(tenant, async (db) => {
      await db.update(companyProfiles).set(next).where(eq(companyProfiles.tenantId, tenant.tenantId));
      await db.update(tenants).set({ rfc }).where(eq(tenants.id, tenant.tenantId));
      await db
        .update(taxRates)
        .set({ rate: next.defaultVatRate })
        .where(and(eq(taxRates.tenantId, tenant.tenantId), eq(taxRates.isDefault, true)));
      await db.insert(auditEvents).values({
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: "company.fiscal_updated",
        entityType: "company",
        entityId: tenant.tenantId,
        metadata: { rfc, vatRate: input.vatRate },
      });
    });
    return this.company(actor);
  }

  @Get("locations")
  async listLocations(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, (db) => db.select().from(locations));
  }

  @Post("locations")
  async createLocation(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "warehouse"]);
    const input = locationSchema.parse(body);
    const [created] = await this.database.asUser(tenant, (db) =>
      db
        .insert(locations)
        .values({
          tenantId: tenant.tenantId,
          name: input.name,
          kind: input.kind,
          postalCode: assertPostalCode(input.postalCode),
          state: assertMxState(input.state),
          countryCode: "MX",
          isDefault: false,
          createdBy: tenant.userId,
        })
        .returning(),
    );
    return created;
  }

  @Patch("locations/:id")
  async updateLocation(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "warehouse"]);
    const input = locationSchema.parse(body);
    const [updated] = await this.database.asUser(tenant, (db) =>
      db
        .update(locations)
        .set({
          name: input.name,
          kind: input.kind,
          postalCode: assertPostalCode(input.postalCode),
          state: assertMxState(input.state),
        })
        .where(eq(locations.id, id))
        .returning(),
    );
    if (!updated) throw new AppError("not_found", "No encontramos esa sucursal.", 404);
    return updated;
  }

  @Get("payment-methods")
  async paymentMethods(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    if (!canReadPaymentSettings(tenant.role)) {
      throw new AppError("forbidden", "No tienes permiso para ver los métodos de cobro.", 403);
    }
    const rows = await this.database.asUser(tenant, (db) => db.select().from(paymentMethodSettings));
    return rows.map((row: { method: string; enabled: boolean }) => ({
      method: row.method,
      enabled: row.enabled,
    }));
  }

  @Patch("payment-methods")
  async updatePaymentMethods(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const input = methodsSchema.parse(body);
    await this.database.asUser(tenant, async (db) => {
      for (const [method, enabled] of Object.entries(input.methods)) {
        await db
          .update(paymentMethodSettings)
          .set({ enabled })
          .where(and(eq(paymentMethodSettings.method, method)));
      }
    });
    return this.paymentMethods(actor);
  }
}
