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

  it("establece la vigencia en días, la conserva al editar y renueva el plazo al duplicar", async () => {
    const account = await register(app, "vigencia@cotizaciones.test");
    const onboard = await request(app.getHttpServer()).post("/api/v1/onboarding").set(bearer(account.token)).send(workshop("VIG010101AAA", "Vigencia", false));
    const token = onboard.body.token as string;
    const post = (path: string, body: unknown) => request(app.getHttpServer()).post(`/api/v1${path}`).set(bearer(token)).send(body as object);
    const customer = await post("/customers", { kind: "b2c", legalName: "Cliente vigencia", fiscal: { state: "Jalisco" } });
    const product = await post("/products", { sku: "VIG-P", name: "Producto", productType: "resale", cost: "10", salePrice: "100" });
    const body = { mode: "products", customerId: customer.body.id, lines: [{ productId: product.body.id, description: "Producto", quantity: "1", unitPrice: "100" }] };
    const created = await post("/quotes", { ...body, validityDays: 7 });
    expect(created.status).toBe(201);
    expect(created.body.validityDays).toBe(7);
    expect(new Date(created.body.validUntil).getTime() - new Date(created.body.createdAt).getTime()).toBe(7 * 86_400_000);
    const changed = await request(app.getHttpServer()).patch(`/api/v1/quotes/${created.body.id}`).set(bearer(token)).send({ ...body, serviceTerms: "Nueva nota" });
    expect(changed.status).toBe(200);
    expect(changed.body.validUntil).toBe(created.body.validUntil);
    const changedDays = await request(app.getHttpServer()).patch(`/api/v1/quotes/${created.body.id}`).set(bearer(token)).send({ ...body, validityDays: 14 });
    expect(changedDays.status).toBe(200);
    expect(new Date(changedDays.body.validUntil).getTime() - new Date(created.body.createdAt).getTime()).toBe(14 * 86_400_000);
    const copy = await post(`/quotes/${created.body.id}/clone`, {});
    expect(copy.status).toBe(201);
    expect(copy.body.validityDays).toBe(14);
    expect(new Date(copy.body.validUntil).getTime() - new Date(copy.body.createdAt).getTime()).toBe(14 * 86_400_000);
    const pdf = await request(app.getHttpServer()).get(`/api/v1/quotes/${created.body.id}/pdf`).set(bearer(token));
    expect(pdf.status).toBe(200);
    expect(pdf.body.toString("latin1")).toContain(new Date(changedDays.body.validUntil).toLocaleDateString("es-MX"));
    expect((await post("/quotes", body)).body.validityDays).toBe(30);
    for (const validityDays of [0, -1, 1.5, 366]) expect((await post("/quotes", { ...body, validityDays })).status).toBe(400);
  });

  it("conserva impuestos independientes de productos y servicios en edición, copia, PDF y conversión", async () => {
    const account = await register(app, "partidas@cotizaciones.test");
    const onboard = await request(app.getHttpServer()).post("/api/v1/onboarding").set(bearer(account.token)).send(workshop("LTX010101AAA", "Partidas", false));
    const token = onboard.body.token as string;
    const post = (path: string, body: unknown) => request(app.getHttpServer()).post(`/api/v1${path}`).set(bearer(token)).send(body as object);
    const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set(bearer(token));
    const customer = await post("/customers", { kind: "b2c", legalName: "Cliente partidas", fiscal: { state: "Jalisco" } });
    const product = await post("/products", { sku: "MIX", name: "Producto", productType: "resale", cost: "20", salePrice: "100" });
    const service = await post("/services", { code: "EXENTO", name: "Servicio exento", unit: "servicio", cost: "10", salePrice: "100" });
    const body = { mode: "products", customerId: customer.body.id, lines: [
      { serviceId: service.body.id, description: "Servicio exento", quantity: "1", unitPrice: "100", vatExempt: true, isrRate: "0" },
      { productId: product.body.id, description: "Producto", quantity: "1", unitPrice: "100", discount: "10", vatRate: "0.16", isrRate: "0.0125" },
      { productId: product.body.id, description: "Tasa cero", quantity: "1", unitPrice: "100", vatRate: "0", isrRate: "0" },
    ] };
    const preview = await post("/tax/preview", { rate: "0.16", lines: body.lines });
    expect(preview.status).toBe(201);
    expect(preview.body).toMatchObject({ tax: "14.40", isrWithheld: "1.13", total: "303.27" });
    const quote = await post("/quotes", body);
    expect(quote.status).toBe(201);
    const expected = { vat: "14.40", isrWithheld: "1.13", total: "303.27" };
    expect(quote.body).toMatchObject(expected);
    const detail = (await get(`/quotes/${quote.body.id}`)).body;
    expect(detail.lines[0]).toMatchObject({ vatExempt: true, vat: "0.00", isrWithheld: "0.00" });
    expect(detail.lines[1]).toMatchObject({ vatRate: "0.160000", isrRate: "0.012500", isrWithheld: "1.13" });
    expect(detail.lines[2]).toMatchObject({ vatExempt: false, vatRate: "0.000000" });
    const legacyLines = body.lines.map(({ vatRate, vatExempt, isrRate, ...line }) => line);
    const edited = await request(app.getHttpServer()).patch(`/api/v1/quotes/${quote.body.id}`).set(bearer(token)).send({ ...body, lines: legacyLines });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject(expected);
    const copy = await post(`/quotes/${quote.body.id}/clone`, {});
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject(expected);
    const pdf = await get(`/quotes/${quote.body.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.body.toString("latin1")).toContain("IVA exento");
    expect(pdf.body.toString("latin1")).toContain("ISR 1.25%");
    for (const field of ["vatRate", "isrRate"]) expect((await post("/quotes", { ...body, lines: [{ ...body.lines[1], [field]: "1.01" }] })).status).toBe(400);
    await post(`/quotes/${quote.body.id}/transition`, { to: "sent" });
    await post(`/quotes/${quote.body.id}/transition`, { to: "accepted" });
    const converted = await post(`/quotes/${quote.body.id}/convert`, {});
    expect(converted.status).toBe(201);
    const order = (await get(`/orders/${converted.body.id}`)).body;
    expect(order).toMatchObject({ ...expected, amountDue: "303.27" });
    expect(order.lines.map((line: { vatRate: string; vatExempt: boolean; isrRate: string }) => [line.vatRate, line.vatExempt, line.isrRate])).toEqual(detail.lines.map((line: { vatRate: string; vatExempt: boolean; isrRate: string }) => [line.vatRate, line.vatExempt, line.isrRate]));
    const editedOrder = await request(app.getHttpServer()).put(`/api/v1/orders/${order.id}/lines`).set(bearer(token)).send({ lines: legacyLines });
    expect(editedOrder.status).toBe(200);
    expect(editedOrder.body).toMatchObject(expected);
    const orderPdf = await get(`/orders/${order.id}/pdf`);
    expect(orderPdf.status).toBe(200);
    expect(orderPdf.body.toString("latin1")).toContain("IVA exento");
  });

  it("configura ISR por taller y conserva tasas de cotización, copia, PDF, pedido y saldo", async () => {
    const account = await register(app, "isr@cotizaciones.test");
    const onboard = await request(app.getHttpServer()).post("/api/v1/onboarding").set(bearer(account.token)).send(workshop("ISR010101AAA", "ISR", false));
    const token = onboard.body.token as string;
    const post = (path: string, body: unknown) => request(app.getHttpServer()).post(`/api/v1${path}`).set(bearer(token)).send(body as object);
    const patch = (path: string, body: unknown) => request(app.getHttpServer()).patch(`/api/v1${path}`).set(bearer(token)).send(body as object);
    const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set(bearer(token));
    const profile = (await get("/company")).body;
    expect(profile.isrRate).toBe("0.000000");
    const preview = await post("/tax/preview", { lines: [{ description: "Vista previa", quantity: "1", unitPrice: "100.00" }], rate: "0.16", isrRate: "0.0125" });
    expect(preview.status).toBe(201);
    expect(preview.body).toMatchObject({ isrWithheld: "1.25", total: "114.75" });
    expect((await patch("/company", { ...profile, vatRate: "0.16", isrRate: "0.0125" })).status).toBe(200);
    const customer = await post("/customers", { kind: "b2b", legalName: "Cliente ISR", rfc: "CIS010101AAA", fiscal: { state: "Jalisco" } });
    const product = await post("/products", { sku: "ISR-P", name: "Producto", productType: "resale", cost: "20.00", salePrice: "1000.00" });
    const body = { mode: "products", customerId: customer.body.id, lines: [{ productId: product.body.id, description: "Producto", quantity: "1", unitPrice: "1000.00", discount: "100.00" }] };
    const inherited = await post("/quotes", body);
    expect(inherited.status).toBe(201);
    expect(inherited.body).toMatchObject({ vatRate: "0.160000", isrRate: "0.012500", isrWithheld: "11.25", total: "1032.75" });
    const quote = await post("/quotes", { ...body, vatRate: "0.08", isrRate: "0.1" });
    expect(quote.body).toMatchObject({ isrWithheld: "90.00", vat: "72.00", total: "882.00" });
    expect((await patch("/company", { ...profile, vatRate: "0", isrRate: "0" })).status).toBe(200);
    expect((await get(`/quotes/${quote.body.id}`)).body).toMatchObject({ vatRate: "0.080000", isrRate: "0.100000", total: "882.00" });
    const edited = await patch(`/quotes/${quote.body.id}`, { ...body, lines: [{ ...body.lines[0], quantity: "2", discount: "200.00" }] });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ vatRate: "0.080000", isrRate: "0.100000", isrWithheld: "180.00", total: "1764.00" });
    const copy = await post(`/quotes/${quote.body.id}/clone`, {});
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ isrRate: "0.100000", total: "1764.00" });
    const pdf = await get(`/quotes/${quote.body.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.body.toString("latin1")).toContain("ISR 10%");
    await post(`/quotes/${quote.body.id}/transition`, { to: "sent" });
    await post(`/quotes/${quote.body.id}/transition`, { to: "accepted" });
    const converted = await post(`/quotes/${quote.body.id}/convert`, {});
    expect(converted.status).toBe(201);
    expect((await get(`/orders/${converted.body.id}`)).body).toMatchObject({ vatRate: "0.080000", isrRate: "0.100000", isrWithheld: "180.00", total: "1764.00", amountDue: "1764.00" });
    const orderPdf = await get(`/orders/${converted.body.id}/pdf`);
    expect(orderPdf.status).toBe(200);
    expect(orderPdf.body.toString("latin1")).toContain("ISR 10%");
    const repricedOrder = await request(app.getHttpServer()).put(`/api/v1/orders/${converted.body.id}/lines`).set(bearer(token)).send( { lines: [{ productId: product.body.id, description: "Producto", quantity: "2", unitPrice: "500.00", discount: "200.00" }] });
    expect(repricedOrder.status).toBe(200);
    expect(repricedOrder.body).toMatchObject({ vatRate: "0.080000", isrRate: "0.100000", isrWithheld: "80.00", total: "784.00", amountDue: "784.00" });
    for (const isrRate of ["-0.1", "1.01", "NaN"]) expect((await post("/quotes", { ...body, isrRate })).status).toBe(400);
    expect((await post("/quotes", { ...body, vatRate: "-0.16" })).status).toBe(400);
  });

  it("cotiza con descuentos por partida, calcula IVA sobre el neto y los conserva al editar y convertir", async () => {
    const account = await register(app, "descuentos@cotizaciones.test");
    const onboard = await request(app.getHttpServer()).post("/api/v1/onboarding").set(bearer(account.token)).send(workshop("DCT010101AAA", "Descuentos", false));
    const token = onboard.body.token as string;
    const post = (path: string, body: unknown) => request(app.getHttpServer()).post(`/api/v1${path}`).set(bearer(token)).send(body as object);
    const customer = await post("/customers", { kind: "b2c", legalName: "Cliente descuentos", fiscal: { state: "Jalisco" } });
    const product = await post("/products", { sku: "DESC-P", name: "Producto", productType: "resale", cost: "20.00", salePrice: "100.00" });
    const quoteBody = { mode: "products", customerId: customer.body.id, lines: [{ productId: product.body.id, description: "Producto", quantity: "2", unitPrice: "100.00", discount: "25.00" }] };
    const quote = await post("/quotes", quoteBody);
    expect(quote.status).toBe(201);
    expect(quote.body).toMatchObject({ discount: "25.00", vat: "28.00", total: "203.00" });
    const edited = await request(app.getHttpServer()).patch(`/api/v1/quotes/${quote.body.id}`).set(bearer(token))
      .send({ ...quoteBody, lines: [{ ...quoteBody.lines[0], discount: "50.00" }] });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ discount: "50.00", vat: "24.00", total: "174.00" });
    const detail = await request(app.getHttpServer()).get(`/api/v1/quotes/${quote.body.id}`).set(bearer(token));
    expect(detail.body.lines[0]).toMatchObject({ discount: "50.00", net: "150.00" });
    const pdf = await request(app.getHttpServer()).get(`/api/v1/quotes/${quote.body.id}/pdf`).set(bearer(token));
    expect(pdf.status).toBe(200);
    expect(pdf.body.toString("latin1")).toContain("50.00");
    for (const discount of ["-1.00", "200.01"]) expect((await post("/quotes", { ...quoteBody, lines: [{ ...quoteBody.lines[0], discount }] })).status).toBe(400);
    await post(`/quotes/${quote.body.id}/transition`, { to: "sent" });
    await post(`/quotes/${quote.body.id}/transition`, { to: "accepted" });
    const converted = await post(`/quotes/${quote.body.id}/convert`, {});
    expect(converted.status).toBe(201);
    expect(converted.body).toMatchObject({ discount: "50.00", total: "174.00" });
    const filament = await post("/filaments", { sku: "DESC-F", name: "PLA", material: "PLA", color: "Azul", diameterMm: "1.75", cost: "200.00", salePrice: "1.00" });
    const service = await post("/services", { code: "DESC-S", name: "Servicio", unit: "servicio", cost: "5.00", salePrice: "50.00" });
    const print = await post("/quotes", { mode: "prints", customerId: customer.body.id, prints: [{ name: "Tres piezas", quantity: "3",
      filaments: [{ productId: filament.body.id, description: "PLA", quantity: "100", unitPrice: "1.00", discount: "30.00" }],
      services: [{ serviceId: service.body.id, description: "Servicio", quantity: "1", unitPrice: "50.00", discount: "15.00" }],
    }] });
    expect(print.status).toBe(201);
    expect(print.body).toMatchObject({ discount: "45.00", vat: "64.80", total: "469.80" });
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

  it("separa inventario e historial por abastecimiento y comparte los artículos mixtos", async () => {
    const owner = await register(app, "inventario@clasificacion.test");
    const onboard = await request(app.getHttpServer()).post("/api/v1/onboarding")
      .set(bearer(owner.token)).send(workshop("TIN010101AAA", "Inventario clasificado", false));
    expect(onboard.status).toBe(201);
    const token = onboard.body.token as string;
    const locations = await request(app.getHttpServer()).get("/api/v1/locations").set(bearer(token));
    const locationId = locations.body[0].id as string;
    for (const [sku, itemClass, supplyMode] of [
      ["MAKE", "finished_good", "make"], ["BUY", "finished_good", "buy"],
      ["BOTH", "finished_good", "both"], ["SUP", "component", "buy"],
    ]) {
      const product = await request(app.getHttpServer()).post("/api/v1/products").set(bearer(token))
        .send({ sku, name: `Artículo ${sku}`, itemClass, supplyMode, cost: "1.00" });
      expect(product.status).toBe(201);
      const movement = await request(app.getHttpServer()).post("/api/v1/inventory/movements").set(bearer(token))
        .send({ productId: product.body.id, locationId, kind: "receipt", quantity: "7", reason: "Existencia de prueba" });
      expect(movement.status).toBe(201);
    }
    const inventory = await request(app.getHttpServer()).get("/api/v1/inventory").set(bearer(token));
    expect(inventory.status).toBe(200);
    expect(inventory.body.finished.map((row: { sku: string }) => row.sku)).toEqual(["BOTH", "MAKE"]);
    expect(inventory.body.resale.map((row: { sku: string }) => row.sku)).toEqual(["BOTH", "BUY"]);
    expect(inventory.body.supplies.map((row: { sku: string }) => row.sku)).toEqual(["SUP"]);
    const mixed = inventory.body.finished.find((row: { sku: string }) => row.sku === "BOTH");
    expect(mixed).toMatchObject({ itemClass: "finished_good", supplyMode: "both", onHand: "7", available: "7" });
    expect(inventory.body.resale.find((row: { sku: string }) => row.sku === "BOTH")).toEqual(mixed);
    for (const [section, expected] of [["finished", ["BOTH", "MAKE"]], ["resale", ["BOTH", "BUY"]], ["supplies", ["SUP"]]] as const) {
      const ledger = await request(app.getHttpServer()).get(`/api/v1/inventory/ledger?section=${section}`).set(bearer(token));
      expect(ledger.status).toBe(200);
      expect(ledger.body.data.map((row: { sku: string }) => row.sku).sort()).toEqual(expected);
    }
    const latest = await request(app.getHttpServer()).get("/api/v1/inventory/ledger?section=finished&limit=1").set(bearer(token));
    expect(latest.body.data.map((row: { sku: string }) => row.sku)).toEqual(["BOTH"]);
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
    expect(notPrestado.status).toBe(201);

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

    const confirmed = await request(app.getHttpServer()).get(`/api/v1/orders/${orderId}`).set(bearer(token));
    expect(confirmed.status).toBe(200);
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
