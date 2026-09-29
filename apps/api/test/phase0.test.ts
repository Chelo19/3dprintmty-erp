import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/main";
import { services } from "../src/container";
import { locations } from "../src/db/schema";

process.env.PLATFORM_ADMIN_EMAILS = "soporte@printmty.test";
process.env.VITEST = "1";
delete process.env.DATABASE_URL;

const password = "taller-seguro";

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function register(app: INestApplication, email: string) {
  const response = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({ email, password });
  expect(response.status).toBe(201);
  return response.body as { token: string; user: { id: string; email: string } };
}

describe("fase 0 — tenancy", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ dataDir: null });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("aísla talleres, oculta precios a producción y deja soporte auditado", async () => {
    const ownerA = await register(app, "ana@taller-a.test");
    const onboardA = await request(app.getHttpServer())
      .post("/api/v1/onboarding")
      .set(bearer(ownerA.token))
      .send(workshop("TDA010101AAA", "Taller A", true));
    expect(onboardA.status).toBe(201);
    expect(onboardA.body.tenant.rfc).toBe("TDA010101AAA");
    const tokenA = onboardA.body.token as string;

    const ownerB = await register(app, "beto@taller-b.test");
    const onboardB = await request(app.getHttpServer())
      .post("/api/v1/onboarding")
      .set(bearer(ownerB.token))
      .send(workshop("TDB010101AAA", "Taller B", false));
    expect(onboardB.status).toBe(201);
    const tokenB = onboardB.body.token as string;

    const productsA = await request(app.getHttpServer()).get("/api/v1/filaments").set(bearer(tokenA));
    const productsB = await request(app.getHttpServer()).get("/api/v1/filaments").set(bearer(tokenB));
    expect(productsA.body.data).toHaveLength(2);
    expect(productsB.body.data).toHaveLength(0);
    expect(productsA.body.data[0].salePrice).toBeTruthy();

    const leaked = await request(app.getHttpServer())
      .get(`/api/v1/filaments/${productsA.body.data[0].id}`)
      .set(bearer(tokenB));
    expect(leaked.status).toBe(404);

    const rowsA = await services().database.asUser(
      {
        userId: ownerA.user.id,
        email: ownerA.user.email,
        tenantId: onboardA.body.tenant.id,
        role: "owner",
        platformAdmin: false,
        impersonator: null,
      },
      (db) => db.select().from(locations),
    );
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].tenantId).toBe(onboardA.body.tenant.id);

    const foreign = await services().database.asUser(
      {
        userId: ownerA.user.id,
        email: ownerA.user.email,
        tenantId: onboardA.body.tenant.id,
        role: "owner",
        platformAdmin: false,
        impersonator: null,
      },
      (db) => db.select().from(locations).where(eq(locations.tenantId, onboardB.body.tenant.id)),
    );
    expect(foreign).toEqual([]);

    const company = await request(app.getHttpServer()).get("/api/v1/company").set(bearer(tokenA));
    expect(company.body.currency).toBe("MXN");
    expect(company.body.timezone).toBe("America/Mexico_City");
    expect(company.body.locale).toBe("es-MX");
    expect(company.body.vatRate).toBe("0.1600");

    const invite = await request(app.getHttpServer())
      .post("/api/v1/invitations")
      .set(bearer(tokenA))
      .send({ email: "piso@taller-a.test", role: "production" });
    expect(invite.status).toBe(201);
    const token = invite.body.acceptPath.split("/").at(-1);
    const accepted = await request(app.getHttpServer())
      .post("/api/v1/invitations/accept")
      .send({ token, password });
    expect(accepted.status).toBe(201);
    const productionProducts = await request(app.getHttpServer())
      .get("/api/v1/filaments")
      .set(bearer(accepted.body.token));
    expect(productionProducts.body.data).toHaveLength(2);
    expect(productionProducts.body.data.every((item: { salePrice: null }) => item.salePrice === null)).toBe(true);

    const salesInvite = await request(app.getHttpServer())
      .post("/api/v1/invitations")
      .set(bearer(tokenA))
      .send({ email: "ventas@taller-a.test", role: "sales" });
    const salesToken = salesInvite.body.acceptPath.split("/").at(-1);
    const sales = await request(app.getHttpServer())
      .post("/api/v1/invitations/accept")
      .send({ token: salesToken, password });
    const forbidden = await request(app.getHttpServer())
      .patch("/api/v1/company")
      .set(bearer(sales.body.token))
      .send({
        legalName: "Otra",
        rfc: "TDA010101AAA",
        taxRegime: "626",
        fiscalPostalCode: "44100",
        vatRate: "0.16",
      });
    expect(forbidden.status).toBe(403);

    const created = await request(app.getHttpServer())
      .post("/api/v1/filaments")
      .set(bearer(tokenA))
      .set("Idempotency-Key", "pla-extra")
      .send({
        sku: "FIL-ABS-ROJ-175",
        name: "ABS rojo 1.75 mm",
        material: "ABS",
        color: "Rojo",
        diameterMm: "1.75",
        cost: "300.00",
        salePrice: "610.00",
      });
    expect(created.status).toBe(201);
    const replay = await request(app.getHttpServer())
      .post("/api/v1/filaments")
      .set(bearer(tokenA))
      .set("Idempotency-Key", "pla-extra")
      .send({
        sku: "FIL-ABS-ROJ-175",
        name: "ABS rojo 1.75 mm",
        material: "ABS",
        color: "Rojo",
        diameterMm: "1.75",
        cost: "300.00",
        salePrice: "610.00",
      });
    expect(replay.body.id).toBe(created.body.id);
    const after = await request(app.getHttpServer()).get("/api/v1/filaments").set(bearer(tokenA));
    expect(after.body.data).toHaveLength(3);

    const preview = await request(app.getHttpServer())
      .post("/api/v1/tax/preview")
      .set(bearer(tokenA))
      .send({ lines: [{ description: "Pieza", quantity: "1", unitPrice: "100.00" }], rate: "0.16" });
    expect(preview.body.tax).toBe("16.00");
    expect(preview.body.total).toBe("116.00");

    const duplicateRfc = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: "otro@taller.test", password });
    const rejected = await request(app.getHttpServer())
      .post("/api/v1/onboarding")
      .set(bearer(duplicateRfc.body.token))
      .send(workshop("TDA010101AAA", "Copia", false));
    expect(rejected.status).toBe(409);

    const supportAccount = await register(app, "soporte@printmty.test");
    const tenants = await request(app.getHttpServer())
      .get("/api/v1/platform/tenants")
      .set(bearer(supportAccount.token));
    expect(tenants.status).toBe(200);
    expect(tenants.body.data.length).toBeGreaterThanOrEqual(2);
    const entered = await request(app.getHttpServer())
      .post("/api/v1/platform/impersonate")
      .set(bearer(supportAccount.token))
      .send({ tenantId: onboardA.body.tenant.id });
    expect(entered.status).toBe(201);
    const asSupport = await request(app.getHttpServer())
      .get("/api/v1/filaments")
      .set(bearer(entered.body.token));
    expect(asSupport.body.data).toHaveLength(3);
    const audit = await request(app.getHttpServer())
      .get("/api/v1/platform/audit")
      .set(bearer(supportAccount.token));
    expect(audit.body.data.some((event: { action: string }) => event.action === "support.impersonation_started")).toBe(
      true,
    );
  });
});

function workshop(rfc: string, legalName: string, seedDemo: boolean) {
  return {
    legalName,
    tradeName: legalName,
    rfc,
    taxRegime: "626",
    fiscalPostalCode: "44100",
    state: "Jalisco",
    locationName: "Matriz",
    locationPostalCode: "44100",
    vatRate: "0.16",
    paymentMethods: {
      efectivo: true,
      spei: true,
      tarjeta: false,
      mercadopago: false,
      conekta: false,
      stripe: false,
      cod: true,
      credito: false,
    },
    seedDemo,
    privacyAccepted: true,
  };
}
