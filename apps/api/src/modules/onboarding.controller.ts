import { randomBytes } from "node:crypto";
import { Body, Controller, Post } from "@nestjs/common";
import {
  assertMxState,
  assertPostalCode,
  assertRfc,
  assertTaxRegime,
  Money,
} from "@3dprintmty/domain";
import { PAYMENT_METHODS } from "@3dprintmty/payments";
import { AppError } from "@3dprintmty/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import type { DatabaseService } from "../db/database.service";
import {
  auditEvents,
  companyProfiles,
  defectTypes,
  filaments,
  locations,
  numberSequences,
  paymentMethodSettings,
  taxRates,
  tenantMemberships,
  tenants,
  workCenters,
} from "../db/schema";
import { CurrentUser, type Actor } from "../http/actor";
import { isSupabaseAuth } from "./auth.service";

const STARTER_WORK_CENTERS = [
  { code: "IMP", name: "Impresión", kind: "printer", hourlyRate: "35.00" },
  { code: "POST", name: "Postproceso", kind: "post_process", hourlyRate: "90.00" },
  { code: "QC", name: "Calidad", kind: "quality", hourlyRate: "90.00" },
  { code: "EMP", name: "Empaque", kind: "packing", hourlyRate: "70.00" },
] as const;

const STARTER_DEFECTS = [
  ["WARP", "Warping / despegue de cama"],
  ["STRING", "Hilos (stringing)"],
  ["LAYER", "Capas separadas o corridas"],
  ["DIM", "Fuera de medida"],
  ["COLOR", "Color o acabado incorrecto"],
] as const;

const onboardingSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().max(200).optional(),
  rfc: z.string(),
  taxRegime: z.string(),
  fiscalPostalCode: z.string(),
  state: z.string(),
  locationName: z.string().trim().min(1).max(120).default("Matriz"),
  locationPostalCode: z.string(),
  vatRate: z.enum(["0.16", "0.08", "0"]).default("0.16"),
  paymentMethods: z.object({
    efectivo: z.boolean(),
    spei: z.boolean(),
    tarjeta: z.boolean(),
    mercadopago: z.boolean(),
    conekta: z.boolean(),
    stripe: z.boolean(),
    cod: z.boolean(),
    credito: z.boolean(),
  }),
  seedDemo: z.boolean().default(false),
  privacyAccepted: z.literal(true, {
    errorMap: () => ({ message: "Acepta el aviso de privacidad para continuar." }),
  }),
});

@Controller("onboarding")
export class OnboardingController {
  private get database() {
    return services().database;
  }

  private get auth() {
    return services().auth;
  }

  @Post()
  async create(@CurrentUser() actor: Actor, @Body() body: unknown) {
    if (actor.tenantId) {
      throw new AppError("tenant_exists", "Esta cuenta ya tiene un taller.", 409);
    }
    const input = onboardingSchema.parse(body);
    const rfc = assertRfc(input.rfc);
    const regime = assertTaxRegime(input.taxRegime);
    const fiscalPostalCode = assertPostalCode(input.fiscalPostalCode);
    const state = assertMxState(input.state);
    const locationPostalCode = assertPostalCode(input.locationPostalCode);
    const slug = slugify(input.tradeName || input.legalName);

    const created = await this.database.asAdmin(async (db) => {
      const [tenant] = await db
        .insert(tenants)
        .values({ slug, status: "active", countryCode: "MX", plan: "beta", rfc })
        .returning();
      await db.insert(companyProfiles).values({
        tenantId: tenant.id,
        legalName: input.legalName,
        tradeName: input.tradeName || input.legalName,
        rfc,
        taxRegime: regime,
        fiscalPostalCode,
        currency: "MXN",
        timezone: "America/Mexico_City",
        locale: "es-MX",
        defaultVatRate: Number(input.vatRate).toFixed(4),
        preinvoiceSeries: "A",
        privacyAcceptedAt: new Date(),
        createdBy: actor.userId,
      });
      await db.insert(locations).values({
        tenantId: tenant.id,
        name: input.locationName,
        kind: "warehouse",
        postalCode: locationPostalCode,
        state,
        countryCode: "MX",
        isDefault: true,
        createdBy: actor.userId,
      });
      await db.insert(taxRates).values({
        tenantId: tenant.id,
        name: "IVA",
        rate: Number(input.vatRate).toFixed(4),
        isDefault: true,
        countryCode: "MX",
        createdBy: actor.userId,
      });
      await db.insert(paymentMethodSettings).values(
        PAYMENT_METHODS.map((method) => ({
          tenantId: tenant.id,
          method,
          enabled: input.paymentMethods[method],
        })),
      );
      await db.insert(numberSequences).values({
        tenantId: tenant.id,
        docType: "prefactura",
        series: "A",
        nextFolio: 1n,
      });
      await db.insert(tenantMemberships).values({
        tenantId: tenant.id,
        userId: actor.userId,
        role: "owner",
        email: actor.email,
      });
      await db.insert(workCenters).values(
        STARTER_WORK_CENTERS.map((center) => ({
          tenantId: tenant.id,
          code: center.code,
          name: center.name,
          kind: center.kind,
          hourlyRateMinor: Money.fromMajor(center.hourlyRate).minor,
          createdBy: actor.userId,
        })),
      );
      await db.insert(defectTypes).values(
        STARTER_DEFECTS.map(([code, name]) => ({ tenantId: tenant.id, code, name, createdBy: actor.userId })),
      );
      if (input.seedDemo) {
        await db.insert(filaments).values([
          demoProduct(tenant.id, actor.userId, {
            sku: "FIL-PLA-NEG-175",
            name: "PLA negro 1.75 mm",
            material: "PLA",
            color: "Negro",
            cost: "250.00",
            salePrice: "0.48",
          }),
          demoProduct(tenant.id, actor.userId, {
            sku: "FIL-PETG-BLA-175",
            name: "PETG blanco 1.75 mm",
            material: "PETG",
            color: "Blanco",
            cost: "280.00",
            salePrice: "0.52",
          }),
        ]);
      }
      await db.insert(auditEvents).values({
        tenantId: tenant.id,
        actorUserId: actor.userId,
        action: "tenant.onboarded",
        entityType: "tenant",
        entityId: tenant.id,
        metadata: { rfc, vatRate: input.vatRate, privacyAccepted: true },
      });
      return tenant;
    });

    await this.auth.auditPlatform(actor.userId, "tenant.created", created.id, { rfc });
    const session = await this.auth.sessionFor(actor.userId, actor.email);
    return {
      token: isSupabaseAuth() ? null : await this.auth.sign(session),
      tenant: { id: created.id, slug: created.slug, rfc: created.rfc },
    };
  }
}

function demoProduct(
  tenantId: string,
  createdBy: string,
  input: { sku: string; name: string; material: string; color: string; cost: string; salePrice: string },
) {
  return {
    tenantId,
    sku: input.sku,
    name: input.name,
    status: "active",
    material: input.material,
    color: input.color,
    diameterMm: "1.75",
    costMinor: Money.fromMajor(input.cost).minor,
    salePriceMinor: Money.fromMajor(input.salePrice).minor,
    createdBy,
  };
}

function slugify(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "taller"}-${randomBytes(3).toString("hex")}`;
}

export async function findOwnedTenant(database: DatabaseService, userId: string) {
  const [membership] = await database.asAdmin((db) =>
    db.select().from(tenantMemberships).where(eq(tenantMemberships.userId, userId)).limit(1),
  );
  return membership ?? null;
}
