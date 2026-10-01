import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { services } from "../src/container";
import { createApp } from "../src/main";

process.env.VITEST = "1";
delete process.env.DATABASE_URL;

const password = "taller-seguro";

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("equipo — invitaciones, roles y bajas", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ dataDir: null });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("operador crea registros y cobra, sin editar ni consultar costos", async () => {
    const owner = client(app, await onboard(app, "owner@operator.test", "OPE010101AAA", "Operador"));
    const invited = await owner.post("/invitations", { email: "desk@operator.test", role: "operator" });
    expect(invited.status).toBe(201);
    const joined = await request(app.getHttpServer()).post("/api/v1/invitations/accept").send({ token: tokenFrom(invited.body.acceptPath), password });
    expect(joined.status).toBe(201);
    const operator = client(app, joined.body.token);
    const product = await owner.post("/products", { sku: "OP-1", name: "Pieza", productType: "resale", cost: "10.00", salePrice: "100.00" });
    expect(product.status).toBe(201);
    const filament = await owner.post("/filaments", { sku: "OP-PLA", name: "PLA", material: "PLA", color: "Negro", diameterMm: "1.75", cost: "300.00", salePrice: "1.00" });
    expect(filament.status).toBe(201);
    const service = await owner.post("/services", { code: "OP-SRV", name: "Servicio", unit: "servicio", cost: "10.00", salePrice: "100.00" });
    expect(service.status).toBe(201);
    for (const catalog of ["products", "filaments", "services"]) {
      const list = await operator.get(`/${catalog}`);
      expect(list.status).toBe(200);
      expect(list.body.data[0].cost).toBeNull();
      expect(list.body.data[0].salePrice).not.toBeNull();
      const detail = await operator.get(`/${catalog}/${list.body.data[0].id}`);
      expect(detail.body.cost).toBeNull();
      expect((await operator.patch(`/${catalog}/${list.body.data[0].id}`, {})).status).toBe(403);
      expect((await operator.delete(`/${catalog}/${list.body.data[0].id}`)).status).toBe(403);
    }
    const customer = await operator.post("/customers", { kind: "b2c", legalName: "Cliente mostrador", paymentTerms: "pue", fiscal: { line1: "Mostrador", neighborhood: "Centro", postalCode: "64000", state: "Nuevo León" } });
    expect(customer.status).toBe(201);
    const lines = [{ productId: product.body.id, description: "Pieza", quantity: "1", unitPrice: "100.00" }];
    const quote = await operator.post("/quotes", { mode: "products", customerId: customer.body.id, lines });
    expect(quote.status).toBe(201);
    expect((await operator.get(`/quotes/${quote.body.id}`)).body.costing).toBeNull();
    expect((await operator.get(`/quotes/${quote.body.id}/pdf`)).status).toBe(200);
    expect((await operator.get(`/quotes/${quote.body.id}/pdf/taller`)).status).toBe(403);
    const order = await operator.post("/orders", { customerId: customer.body.id, lines });
    expect(order.status).toBe(201);
    for (const path of [`/customers/${customer.body.id}`, `/quotes/${quote.body.id}`, `/orders/${order.body.id}`]) {
      expect((await operator.patch(path, {})).status).toBe(403);

    }
    for (const path of [`/quotes/${quote.body.id}/transition`, `/quotes/${quote.body.id}/clone`, `/quotes/${quote.body.id}/convert`, `/orders/${order.body.id}/confirm`, `/orders/${order.body.id}/cancel`]) {
      expect((await operator.post(path, {})).status).toBe(403);
    }
    expect((await owner.post(`/orders/${order.body.id}/submit`, {})).status).toBe(201);
    expect((await owner.post(`/orders/${order.body.id}/confirm`, {})).status).toBe(201);
    const payment = await operator.post("/payments", { orderId: order.body.id, method: "efectivo", amount: "50.00" });
    expect(payment.status).toBe(201);
    expect((await operator.get(`/orders/${order.body.id}`)).body.paymentStatus).toBe("partial");
    const actor = await services().auth.verify(joined.body.token);
    await expect(services().database.asUser(actor, (db) => db.execute(sql`update public.sales_orders set notes = 'Edición prohibida' where id = ${order.body.id}::uuid`))).rejects.toThrow();
    await expect(services().database.asUser(actor, (db) => db.execute(sql`update public.sales_orders set payment_status = 'paid' where id = ${order.body.id}::uuid`))).rejects.toThrow();
    await services().database.asUser(actor, (db) => db.execute(sql`update public.quotes set status = 'void' where id = ${quote.body.id}::uuid`));
    expect((await operator.get(`/quotes/${quote.body.id}`)).body.status).toBe("draft");
    await services().database.asUser(actor, (db) => db.execute(sql`update public.payments set amount_minor = 1 where id = ${payment.body.id}::uuid`));
    expect((await operator.get("/payments")).body.data[0].amount).toBe("50.00");
    expect((await operator.post("/payments", { orderId: order.body.id, method: "efectivo", amount: "10.00", kind: "refund" })).status).toBe(403);
    expect((await operator.post(`/payments/${payment.body.id}/complete`, {})).status).toBe(403);
    const prefactura = await operator.post("/prefacturas", { salesOrderId: order.body.id });
    expect(prefactura.status, JSON.stringify(prefactura.body)).toBe(201);
    expect((await operator.get(`/prefacturas/${prefactura.body.id}`)).status).toBe(200);
    expect((await operator.post(`/prefacturas/${prefactura.body.id}/void`, { reason: "No autorizado" })).status).toBe(403);
    await services().database.asUser(actor, (db) => db.execute(sql`update public.commercial_documents set total_minor = 1 where id = ${prefactura.body.id}::uuid`));
    expect((await operator.get(`/prefacturas/${prefactura.body.id}`)).body.total).not.toBe("0.01");
    const location = (await operator.get("/locations")).body[0].id;
    expect((await operator.post("/inventory/movements", { productId: product.body.id, locationId: location, kind: "receipt", quantity: "5", reason: "Entrada operador" })).status).toBe(201);
    expect((await operator.post(`/inventory/filaments/${filament.body.id}/adjust`, { mode: "count", grams: "1000" })).status).toBe(201);
    const spools = await operator.post("/spools", { filamentId: filament.body.id, grams: "1000", addToStock: false });
    expect(spools.status).toBe(201);
    const made = await owner.post("/products", { sku: "OP-FAB", name: "Fabricado", productType: "finished_good", cost: "10.00", salePrice: "100.00" });
    expect(made.status).toBe(201);
    const recipe = await owner.post("/boms", { productId: made.body.id, lines: [{ componentProductId: product.body.id, quantity: "1", scrapPct: "0" }] });
    expect(recipe.status, JSON.stringify(recipe.body)).toBe(201);
    const readRecipe = await operator.get(`/boms/${made.body.id}`);
    expect(readRecipe.status).toBe(200);
    expect(readRecipe.body.materialCost).toBeNull();
    expect(readRecipe.body.lines[0].extendedCost).toBeNull();
    expect((await operator.post("/boms", {})).status).toBe(403);
    const linked = await operator.post("/orders", { customerId: customer.body.id, lines: [{ productId: made.body.id, description: "Fabricado", quantity: "1", unitPrice: "100.00" }] });
    expect(linked.status).toBe(201);
    expect((await owner.post(`/orders/${linked.body.id}/submit`, {})).status).toBe(201);
    const linkedLine = (await owner.get(`/orders/${linked.body.id}`)).body.lines[0].id;
    for (const resolution of ["in_progress", "delivered"]) expect((await owner.post(`/orders/${linked.body.id}/lines/${linkedLine}/resolution`, { resolution })).status).toBe(201);
    expect((await owner.post(`/orders/${linked.body.id}/confirm`, {})).status).toBe(201);
    const production = await operator.post(`/production-orders/from-sales-order/${linked.body.id}`, {});
    expect(production.status, JSON.stringify(production.body)).toBe(201);
    const productionId = production.body.data[0].id;
    expect((await operator.get(`/orders/${linked.body.id}`)).body.status).toBe("in_production");
    expect((await operator.post(`/production-orders/${productionId}/release`, {})).status).toBe(201);
    const completed = await operator.post(`/production-orders/${productionId}/complete`, { quantityGood: "1" });
    expect(completed.status, JSON.stringify(completed.body)).toBe(201);
    expect(completed.body.actualCost).toBeNull();
    if (completed.body.status === "qc_hold") {
      const inspected = await operator.post(`/production-orders/${productionId}/inspections`, { result: "pass", qtyPassed: "1", qtyFailed: "0" });
      expect(inspected.status, JSON.stringify(inspected.body)).toBe(201);
    }
    expect((await operator.get(`/orders/${linked.body.id}`)).body.status).toBe("ready_to_ship");
    expect((await operator.post(`/production-orders/${productionId}/close`, {})).status).toBe(201);
    expect((await operator.post(`/production-orders/${productionId}/waive-qc`, { reason: "No autorizado" })).status).toBe(403);
    for (const path of ["/inventory", "/inventory/ledger", "/boms", "/production-orders", "/quality/settings", "/prefacturas"]) expect((await operator.get(path)).status).toBe(200);
    for (const path of ["/dashboard", "/team", "/expenses", "/exports/accountant"]) expect((await operator.get(path)).status).toBe(403);
  });

  it("restringe consultas y escrituras por módulo para cada rol", async () => {
    const owner = client(app, await onboard(app, "roles@accesos.test", "ACC010101AAA", "Accesos"));
    const cases = [
      { role: "sales", allowed: ["customers", "quotes", "orders", "payments", "products", "filaments"], denied: ["inventory", "expenses", "production-orders", "team", "dashboard"] },
      { role: "production", allowed: ["production-orders", "boms", "inventory", "products", "filaments"], denied: ["customers", "quotes", "orders", "payments", "expenses", "team", "dashboard"] },
      { role: "warehouse", allowed: ["inventory", "expenses", "purchase-orders", "orders", "products"], denied: ["customers", "quotes", "payments", "production-orders", "team", "dashboard"] },
      { role: "viewer", allowed: ["customers", "orders", "inventory", "expenses", "production-orders", "dashboard"], denied: ["team"] },
      { role: "admin", allowed: ["customers", "orders", "inventory", "expenses", "production-orders", "team", "dashboard"], denied: [] },
    ];
    for (const test of cases) {
      const invite = await owner.post("/invitations", { email: `${test.role}@accesos.test`, role: test.role });
      expect(invite.status).toBe(201);
      const joined = await request(app.getHttpServer()).post("/api/v1/invitations/accept").send({ token: tokenFrom(invite.body.acceptPath), password });
      expect(joined.status).toBe(201);
      const actor = client(app, joined.body.token);
      for (const path of test.allowed) expect((await actor.get(`/${path}`)).status, `${test.role}: ${path}`).toBe(200);
      for (const path of test.denied) {
        expect((await actor.get(`/${path}`)).status, `${test.role}: ${path}`).toBe(403);
        const writes: Record<string, string> = { inventory: "inventory/movements", customers: "customers", quotes: "quotes", orders: "orders", payments: "payments", expenses: "expenses", "production-orders": "production-orders" };
        if (writes[path]) expect((await actor.post(`/${writes[path]}`, {})).status, `${test.role}: POST ${path}`).toBe(403);
      }
      if (test.role === "production") expect((await actor.get("/CuStOmErS")).status).toBe(403);
      if (test.role === "viewer") expect((await actor.post("/products", {})).status).toBe(403);
    }
  });

  it("invita, muestra la invitación, cambia roles en caliente y da de baja", async () => {
    const owner = client(app, await onboard(app, "duena@taller-luz.test", "TLU010101AAA", "Taller Luz"));

    const invited = await owner.post("/invitations", { email: "Admin@Taller-Luz.test", role: "admin" });
    expect(invited.status).toBe(201);
    const adminToken = tokenFrom(invited.body.acceptPath);
    const preview = await request(app.getHttpServer()).get(`/api/v1/invitations/preview/${adminToken}`);
    expect(preview.body).toMatchObject({ email: "admin@taller-luz.test", role: "admin", roleLabel: "Administrador", workshop: "Taller Luz" });

    const joined = await request(app.getHttpServer()).post("/api/v1/invitations/accept").send({ token: adminToken, password });
    expect(joined.status).toBe(201);
    expect(joined.body.user.role).toBe("admin");
    const admin = client(app, joined.body.token);
    const reused = await request(app.getHttpServer()).get(`/api/v1/invitations/preview/${adminToken}`);
    expect(reused.status).toBe(400);

    const again = await owner.post("/invitations", { email: "admin@taller-luz.test", role: "sales" });
    expect(again.status).toBe(409);
    expect(code(again)).toBe("member_exists");

    const noPromotion = await admin.post("/invitations", { email: "otro@taller-luz.test", role: "admin" });
    expect(noPromotion.status).toBe(403);

    const first = await admin.post("/invitations", { email: "piso@taller-luz.test", role: "production" });
    const second = await admin.post("/invitations", { email: "piso@taller-luz.test", role: "warehouse" });
    expect(second.status).toBe(201);
    const stale = await request(app.getHttpServer()).get(`/api/v1/invitations/preview/${tokenFrom(first.body.acceptPath)}`);
    expect(stale.status).toBe(400);
    const team = await admin.get("/team");
    expect(team.body.assignableRoles).toEqual(["sales", "operator", "production", "warehouse", "viewer"]);
    expect(team.body.invitations).toHaveLength(1);
    const pending = team.body.invitations[0];
    expect(pending).toMatchObject({ email: "piso@taller-luz.test", role: "warehouse", expired: false, manageable: true });

    const renewed = await admin.post(`/invitations/${pending.id}/renew`, {});
    expect(renewed.status).toBe(201);
    const oldLink = await request(app.getHttpServer()).get(`/api/v1/invitations/preview/${tokenFrom(second.body.acceptPath)}`);
    expect(oldLink.status).toBe(400);
    const floor = await request(app.getHttpServer())
      .post("/api/v1/invitations/accept")
      .send({ token: tokenFrom(renewed.body.acceptPath), password });
    expect(floor.status).toBe(201);
    const worker = client(app, floor.body.token);
    const workerId = floor.body.user.id as string;

    const asWarehouse = await worker.post("/filaments", { sku: "PLA-NEG", name: "PLA negro", material: "PLA", color: "Negro", diameterMm: "1.75", cost: "300.00" });
    expect(asWarehouse.status).toBe(201);

    const demoted = await admin.patch(`/team/members/${workerId}`, { role: "viewer" });
    expect(demoted.status).toBe(200);
    const asViewer = await worker.post("/filaments", { sku: "PLA-ROJ", name: "PLA rojo", material: "PLA", color: "Rojo", diameterMm: "1.75", cost: "300.00" });
    expect(asViewer.status).toBe(403);
    const me = await worker.get("/auth/me");
    expect(me.body.user.role).toBe("viewer");
    expect((await worker.get("/team")).status).toBe(403);
    expect((await worker.post("/invitations", { email: "x@taller-luz.test", role: "viewer" })).status).toBe(403);

    const ownerId = (await owner.get("/auth/me")).body.user.id as string;
    const touchOwner = await admin.patch(`/team/members/${ownerId}`, { role: "viewer" });
    expect(touchOwner.status).toBe(403);
    const adminId = joined.body.user.id as string;
    expect((await admin.patch(`/team/members/${adminId}`, { role: "sales" })).status).toBe(403);
    expect((await owner.patch(`/team/members/${adminId}`, { role: "sales" })).status).toBe(200);
    expect((await admin.get("/team")).status).toBe(403);

    const removed = await owner.delete(`/team/members/${workerId}`);
    expect(removed.status).toBe(200);
    const afterRemoval = await worker.get("/filaments");
    expect(afterRemoval.status).toBe(409);
    expect((await worker.get("/auth/me")).body.user.tenantId).toBeNull();

    const revocable = await owner.post("/invitations", { email: "temporal@taller-luz.test", role: "viewer" });
    const listed = (await owner.get("/team")).body.invitations.find((item: { email: string }) => item.email === "temporal@taller-luz.test");
    expect((await owner.delete(`/invitations/${listed.id}`)).status).toBe(200);
    const revoked = await request(app.getHttpServer()).get(`/api/v1/invitations/preview/${tokenFrom(revocable.body.acceptPath)}`);
    expect(revoked.status).toBe(400);
  });

  it("no deja que alguien de otro taller acepte ni que se invite a un correo ocupado", async () => {
    const one = client(app, await onboard(app, "uno@taller-uno.test", "TUN010101AAA", "Taller Uno"));
    await onboard(app, "dos@taller-dos.test", "TDO010101AAA", "Taller Dos");
    const busy = await one.post("/invitations", { email: "dos@taller-dos.test", role: "sales" });
    expect(busy.status).toBe(409);
    expect(code(busy)).toBe("member_elsewhere");
  });
});

function code(response: { body: { code?: string; error?: { code?: string } } }) {
  return response.body.error?.code ?? response.body.code;
}

function tokenFrom(path: string) {
  return path.split("/").at(-1) as string;
}

function client(app: INestApplication, token: string) {
  const server = () => app.getHttpServer();
  return {
    get: (path: string) => request(server()).get(`/api/v1${path}`).set(bearer(token)),
    post: (path: string, body: unknown) => request(server()).post(`/api/v1${path}`).set(bearer(token)).set("Idempotency-Key", crypto.randomUUID()).send(body as object),
    patch: (path: string, body: unknown) => request(server()).patch(`/api/v1${path}`).set(bearer(token)).send(body as object),
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
