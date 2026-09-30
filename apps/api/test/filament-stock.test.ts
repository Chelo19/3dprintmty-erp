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

describe("inventario de filamentos — consumo y conteo físico", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ dataDir: null });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("resta consumo, registra la diferencia del conteo y lo muestra en entradas y salidas", async () => {
    const owner = await onboard(app, "sol@taller-sol.test", "TSO010101AAA", "Taller Sol");
    const api = client(app, owner);
    const filament = await api.post("/filaments", { sku: "PLA-BLA", name: "PLA blanco", material: "PLA", color: "Blanco", diameterMm: "1.75", cost: "300.00" });
    expect(filament.status).toBe(201);
    const id = filament.body.id as string;
    const [location] = (await api.get("/locations")).body;
    const received = await api.post("/inventory/movements", { productId: id, locationId: location.id, kind: "receipt", quantity: "2000", reason: "Compra de 2 rollos" });
    expect(received.status).toBe(201);
    expect(await onHand(api, id)).toBe("2000");

    const used = await api.post(`/inventory/filaments/${id}/adjust`, { mode: "subtract", grams: "250", reason: "Impresión" });
    expect(used.status).toBe(201);
    expect(used.body).toMatchObject({ before: "2000", delta: "-250", onHand: "1750" });
    expect(await onHand(api, id)).toBe("1750");

    const tooMuch = await api.post(`/inventory/filaments/${id}/adjust`, { mode: "subtract", grams: "5000" });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error?.code ?? tooMuch.body.code).toBe("not_enough_filament");
    const nothing = await api.post(`/inventory/filaments/${id}/adjust`, { mode: "subtract", grams: "0" });
    expect(nothing.status).toBeGreaterThanOrEqual(400);
    expect(await onHand(api, id)).toBe("1750");

    const counted = await api.post(`/inventory/filaments/${id}/adjust`, { mode: "count", grams: String(1 * 1000 + 320 + 110) });
    expect(counted.body).toMatchObject({ before: "1750", delta: "-320", onHand: "1430" });
    const same = await api.post(`/inventory/filaments/${id}/adjust`, { mode: "count", grams: "1430" });
    expect(same.body).toMatchObject({ delta: "0", onHand: "1430" });
    const restock = await api.post(`/inventory/filaments/${id}/adjust`, { mode: "count", grams: "3000", reason: "Apareció una caja" });
    expect(restock.body).toMatchObject({ delta: "1570", onHand: "3000" });
    expect(await onHand(api, id)).toBe("3000");

    const ledger = await api.get(`/inventory/ledger?section=filaments&productId=${id}`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.data.map((row: { kind: string; quantity: string; reason: string; stockUom: string }) => [row.kind, row.quantity, row.reason, row.stockUom])).toEqual([
      ["adjustment", "1570", "Conteo físico: Apareció una caja", "g"],
      ["adjustment", "-320", "Conteo físico: había 1750 g", "g"],
      ["adjustment", "-250", "Impresión", "g"],
      ["receipt", "2000", "Compra de 2 rollos", "g"],
    ]);
    const products = await api.get("/inventory/ledger?section=products");
    expect(products.body.data).toHaveLength(0);
  });

  it("una compra marcada como pagada registra el abono completo y suma el filamento", async () => {
    const owner = await onboard(app, "rio@taller-rio.test", "TRI010101AAA", "Taller Río");
    const api = client(app, owner);
    const filament = await api.post("/filaments", { sku: "PETG-ROJ", name: "PETG rojo", material: "PETG", color: "Rojo", diameterMm: "1.75", cost: "300.00" });
    const id = filament.body.id as string;

    const paidNow = await api.post("/expenses", { kind: "filament", itemId: id, quantity: "2", amount: "600.00", occurredOn: "2026-09-02", paid: true, paidOn: "2026-09-03" });
    expect(paidNow.status).toBe(201);
    expect(paidNow.body).toMatchObject({ paid: "600.00", balance: "0.00", paymentStatus: "paid" });
    expect(paidNow.body.payments).toMatchObject([{ paidOn: "2026-09-03", amount: "600.00" }]);
    expect(await onHand(api, id)).toBe("2000");

    const sameDay = await api.post("/expenses", { kind: "service", description: "Mensajería", amount: "150.00", occurredOn: "2026-09-04", paid: true });
    expect(sameDay.body.payments).toMatchObject([{ paidOn: "2026-09-04", amount: "150.00" }]);

    const unpaid = await api.post("/expenses", { kind: "service", description: "Maquila", amount: "500.00", occurredOn: "2026-09-04", paid: false, paidAmount: "100.00" });
    expect(unpaid.body).toMatchObject({ paid: "0.00", balance: "500.00", paymentStatus: "pending" });
    expect(unpaid.body.payments).toEqual([]);
    const settled = await api.post(`/expenses/${unpaid.body.id}/payments`, { amount: "500.00", paidOn: "2026-09-10" });
    expect(settled.status).toBe(201);
    expect((await api.get(`/expenses/${unpaid.body.id}`)).body.paymentStatus).toBe("paid");
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
