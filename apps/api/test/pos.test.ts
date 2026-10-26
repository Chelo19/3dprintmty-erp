import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { AppError } from "@3dprintmty/shared";
import { services } from "../src/container";
import { products } from "../src/db/schema";
import { createApp } from "../src/main";

let app: INestApplication;
let serial = 0;
const password = "taller-seguro";
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
beforeAll(async () => { app = await createApp({ dataDir: null }); });
afterAll(async () => { await app?.close(); });
function client(token: string) {
  return {
    get: (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set(bearer(token)),
    post: (path: string, body: object, key = crypto.randomUUID()) => request(app.getHttpServer()).post(`/api/v1${path}`).set(bearer(token)).set("Idempotency-Key", key).send(body),
  };
}
async function fixture() {
  const index = ++serial;
  const email = `owner${index}@pos.test`;
  const account = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email, password });
  expect(account.status).toBe(201);
  const onboard = await request(app.getHttpServer()).post("/api/v1/onboarding").set(bearer(account.body.token)).send({
    legalName: `Taller POS ${index}`, rfc: `PA${String.fromCharCode(65 + index)}010101AAA`, taxRegime: "626", fiscalPostalCode: "64000", state: "Nuevo León",
    locationName: "Mostrador", locationPostalCode: "64000", vatRate: "0.16", seedDemo: false, privacyAccepted: true,
    paymentMethods: { efectivo: true, spei: true, tarjeta: true, mercadopago: false, conekta: false, stripe: false, cod: true, credito: false },
  });
  expect(onboard.status).toBe(201);
  const token = onboard.body.token as string;
  const owner = client(token);
  const location = (await owner.get("/locations")).body[0];
  const product = await owner.post("/products", { sku: "POS-1", name: "Pieza mostrador", productType: "resale", cost: "20", salePrice: "100" });
  expect(product.status).toBe(201);
  expect((await owner.post("/inventory/movements", { productId: product.body.id, locationId: location.id, kind: "receipt", quantity: "5", reason: "Stock inicial POS" })).status).toBe(201);
  const body = { locationId: location.id, method: "efectivo", cashTendered: "400", expectedTotal: "348", lines: [{ id: product.body.id, kind: "product", quantity: "3" }] };
  return { owner, token, body, productId: product.body.id, index };
}

it("cobra, entrega, descuenta stock libre y conserva un ticket con cambio y autoría", async () => {
  const f = await fixture();
  const sale = await f.owner.post("/pos/sales", f.body);
  expect(sale.status, JSON.stringify(sale.body)).toBe(201);
  expect(sale.body).toMatchObject({ total: "348.00", cashTendered: "400.00", change: "52.00", method: "efectivo", customerRfc: "XAXX010101000" });
  expect((await f.owner.get(`/pos/sales/${sale.body.id}`)).body).toMatchObject(sale.body);
  const order = await f.owner.get(`/orders/${sale.body.id}`);
  expect(order.body).toMatchObject({ status: "completed", paymentStatus: "paid", amountDue: "0.00", fulfillmentStatus: "delivered" });
  expect(order.body.lines[0]).toMatchObject({ quantity: "3", shipped: "3" });
  const balances = await f.owner.get("/inventory/balances");
  expect(balances.body.data[0]).toMatchObject({ onHand: "2", allocated: "0" });
  expect((await f.owner.get("/payments")).body.data).toHaveLength(1);
  const ledger = await f.owner.get("/inventory/ledger?section=resale");
  const issue = ledger.body.data.find((row: { kind: string }) => row.kind === "issue");
  expect(issue).toMatchObject({ quantity: "-3", actorEmail: `owner${f.index}@pos.test`, salesOrder: { id: sale.body.id } });
  expect((await f.owner.get("/pos/sales?limit=1&page=1")).body).toMatchObject({ total: 1, page: 1, limit: 1 });
});

it("un reintento concurrente cobra y descuenta una sola vez", async () => {
  const f = await fixture();
  const key = crypto.randomUUID();
  const [first, second] = await Promise.all([f.owner.post("/pos/sales", f.body, key), f.owner.post("/pos/sales", f.body, key)]);
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  expect(second.status).toBe(201);
  expect(first.body.id).toBe(second.body.id);
  expect((await f.owner.get("/pos/sales")).body.total).toBe(1);
  expect((await f.owner.get("/payments")).body.data).toHaveLength(1);
  expect((await f.owner.get("/inventory/balances")).body.data[0].onHand).toBe("2");
  expect((await f.owner.post("/pos/sales", { ...f.body, cashTendered: "500" }, key)).status).toBe(409);
});

it("dos cobros distintos en paralelo no pueden consumir el mismo stock", async () => {
  const f = await fixture();
  const results = await Promise.all([f.owner.post("/pos/sales", f.body), f.owner.post("/pos/sales", f.body)]);
  expect(results.map((row) => row.status).sort()).toEqual([201, 409]);
  expect((await f.owner.get("/pos/sales")).body.total).toBe(1);
  expect((await f.owner.get("/inventory/balances")).body.data[0].onHand).toBe("2");
});

