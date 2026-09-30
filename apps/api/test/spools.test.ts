import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/main";

process.env.VITEST = "1";
delete process.env.DATABASE_URL;

const password = "taller-seguro";

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("rollos — pesaje y baja", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ dataDir: null });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("guarda el peso del rollo y ajusta la existencia del filamento", async () => {
    const owner = await onboard(app, "luz@taller-luz.test", "TLU010101AAA", "Taller Luz");
    const api = client(app, owner);
    const filament = await api.post("/filaments", { sku: "PLA-NEG", name: "PLA negro", material: "PLA", color: "Negro", diameterMm: "1.75", cost: "300.00" });
    expect(filament.status).toBe(201);
    const created = await api.post("/spools", { filamentId: filament.body.id, grams: "1000", addToStock: true });
    expect(created.status).toBe(201);
    const spool = created.body.data[0];

    const weighed = await api.post(`/spools/${spool.id}/weigh`, { grams: "750", reason: "Pesaje de hoy" });
    expect(weighed.status).toBe(201);
    expect(weighed.body).toMatchObject({ currentGrams: "750", status: "in_use" });
    const listed = await api.get("/spools");
    expect(listed.body.data[0]).toMatchObject({ id: spool.id, currentGrams: "750" });
    expect(await onHand(api, filament.body.id)).toBe("750");

    const quick = await api.post(`/spools/${spool.id}/weigh`, { grams: "700" });
    expect(quick.status).toBe(201);
    expect(quick.body.currentGrams).toBe("700");

    const emptied = await api.post(`/spools/${spool.id}/weigh`, { grams: "0" });
    expect(emptied.body).toMatchObject({ currentGrams: "0", status: "empty" });
    expect(await onHand(api, filament.body.id)).toBe("0");

    const mistake = await api.post("/spools", { filamentId: filament.body.id, grams: "500", addToStock: true });
    expect(await onHand(api, filament.body.id)).toBe("500");
    const removed = await api.delete(`/spools/${mistake.body.data[0].id}`);
    expect(removed.status).toBe(200);
    expect(await onHand(api, filament.body.id)).toBe("0");
    const remaining = await api.get("/spools");
    expect(remaining.body.data.map((row: { id: string }) => row.id)).toEqual([spool.id]);
  });

  it("registra varios rollos iguales a la vez", async () => {
    const owner = await onboard(app, "mar@taller-mar.test", "TMA010101AAA", "Taller Mar");
    const api = client(app, owner);
    const filament = await api.post("/filaments", { sku: "PETG-AZ", name: "PETG azul", material: "PETG", color: "Azul", diameterMm: "1.75", cost: "320.00" });

    const batch = await api.post("/spools", { filamentId: filament.body.id, grams: "1000", count: 3, addToStock: true });
    expect(batch.status).toBe(201);
    expect(batch.body.data.map((row: { spoolNumber: string; currentGrams: string }) => [row.spoolNumber, row.currentGrams])).toEqual([
      ["R-1", "1000"],
      ["R-2", "1000"],
      ["R-3", "1000"],
    ]);
    expect(await onHand(api, filament.body.id)).toBe("3000");

    const tooMany = await api.post("/spools", { filamentId: filament.body.id, grams: "1000", count: 51 });
    expect(tooMany.status).toBe(400);
    expect((await api.get("/spools")).body.data).toHaveLength(3);

    const [first, second] = batch.body.data;
    const emptied = await api.post("/spools/empty", { spoolIds: [first.id, second.id] });
    expect(emptied.status).toBe(201);
    expect(emptied.body.data.map((row: { currentGrams: string; status: string }) => [row.currentGrams, row.status])).toEqual([
      ["0", "empty"],
      ["0", "empty"],
    ]);
    expect(await onHand(api, filament.body.id)).toBe("1000");

    const missing = await api.post("/spools/empty", { spoolIds: [batch.body.data[2].id, "00000000-0000-4000-8000-000000000000"] });
    expect(missing.status).toBe(404);
    expect(await onHand(api, filament.body.id)).toBe("1000");
  });

  async function onHand(api: ReturnType<typeof client>, filamentId: string) {
    const balances = await api.get("/inventory/balances");
    return balances.body.data.find((row: { productId: string }) => row.productId === filamentId)?.onHand ?? "0";
  }
});

function client(app: INestApplication, token: string) {
  const server = () => app.getHttpServer();
  return {
    get: (path: string) => request(server()).get(`/api/v1${path}`).set(bearer(token)),
    post: (path: string, body: unknown) => request(server()).post(`/api/v1${path}`).set(bearer(token)).send(body as object),
    delete: (path: string) => request(server()).delete(`/api/v1${path}`).set(bearer(token)),
  };
}

async function onboard(app: INestApplication, email: string, rfc: string, legalName: string): Promise<string> {
  const registered = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email, password });
  expect(registered.status).toBe(201);
  const response = await request(app.getHttpServer())
    .post("/api/v1/onboarding")
    .set(bearer(registered.body.token))
    .send({
      legalName,
      tradeName: legalName,
      rfc,
      taxRegime: "626",
      fiscalPostalCode: "64000",
      state: "Nuevo León",
      locationName: "Matriz",
      locationPostalCode: "64000",
      vatRate: "0.16",
      paymentMethods: { efectivo: true, spei: true, tarjeta: false, mercadopago: false, conekta: false, stripe: false, cod: false, credito: false },
      seedDemo: false,
      privacyAccepted: true,
    });
  expect(response.status).toBe(201);
  return response.body.token as string;
}
