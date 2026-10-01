import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/main";

process.env.PLATFORM_ADMIN_EMAILS = "soporte@printmty.test";
process.env.VITEST = "1";
delete process.env.DATABASE_URL;

const password = "taller-seguro";

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("operación — inventario y ventas", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ dataDir: null });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("recibe material, cotiza, confirma y cobra sin ver el otro taller", async () => {
    const owner = await register(app, "iris@taller-iris.test");
    const onboard = await request(app.getHttpServer())
      .post("/api/v1/onboarding")
      .set(bearer(owner.token))
      .send(workshop("TIR010101AAA", "Taller Iris", true));
    expect(onboard.status).toBe(201);
    const token = onboard.body.token as string;

    const other = await register(app, "luz@taller-luz.test");
    const onboardOther = await request(app.getHttpServer())
      .post("/api/v1/onboarding")
      .set(bearer(other.token))
      .send(workshop("TLZ010101AAA", "Taller Luz", false));
    const tokenOther = onboardOther.body.token as string;

    const products = await request(app.getHttpServer()).get("/api/v1/filaments").set(bearer(token));
    const locations = await request(app.getHttpServer()).get("/api/v1/locations").set(bearer(token));
    const productId = products.body.data[0].id as string;
    const locationId = locations.body[0].id as string;

    const receipt = await request(app.getHttpServer())
      .post("/api/v1/inventory/movements")
      .set(bearer(token))
      .send({ productId, locationId, kind: "receipt", quantity: "500", reason: "Rollo nuevo", reorderPoint: "200" });
    expect(receipt.status).toBe(201);
    const stock = await request(app.getHttpServer()).get("/api/v1/inventory/balances").set(bearer(token));
    expect(stock.body.data[0].onHand).toBe("500");
    const finished = await request(app.getHttpServer()).post("/api/v1/products").set(bearer(token)).send({
      sku: "TERM-1",
      name: "Llavero terminado",
      productType: "finished_good",
      cost: "10.00",
    });
    const resale = await request(app.getHttpServer()).post("/api/v1/products").set(bearer(token)).send({
      sku: "REV-1",
      name: "Pegamento",
      productType: "resale",
      cost: "5.00",
    });
    expect(finished.status).toBe(201);
    expect(resale.status).toBe(201);
    const inventory = await request(app.getHttpServer()).get("/api/v1/inventory").set(bearer(token));
    expect(inventory.status).toBe(200);
    expect(inventory.body.finished.map((row: { sku: string; onHand: string }) => [row.sku, row.onHand])).toContainEqual(["TERM-1", "0"]);
    expect(inventory.body.resale.map((row: { sku: string }) => row.sku)).toContain("REV-1");
    expect(inventory.body.filaments.find((row: { id: string }) => row.id === productId)).toMatchObject({ onHand: "500", available: "500", stockUom: "g" });
    expect((await request(app.getHttpServer()).get("/api/v1/inventory").set(bearer(tokenOther))).body.filaments).toEqual([]);
    expect(stock.body.data[0].available).toBe("500");
    expect(stock.body.data[0].lowStock).toBe(false);

    const hidden = await request(app.getHttpServer()).get("/api/v1/inventory/balances").set(bearer(tokenOther));
    expect(hidden.body.data).toEqual([]);

    const customer = await request(app.getHttpServer())
      .post("/api/v1/customers")
      .set(bearer(token))
      .send({
        kind: "b2b",
        legalName: "Cliente Norte SA",
        rfc: "CNO010101AAA",
        phone: "8112345678",
        paymentTerms: "net_30",
        creditLimit: "100.00",
        fiscal: { line1: "Av. 1", neighborhood: "Centro", postalCode: "64000", state: "Nuevo León" },
      });
    expect(customer.status).toBe(201);

    const quote = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set(bearer(token))
      .send({
        mode: "prints",
        customerId: customer.body.id,
        prints: [{
          name: "Pieza de muestra",
          quantity: "1",
          filaments: [{ productId, description: "PLA negro", quantity: "1", unitPrice: "480.00" }],
        }],
      });
    expect(quote.status).toBe(201);
    expect(quote.body.folio).toBe("COT-1");
    expect(quote.body.vat).toBe("76.80");
    expect(quote.body.total).toBe("556.80");

    const sent = await request(app.getHttpServer())
      .post(`/api/v1/quotes/${quote.body.id}/transition`)
      .set(bearer(token))
      .send({ to: "sent" });
    expect(sent.status).toBe(201);
    const accepted = await request(app.getHttpServer())
      .post(`/api/v1/quotes/${quote.body.id}/transition`)
      .set(bearer(token))
      .send({ to: "accepted" });
    expect(accepted.status).toBe(201);
    const converted = await request(app.getHttpServer())
      .post(`/api/v1/quotes/${quote.body.id}/convert`)
      .set(bearer(token));
    expect(converted.status).toBe(201);
    expect(converted.body.status).toBe("pending");

    const sample = await request(app.getHttpServer()).get(`/api/v1/orders/${converted.body.id}`).set(bearer(token));
    const samplePrint = sample.body.prints[0].id as string;
    for (const resolution of ["in_progress", "delivered"]) {
      const marked = await request(app.getHttpServer())
        .post(`/api/v1/orders/${converted.body.id}/prints/${samplePrint}/resolution`)
        .set(bearer(token))
        .send({ resolution });
      expect(marked.status).toBe(201);
    }

    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/orders/${converted.body.id}/confirm`)
      .set(bearer(token))
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("credit_limit");

    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/orders/${converted.body.id}/confirm`)
      .set(bearer(token))
      .send({ creditOverrideReason: "Pedido de muestra autorizado" });
    expect(confirmed.status).toBe(201);

    const held = await request(app.getHttpServer()).get("/api/v1/inventory/balances").set(bearer(token));
    expect(held.body.data[0].onHand).toBe("500");
    expect(held.body.data[0].available).toBe("500");

    const partial = await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set(bearer(token))
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ orderId: converted.body.id, method: "efectivo", amount: "200.00" });
    expect(partial.status).toBe(201);
    const orders = await request(app.getHttpServer()).get("/api/v1/orders").set(bearer(token));
    expect(orders.body.data[0].paymentStatus).toBe("partial");
    expect(orders.body.data[0].amountDue).toBe("356.80");

    const otherOrders = await request(app.getHttpServer()).get("/api/v1/orders").set(bearer(tokenOther));
    expect(otherOrders.body.data).toEqual([]);

    const rest = await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set(bearer(token))
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ orderId: converted.body.id, method: "spei", amount: "356.80", reference: "SPEI-99" });
    expect(rest.status).toBe(201);
    const paid = await request(app.getHttpServer()).get("/api/v1/orders").set(bearer(token));
    expect(paid.body.data[0].paymentStatus).toBe("paid");
    expect(paid.body.data[0].amountDue).toBe("0.00");
  });

  it("mezcla productos y servicios en una cotización y resuelve el servicio antes de embarcar", async () => {
    const owner = await register(app, "nora@taller-nora.test");
    const onboard = await request(app.getHttpServer())
      .post("/api/v1/onboarding")
      .set(bearer(owner.token))
      .send(workshop("TNO010101AAA", "Taller Nora", true));
    const token = onboard.body.token as string;
    const products = await request(app.getHttpServer()).get("/api/v1/filaments").set(bearer(token));
    const locations = await request(app.getHttpServer()).get("/api/v1/locations").set(bearer(token));
    const productId = products.body.data[0].id as string;
    const locationId = locations.body[0].id as string;
    await request(app.getHttpServer())
      .post("/api/v1/inventory/movements")
      .set(bearer(token))
      .send({ productId, locationId, kind: "receipt", quantity: "2", reason: "Existencia para el pedido" });

    const supply = { sku: "ins-tor-m3", name: "Tornillo M3", productType: "component", cost: "1.50" };
    const supplyRow = await request(app.getHttpServer()).post("/api/v1/products").set(bearer(token)).send(supply);
    expect(supplyRow.status).toBe(201);
    const filamentClash = await request(app.getHttpServer())
      .post("/api/v1/filaments")
      .set(bearer(token))
      .send({ sku: "INS-TOR-M3", name: "PLA rojo", material: "PLA", color: "Rojo", diameterMm: "1.75" });
    expect(filamentClash.status).toBe(409);
    expect(filamentClash.body.message).toBe("Ese SKU ya lo usa el insumo «Tornillo M3».");
    const renameClash = await request(app.getHttpServer()).patch(`/api/v1/filaments/${productId}`).set(bearer(token)).send({ sku: "ins-tor-m3" });
    expect(renameClash.status).toBe(409);
    const filamentSku = products.body.data[0].sku as string;
    const productClash = await request(app.getHttpServer()).patch(`/api/v1/products/${supplyRow.body.id}`).set(bearer(token)).send({ sku: filamentSku });
    expect(productClash.status).toBe(409);
    expect(productClash.body.message).toContain("Ese SKU ya lo usa el filamento");
    const renamed = await request(app.getHttpServer()).patch(`/api/v1/products/${supplyRow.body.id}`).set(bearer(token)).send({ sku: "ins-tor-m3-inox" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.sku).toBe("INS-TOR-M3-INOX");
    const renamedBack = await request(app.getHttpServer()).patch(`/api/v1/products/${supplyRow.body.id}`).set(bearer(token)).send({ sku: "INS-TOR-M3" });
    expect(renamedBack.status).toBe(200);
    const clash = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set(bearer(token))
      .send({ ...supply, name: "Llavero", productType: "finished_good", salePrice: "50.00" });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toBe("Ese SKU ya lo usa el insumo «Tornillo M3».");

    const service = await request(app.getHttpServer()).post("/api/v1/services").set(bearer(token)).send({
      code: "DIS-01",
      name: "Diseño de pieza",
      unit: "servicio",
      salePrice: "200.00",
      terms: "Incluye dos revisiones.",
    });
    expect(service.status).toBe(201);

    const byMinute = await request(app.getHttpServer()).post("/api/v1/services").set(bearer(token)).send({
      code: "POST-01",
      name: "Postproceso",
      unit: "minuto",
      salePrice: "5.00",
    });
    expect(byMinute.status).toBe(201);
    expect(byMinute.body.unit).toBe("minuto");

    const customer = await request(app.getHttpServer()).post("/api/v1/customers").set(bearer(token)).send({
      kind: "b2c",
      legalName: "Ana Ruiz",
      phone: "8187654321",
      paymentTerms: "pue",
      fiscal: { line1: "Calle 2", neighborhood: "Centro", postalCode: "64000", state: "Nuevo León" },
    });
    const quote = await request(app.getHttpServer()).post("/api/v1/quotes").set(bearer(token)).send({
      mode: "prints",
      customerId: customer.body.id,
      serviceTerms: "Entrega en cinco días hábiles.",
      depositPercent: 50,
      leadTimeDays: 5,
      paymentNotes: "Transferencia bancaria",
      prints: [{
        name: "Llavero",
        quantity: "2",
        filaments: [{ productId, description: "PLA negro", quantity: "1", unitPrice: "480.00" }],
        services: [{ serviceId: service.body.id, description: "Diseño de pieza", quantity: "1", unitPrice: "200.00" }],
      }],
    });
    expect(quote.status).toBe(201);
    expect(quote.body.subtotal).toBe("1360.00");
    expect(quote.body.vat).toBe("217.60");
    expect(quote.body.total).toBe("1577.60");
    expect(quote.body.paymentTerms).toBe("pue");
    expect(quote.body.deposit).toBe("788.80");
    expect(quote.body.balance).toBe("788.80");
    const detail = await request(app.getHttpServer()).get(`/api/v1/quotes/${quote.body.id}`).set(bearer(token));
    expect(detail.body.prints).toHaveLength(1);
    expect(detail.body.prints[0].quantity).toBe("2");
    expect(detail.body.prints[0].lines.map((line: { lineKind: string; quantity: string; uom: string }) => [line.lineKind, line.quantity, line.uom])).toEqual([
      ["filament", "2", "g"],
      ["service", "2", "servicio"],
    ]);
    expect(detail.body.prints[0].lines[1].unitPrice).toBe("200.00");
    expect(detail.body.prints[0].lines[1].net).toBe("400.00");
    expect(detail.body.prints[0].lines[1].vat).toBe("64.00");
    expect(detail.body.prints[0].lines[1].total).toBe("464.00");
    expect(detail.body.prints[0].unitTotal).toBe("680.00");
    expect(detail.body.issuer.rfc).toBe("TNO010101AAA");
    expect(detail.body.discount).toBe("0.00");
    expect(detail.body.prints[0].lines[1].terms).toBe("Incluye dos revisiones.");
    const pdf = await request(app.getHttpServer()).get(`/api/v1/quotes/${quote.body.id}/pdf`).set(bearer(token));
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    const raw = Buffer.isBuffer(pdf.body) ? pdf.body.toString("latin1") : String(pdf.body ?? "");
    expect(raw.startsWith("%PDF")).toBe(true);
    expect(raw).toContain("servicio");
    expect(raw).toContain("Subtotal");
    expect(raw).toContain("importe por pieza");
    expect(raw).toContain("Anticipo 50%");
    expect(raw).toContain("Transferencia bancaria");
    expect(detail.body.serviceTerms).toBe("Entrega en cinco días hábiles.");
    expect(detail.body.leadTimeDays).toBe(5);

    await request(app.getHttpServer()).post(`/api/v1/quotes/${quote.body.id}/transition`).set(bearer(token)).send({ to: "sent" });
    await request(app.getHttpServer()).post(`/api/v1/quotes/${quote.body.id}/transition`).set(bearer(token)).send({ to: "accepted" });
    const converted = await request(app.getHttpServer()).post(`/api/v1/quotes/${quote.body.id}/convert`).set(bearer(token));
    expect(converted.status).toBe(201);
    expect(converted.body.depositPercent).toBe(50);
    expect(converted.body.paymentNotes).toBe("Transferencia bancaria");
    expect(converted.body.promisedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const orderId = converted.body.id as string;
    const pending = await request(app.getHttpServer()).get(`/api/v1/orders/${orderId}`).set(bearer(token));
    const serviceLine = pending.body.lines.find((line: { lineKind: string }) => line.lineKind === "service");
    expect(pending.body.prints).toHaveLength(1);
    const printId = pending.body.prints[0].id as string;

    const notPrestado = await request(app.getHttpServer()).post(`/api/v1/orders/${orderId}/confirm`).set(bearer(token)).send({});
    expect(notPrestado.status).toBe(409);
    expect(notPrestado.body.code).toBe("order_action_blocked");

    const onLine = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/lines/${serviceLine.id}/resolution`)
      .set(bearer(token))
      .send({ resolution: "in_progress" });
    expect(onLine.status).toBe(409);

    const started = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prints/${printId}/resolution`)
      .set(bearer(token))
      .send({ resolution: "in_progress" });
    expect(started.status).toBe(201);
    const done = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/prints/${printId}/resolution`)
      .set(bearer(token))
      .send({ resolution: "delivered", note: "Llavero entregado" });
    expect(done.body.prints[0].resolution).toBe("delivered");

    const confirmed = await request(app.getHttpServer()).post(`/api/v1/orders/${orderId}/confirm`).set(bearer(token)).send({});
    expect(confirmed.status).toBe(201);
    const opened = await request(app.getHttpServer()).get(`/api/v1/orders/${orderId}`).set(bearer(token));
    expect(opened.body.serviceTerms).toBe("Entrega en cinco días hábiles.");
    expect(opened.body.status).toBe("ready_to_ship");
    expect(opened.body.supply).toMatchObject({ printsOpen: false, filamentShort: false, productToMake: false, productToBuy: false });
    const notMade = await request(app.getHttpServer())
      .post(`/api/v1/production-orders/from-sales-order/${orderId}`)
      .set(bearer(token))
      .send({});
    expect(notMade.status).toBe(409);
    expect(notMade.body.code).toBe("order_action_blocked");
    const demand = await request(app.getHttpServer()).get("/api/v1/production-orders/sales-demand").set(bearer(token));
    expect(demand.status).toBe(200);
    expect(demand.body.data.find((row: { id: string }) => row.id === orderId)).toBeUndefined();

    const shipped = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/ship`)
      .set(bearer(token))
      .set("idempotency-key", "emb-listo")
      .send({ carrier: "Local" });
    expect(shipped.status).toBe(201);
    expect(shipped.body.status).toBe("shipped");
  });
});

async function register(app: INestApplication, email: string) {
  const response = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email, password });
  expect(response.status).toBe(201);
  return response.body as { token: string };
}

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