it("rechaza sobreventa, efectivo insuficiente, totales alterados y métodos pendientes sin efectos parciales", async () => {
  const f = await fixture();
  const cases = [
    { ...f.body, lines: [{ ...f.body.lines[0], quantity: "6" }], expectedTotal: "696", cashTendered: "700" },
    { ...f.body, cashTendered: "1" },
    { ...f.body, expectedTotal: "1" },
    { ...f.body, method: "cod" },
    { ...f.body, lines: [f.body.lines[0], f.body.lines[0]] },
    { ...f.body, lines: [{ ...f.body.lines[0], quantity: "0" }] },
  ];
  for (const body of cases) {
    const response = await f.owner.post("/pos/sales", body);
    expect([400, 409], JSON.stringify(response.body)).toContain(response.status);
  }
  expect((await f.owner.get("/orders")).body.data).toHaveLength(0);
  expect((await f.owner.get("/payments")).body.data).toHaveLength(0);
  expect((await f.owner.get("/customers")).body.data).toHaveLength(0);
  expect((await f.owner.get("/inventory/balances")).body.data[0].onHand).toBe("5");
});

it("respeta las unidades apartadas para pedidos", async () => {
  const f = await fixture();
  const customer = await f.owner.post("/customers", { kind: "b2c", legalName: "Cliente reserva", fiscal: { state: "Nuevo León" } });
  const order = await f.owner.post("/orders", { customerId: customer.body.id, lines: [{ productId: f.productId, description: "Pieza", quantity: "4", unitPrice: "100" }] });
  expect((await f.owner.post(`/orders/${order.body.id}/submit`, {})).status).toBe(201);
  expect((await f.owner.post(`/orders/${order.body.id}/confirm`, { creditOverrideReason: "Reserva de prueba" })).status).toBe(201);
  const result = await f.owner.post("/pos/sales", f.body);
  expect(result.status).toBe(409);
  expect(result.body.code).toBe("insufficient_stock");
  expect((await f.owner.get("/inventory/balances")).body.data[0]).toMatchObject({ onHand: "5", allocated: "4" });
  expect((await f.owner.post("/inventory/movements", { productId: f.productId, locationId: f.body.locationId, kind: "issue", quantity: "1", reason: "Salida de unidad libre" })).status).toBe(201);
  expect((await f.owner.get("/pos/catalog")).body.items).toEqual([]);
  const unavailable = await f.owner.get("/pos/catalog?includeOutOfStock=true");
  expect(unavailable.body.items[0]).toMatchObject({ id: f.productId, available: "0" });
});

it("revierte pedido, pago, stock, cliente y folio si algo falla después de descontar inventario", async () => {
  const f = await fixture();
  const db = services().database;
  const original = db.asAdminActor.bind(db);
  let calls = 0;
  const spy = vi.spyOn(db, "asAdminActor").mockImplementation((actor, fn) => {
    const fail = ++calls === 2;
    return original(actor, async (tx) => {
      const result = await fn(tx);
      if (fail) throw new AppError("pos_test_failure", "Falla posterior a la salida de inventario", 409);
      return result;
    });
  });
  try { expect((await f.owner.post("/pos/sales", f.body)).status).toBe(409); } finally { spy.mockRestore(); }
  expect((await f.owner.get("/orders")).body.data).toHaveLength(0);
  expect((await f.owner.get("/payments")).body.data).toHaveLength(0);
  expect((await f.owner.get("/customers")).body.data).toHaveLength(0);
  expect((await f.owner.get("/inventory/balances")).body.data[0].onHand).toBe("5");
  const successful = await f.owner.post("/pos/sales", f.body);
  expect(successful.status).toBe(201);
  expect(successful.body.folio).toBe("PED-1");
});

it("operador y ventas cobran sin permisos generales de edición; consulta y otros talleres no acceden", async () => {
  const f = await fixture();
  for (const role of ["sales", "operator", "viewer"] as const) {
    const invitation = await f.owner.post("/invitations", { email: `${role}${f.index}@pos.test`, role });
    const inviteToken = invitation.body.acceptPath.split("/").pop();
    const joined = await request(app.getHttpServer()).post("/api/v1/invitations/accept").send({ token: inviteToken, password });
    expect(joined.status, JSON.stringify(joined.body)).toBe(201);
    const actor = client(joined.body.token);
    const catalog = await actor.get("/pos/catalog");
    if (role === "viewer") { expect(catalog.status).toBe(403); expect((await actor.post("/pos/sales", f.body)).status).toBe(403); continue; }
    expect(catalog.status).toBe(200);
    expect(catalog.body.items[0]).not.toHaveProperty("cost");
    const sold = await actor.post("/pos/sales", { ...f.body, lines: [{ id: f.productId, kind: "product", quantity: "1" }], expectedTotal: "116", cashTendered: "200" });
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);
  }
  const other = await fixture();
  const sale = await f.owner.post("/pos/sales", { ...f.body, lines: [{ id: f.productId, kind: "product", quantity: "1" }], expectedTotal: "116" });
  expect(sale.status).toBe(201);
  expect((await other.owner.get(`/pos/sales/${sale.body.id}`)).status).toBe(404);
  expect((await other.owner.post("/pos/sales", f.body)).status).toBe(404);
  expect((await other.owner.post("/pos/sales", { ...f.body, locationId: other.body.locationId })).status).toBe(409);
  expect((await other.owner.get("/inventory/balances")).body.data[0].onHand).toBe("5");
  expect((await other.owner.get("/pos/sales")).body.total).toBe(0);
});

