import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/db/database.service";
import { migrationFiles } from "../src/db/migrations";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, expect, it } from "vitest";
import request from "supertest";
import { Money } from "@3dprintmty/domain";
import { createApp } from "../src/main";
let app: INestApplication;
let token: string;
let customerId: string;
let productId: string;
const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
const post = (path: string, body: object) => request(app.getHttpServer()).post(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("Idempotency-Key", crypto.randomUUID()).send(body);
beforeAll(async () => {
  app = await createApp({ dataDir: null });
  const account = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email: "dates@payments.test", password: "payment-dates-123" });
  const onboard = await request(app.getHttpServer()).post("/api/v1/onboarding").set("Authorization", `Bearer ${account.body.token}`).send({ legalName: "Fechas de pagos", rfc: "FPG010101AAA", taxRegime: "626", fiscalPostalCode: "64000", state: "Nuevo León", locationName: "Matriz", locationPostalCode: "64000", vatRate: "0.16", paymentMethods: { efectivo: true, spei: true, tarjeta: false, mercadopago: false, conekta: false, stripe: false, cod: true, credito: false }, seedDemo: false, privacyAccepted: true });
  expect(onboard.status).toBe(201);
  token = onboard.body.token;
  customerId = (await post("/customers", { kind: "b2c", legalName: "Cliente fechas", fiscal: { state: "Nuevo León" } })).body.id;
  productId = (await post("/products", { sku: "PAY-DATE", name: "Producto fechas", productType: "resale", cost: "10", salePrice: "100" })).body.id;
});
afterAll(async () => { await app?.close(); });
async function order() {
  const created = await post("/orders", { customerId, lines: [{ productId, description: "Producto", quantity: "10", unitPrice: "100" }] });
  expect((await post(`/orders/${created.body.id}/submit`, {})).status).toBe(201);
  return created.body.id as string;
}

it("conserva fecha real y fecha de captura y usa el mes del pago en dashboard y exportaciones", async () => {
  const orderId = await order();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const month = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() - 1);
  const paidOn = `${month.toISOString().slice(0, 7)}-15`;
  const before = (await get("/dashboard")).body.kpis.collectedLastMonth;
  const paid = await post("/payments", { orderId, method: "efectivo", amount: "100", paidOn, reference: "PAGO-RETROACTIVO" });
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);
  expect(paid.body).toMatchObject({ paidOn, amount: "100.00", status: "completed" });
  expect(new Date(paid.body.createdAt).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" })).toBe(today);
  expect((await get("/payments")).body.data.find((row: { id: string }) => row.id === paid.body.id).paidOn).toBe(paidOn);
  expect((await get(`/customers/${customerId}`)).body.payments.find((row: { id: string }) => row.id === paid.body.id).paidOn).toBe(paidOn);
  expect((await get(`/orders/${orderId}`)).body.payments[0].paidOn).toBe(paidOn);
  const after = (await get("/dashboard")).body.kpis.collectedLastMonth;
  expect(Money.fromMajor(after).minor - Money.fromMajor(before).minor).toBe(10000n);
  const pack = await get(`/exports/accountant?from=${paidOn}&to=${paidOn}&format=json`);
  expect(pack.status).toBe(200);
  expect(pack.body.payments.find((row: { reference: string }) => row.reference === "PAGO-RETROACTIVO").date).toBe(paidOn);
  expect((await get(`/exports/accountant?from=${paidOn}&to=${paidOn}&format=zip`)).status).toBe(200);
  const refund = await post("/payments", { orderId, method: "efectivo", kind: "refund", amount: "10", paidOn });
  expect(refund.status).toBe(201);
  expect(refund.body.paidOn).toBe(paidOn);
  expect(Money.fromMajor((await get("/dashboard")).body.kpis.collectedLastMonth).minor - Money.fromMajor(before).minor).toBe(9000n);
});

it("un cobro pendiente no tiene fecha de recepción hasta confirmarlo, sin alterar su captura", async () => {
  const orderId = await order();
  const pending = await post("/payments", { orderId, method: "cod", amount: "50", paidOn: "2026-02-01" });
  expect(pending.status).toBe(201);
  expect(pending.body).toMatchObject({ status: "pending", paidOn: null });
  const completed = await post(`/payments/${pending.body.id}/complete`, { paidOn: "2026-03-02" });
  expect(completed.status).toBe(201);
  expect(completed.body).toMatchObject({ status: "completed", paidOn: "2026-03-02", createdAt: pending.body.createdAt });
});

it("usa hoy por defecto para nuevos cobros y al confirmar pendientes de clientes anteriores", async () => {
  const orderId = await order();
  const paid = await post("/payments", { orderId, method: "spei", amount: "25" });
  expect(paid.status).toBe(201);
  const today = new Date(paid.body.createdAt).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  expect(paid.body.paidOn).toBe(today);
  const pending = await post("/payments", { orderId, method: "cod", amount: "25" });
  const completed = await post(`/payments/${pending.body.id}/complete`, {});
  expect(completed.status).toBe(201);
  expect(completed.body.paidOn).toBe(today);
});

it("rechaza fechas inexistentes sin registrar cobros", async () => {
  const orderId = await order();
  for (const paidOn of ["2026-02-30", "2026-13-01", "2026-00-10", "27/10/2026", "0000-01-01"]) {
    expect((await post("/payments", { orderId, method: "efectivo", amount: "1", paidOn })).status).toBe(400);
  }
  expect((await get(`/orders/${orderId}`)).body.payments).toEqual([]);
});

it("las compras permiten fechar el pago inicial y cada abono de forma independiente", async () => {
  const expense = await post("/expenses", { kind: "other", description: "Gasto pagado anteriormente", amount: "100", occurredOn: "2026-10-01", paidAmount: "40", paidOn: "2026-09-29" });
  expect(expense.status).toBe(201);
  expect(expense.body.payments[0].paidOn).toBe("2026-09-29");
  const payment = await post(`/expenses/${expense.body.id}/payments`, { amount: "60", paidOn: "2026-10-10" });
  expect(payment.status).toBe(201);
  const detail = await get(`/expenses/${expense.body.id}`);
  expect(detail.body.payments.map((row: { paidOn: string }) => row.paidOn)).toEqual(["2026-09-29", "2026-10-10"]);
  expect(detail.body.paymentStatus).toBe("paid");
});


it("migra pagos históricos usando su día de captura en México sin cambiar autores ni timestamps", async () => {
  const db = new PGlite();
  const root = repoRoot();
  const migration = "20261027213802_payment_effective_date.sql";
  const [user, tenant, customer, salesOrder, first, pending] = Array.from({ length: 6 }, (_, i) => `60000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
  try {
    await db.exec(readFileSync(join(root, "supabase/local/auth_stubs.sql"), "utf8"));
    for (const file of migrationFiles(root).filter((file) => file < migration)) await db.exec(readFileSync(join(root, "supabase/migrations", file), "utf8"));
    await db.query("insert into user_accounts(id,email) values ($1,'historic-payment@test.local')", [user]);
    await db.query("insert into tenants(id,slug,status) values ($1,'historical-payment','active')", [tenant]);
    await db.query("insert into customers(id,tenant_id,kind,legal_name,created_by) values ($1,$2,'b2c','Cliente histórico',$3)", [customer,tenant,user]);
    await db.query("insert into sales_orders(id,tenant_id,folio,customer_id,customer_name,subtotal_minor,vat_minor,total_minor,created_by) values ($1,$2,'PED-1',$3,'Cliente histórico',10000,1600,11600,$4)", [salesOrder,tenant,customer,user]);
    await db.query("insert into payments(id,tenant_id,sales_order_id,method,status,amount_minor,created_by,created_at) values ($1,$2,$3,'efectivo','completed',1000,$4,'2026-10-02T02:00:00Z'),($5,$2,$3,'cod','pending',1000,$4,'2026-10-02T02:00:00Z')", [first,tenant,salesOrder,user,pending]);
    const before = (await db.query("select id,status,amount_minor,created_at,created_by from payments order by id")).rows;
    await db.exec(readFileSync(join(root, "supabase/migrations", migration), "utf8"));
    expect((await db.query("select id,status,amount_minor,created_at,created_by from payments order by id")).rows).toEqual(before);
    expect((await db.query("select paid_on::text as paid_on from payments where id=$1", [first])).rows[0]).toEqual({ paid_on: "2026-10-01" });
    expect((await db.query("select paid_on from payments where id=$1", [pending])).rows[0]).toEqual({ paid_on: null });
  } finally { await db.close(); }
});