it("vende servicios y conserva descuentos e impuestos por partida con pago por transferencia", async () => {
  const f = await fixture();
  const service = await f.owner.post("/services", { code: "POS-S", name: "Servicio inmediato", unit: "servicio", cost: "10", salePrice: "50" });
  expect(service.status).toBe(201);
  const sale = await f.owner.post("/pos/sales", { locationId: f.body.locationId, method: "spei", reference: "TRANSFER-001", expectedTotal: "154.40", lines: [
    { id: f.productId, kind: "product", quantity: "1", unitPrice: "100", discount: "10", vatRate: "0.16", isrRate: "0" },
    { id: service.body.id, kind: "service", quantity: "1", vatRate: "0", isrRate: "0" },
  ] });
  expect(sale.status, JSON.stringify(sale.body)).toBe(201);
  expect(sale.body).toMatchObject({ subtotal: "140.00", discount: "10.00", vat: "14.40", total: "154.40", cashTendered: null, change: "0.00", reference: "TRANSFER-001" });
  expect((await f.owner.get("/inventory/balances")).body.data[0].onHand).toBe("4");
});


it("el catálogo oculta artículos sin stock antes del límite y filtra por servicio, fabricación y reventa", async () => {
  const f = await fixture();
  const actor = await services().auth.verify(f.token);
  await services().database.asUser(actor, (db) => db.insert(products).values(Array.from({ length: 65 }, (_, index) => ({
    tenantId: actor.tenantId!, createdBy: actor.userId, sku: `EMPTY-${index}`, name: `AAA sin inventario ${index}`,
    itemClass: "finished_good", supplyMode: "buy", salePriceMinor: 10000n,
  }))));
  const manufactured = await f.owner.post("/products", { sku: "MADE-POS", name: "Fabricado POS", itemClass: "finished_good", supplyMode: "make", cost: "10", salePrice: "100" });
  const mixed = await f.owner.post("/products", { sku: "MIX-POS", name: "Mixto POS", itemClass: "finished_good", supplyMode: "both", cost: "10", salePrice: "100" });
  const supply = await f.owner.post("/products", { sku: "SUP-POS", name: "Insumo POS", itemClass: "component", supplyMode: "buy", cost: "10", salePrice: "100" });
  for (const created of [manufactured, mixed, supply]) {
    expect(created.status).toBe(201);
    expect((await f.owner.post("/inventory/movements", { productId: created.body.id, locationId: f.body.locationId, kind: "receipt", quantity: "2", reason: "Stock para filtro POS" })).status).toBe(201);
  }
  const service = await f.owner.post("/services", { code: "FILTER-S", name: "Servicio POS", unit: "servicio", cost: "1", salePrice: "50" });
  expect(service.status).toBe(201);
  const catalog = await f.owner.get("/pos/catalog");
  expect(catalog.status).toBe(200);
  const ids = (response: { body: { items: Array<{ id: string }> } }) => response.body.items.map((item) => item.id).sort();
  expect(ids(catalog)).toEqual([f.productId, manufactured.body.id, mixed.body.id, supply.body.id, service.body.id].sort());
  const finished = await f.owner.get("/pos/catalog?type=finished");
  expect(ids(finished)).toEqual([manufactured.body.id, mixed.body.id].sort());
  expect(finished.body.items.find((row: { id: string }) => row.id === manufactured.body.id).category).toBe("finished");
  expect(ids(await f.owner.get("/pos/catalog?type=product"))).toEqual([f.productId, mixed.body.id].sort());
  expect(ids(await f.owner.get("/pos/catalog?type=service"))).toEqual([service.body.id]);
  expect((await f.owner.get("/pos/catalog?q=AAA")).body.items).toEqual([]);
  const withEmpty = await f.owner.get("/pos/catalog?q=EMPTY-1&includeOutOfStock=true");
  expect(withEmpty.body.items.length).toBeGreaterThan(0);
  expect(withEmpty.body.items.every((row: { available: string }) => row.available === "0")).toBe(true);
  expect(ids(await f.owner.get("/pos/catalog?q=Fabricado&type=finished"))).toEqual([manufactured.body.id]);
  expect((await f.owner.get("/pos/catalog?type=invalid")).status).toBe(400);
});
