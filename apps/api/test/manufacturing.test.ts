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

describe("operación — compras, manufactura, calidad y prefacturas", () => {
  let app: INestApplication;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    app = await createApp({ dataDir: null });
    api = client(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("compra filamento, fabrica un pedido con calidad y lo prefactura", async () => {
    const owner = await onboard(app, "rosa@taller-rosa.test", "TRO010101AAA", "Taller Rosa");
    const other = await onboard(app, "sol@taller-sol.test", "TSO010101AAA", "Taller Sol");
    const centers = await api.get(owner, "/work-centers");
    expect(centers.body.data.map((row: { code: string }) => row.code)).toEqual(["EMP", "IMP", "POST", "QC"]);
    const printer = centers.body.data.find((row: { code: string }) => row.code === "IMP");

    const pla = await api.post(owner, "/filaments", {
      sku: "FIL-PLA-ROJ",
      name: "PLA rojo 1.75 mm",
      material: "PLA",
      color: "Rojo",
      diameterMm: "1.75",
      cost: "250.00",
    });
    expect(pla.status).toBe(201);
    expect(pla.body.stockUom).toBe("G");
    const keychain = await api.post(owner, "/products", {
      sku: "LLAV-01",
      name: "Llavero logo",
      productType: "finished_good",
      salePrice: "150.00",
    });
    expect(keychain.body.qcRigor).toBe("basic");
    const stand = await api.post(owner, "/products", { sku: "EXH-01", name: "Exhibidor", productType: "finished_good" });

    const bom = await api.post(owner, "/boms", {
      productId: keychain.body.id,
      lines: [{ componentProductId: pla.body.id, quantity: "120", scrapPct: "5" }],
    });
    expect(bom.status).toBe(201);
    expect(bom.body.lines[0].requiredPerUnit).toBe("126");
    expect(bom.body.materialCost).toBe("31.50");

    const standBom = await api.post(owner, "/boms", {
      productId: stand.body.id,
      lines: [{ componentProductId: keychain.body.id, quantity: "4" }],
    });
    expect(standBom.status).toBe(201);
    const cycle = await api.post(owner, "/boms", {
      productId: keychain.body.id,
      lines: [{ componentProductId: stand.body.id, quantity: "1" }],
    });
    expect(cycle.status).toBe(409);
    expect(cycle.body.code).toBe("bom_cycle");

    const routing = await api.post(owner, "/routings", {
      productId: keychain.body.id,
      operations: [{ sequence: 10, code: "PRINT", name: "Impresión", workCenterId: printer.id, runMinutes: "30" }],
    });
    expect(routing.status).toBe(201);
    expect(routing.body.laborPerUnit).toBe("17.50");

    const gate = await api.patch(owner, "/quality/settings", { qcGate: "block" });
    expect(gate.body.qcGate).toBe("block");

    const customer = await api.post(owner, "/customers", {
      kind: "b2b",
      legalName: "Regalos del Norte SA de CV",
      rfc: "RNO010101AAA",
      paymentTerms: "pue",
      taxRegime: "601",
      cfdiUse: "G01",
      fiscal: { line1: "Av. Constitución 100", neighborhood: "Centro", postalCode: "64000", state: "Nuevo León" },
    });
    expect(customer.status).toBe(201);
    const order = await api.post(owner, "/orders", {
      customerId: customer.body.id,
      lines: [{ productId: keychain.body.id, description: "Llavero logo", quantity: "2", unitPrice: "150.00" }],
    });
    expect(order.body.total).toBe("348.00");
    await api.post(owner, `/orders/${order.body.id}/submit`, {});
    const keychainLine = (await api.get(owner, `/orders/${order.body.id}`)).body.lines[0].id as string;
    const notPrestado = await api.post(owner, `/orders/${order.body.id}/confirm`, {
      creditOverrideReason: "Pago contra entrega autorizado",
    });
    expect(notPrestado.status).toBe(409);
    expect(notPrestado.body.code).toBe("order_action_blocked");
    await api.post(owner, `/orders/${order.body.id}/lines/${keychainLine}/resolution`, { resolution: "in_progress" });
    const prestado = await api.post(owner, `/orders/${order.body.id}/lines/${keychainLine}/resolution`, { resolution: "delivered" });
    expect(prestado.status).toBe(201);
    const confirmed = await api.post(owner, `/orders/${order.body.id}/confirm`, {
      creditOverrideReason: "Pago contra entrega autorizado",
    });
    expect(confirmed.status).toBe(201);

    const vendor = await api.post(owner, "/vendors", { name: "Filamentos del Norte", leadTimeDays: 3 });
    const po = await api.post(owner, "/purchase-orders", {
      vendorId: vendor.body.id,
      lines: [{ productId: pla.body.id, quantity: "1", unitCost: "250.00" }],
    });
    expect(po.status).toBe(201);
    expect(po.body.folio).toBe("OC-1");
    expect(po.body.total).toBe("290.00");
    const ordered = await api.post(owner, `/purchase-orders/${po.body.id}/transition`, { to: "ordered" });
    expect(ordered.body.status).toBe("ordered");

    const lineId = po.body.lines[0].id as string;
    const receipt = await api.post(
      owner,
      `/purchase-orders/${po.body.id}/receive`,
      { lines: [{ lineId, quantity: "1", vendorLot: "FN-2026-09" }] },
      { "Idempotency-Key": "recepcion-oc-1" },
    );
    expect(receipt.status).toBe(201);
    expect(receipt.body.receipt.folio).toBe("REC-1");
    expect(receipt.body.purchaseOrder.status).toBe("received");
    const replay = await api.post(
      owner,
      `/purchase-orders/${po.body.id}/receive`,
      { lines: [{ lineId, quantity: "1", vendorLot: "FN-2026-09" }] },
      { "Idempotency-Key": "recepcion-oc-1" },
    );
    expect(replay.body.receipt.folio).toBe("REC-1");
    expect(await plaBalance(owner, pla.body.id)).toMatchObject({ onHand: "1000", allocated: "0" });
    const lots = await api.get(owner, "/lots");
    expect(lots.body.data[0]).toMatchObject({ lotNumber: "REC-1-1", vendorLot: "FN-2026-09", receivedQty: "1000" });

    const demand = await api.get(owner, "/production-orders/sales-demand");
    expect(demand.status).toBe(200);
    expect(demand.body.data.map((row: { id: string }) => row.id)).toContain(order.body.id);
    const made = await api.post(owner, `/production-orders/from-sales-order/${order.body.id}`, {});
    expect(made.status).toBe(201);
    expect(made.body.data).toHaveLength(1);
    const opId = made.body.data[0].id as string;
    expect(made.body.data[0]).toMatchObject({ folio: "OP-1", quantityOrdered: "2", estimatedCost: "98.00" });
    const orderAfter = await api.get(owner, "/orders");
    expect(orderAfter.body.data[0].status).toBe("in_production");

    const floor = await invite(app, owner, "piso@taller-rosa.test", "production");
    const released = await api.post(floor, `/production-orders/${opId}/release`, {});
    expect(released.status).toBe(201);
    expect(released.body.shortages).toEqual([]);
    expect(released.body.materials[0]).toMatchObject({ required: "252", allocated: "0", shortage: "0", tracksStock: false });
    expect(await plaBalance(owner, pla.body.id)).toMatchObject({ onHand: "1000", allocated: "0", available: "1000" });
    const noPrefacturas = await api.get(floor, "/prefacturas");
    expect(noPrefacturas.status).toBe(403);

    const materialId = released.body.materials[0].id as string;
    const consumed = await api.post(floor, `/production-orders/${opId}/consume`, {
      materialId,
      quantity: "200",
    });
    expect(consumed.status).toBe(201);
    expect(consumed.body.status).toBe("in_progress");
    expect(consumed.body.materials[0]).toMatchObject({ consumed: "200", allocated: "0" });

    const completed = await api.post(floor, `/production-orders/${opId}/complete`, { quantityGood: "2" });
    expect(completed.status).toBe(201);
    expect(completed.body).toMatchObject({ status: "qc_hold", qcStatus: "pending", actualCost: "98.00" });
    expect(completed.body.materials[0]).toMatchObject({ consumed: "252", allocated: "0" });
    expect(await plaBalance(owner, pla.body.id)).toMatchObject({ onHand: "1000", allocated: "0" });

    const blocked = await api.post(floor, `/production-orders/${opId}/inspections`, {
      result: "fail",
      qtyPassed: "1",
      qtyFailed: "1",
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("qc_blocked");
    const passed = await api.post(floor, `/production-orders/${opId}/inspections`, { result: "pass", qtyPassed: "2" });
    expect(passed.status).toBe(201);
    expect(passed.body).toMatchObject({ status: "completed", qcStatus: "passed", quantityCompleted: "2" });
    const balances = await api.get(owner, "/inventory/balances");
    expect(balances.body.data.find((row: { sku: string }) => row.sku === "LLAV-01").onHand).toBe("2");

    const closed = await api.post(owner, `/production-orders/${opId}/close`, {});
    expect(closed.body.status).toBe("closed");
    const ready = await api.get(owner, "/orders");
    expect(ready.body.data[0].status).toBe("ready_to_ship");

    const prefactura = await api.post(owner, "/prefacturas", { salesOrderId: order.body.id }, { "Idempotency-Key": "pf-ped-1" });
    expect(prefactura.status).toBe(201);
    expect(prefactura.body).toMatchObject({ number: "A-1", total: "348.00", incomplete: false, status: "issued" });
    expect(prefactura.body.title).toContain("no es un CFDI");
    const again = await api.post(owner, "/prefacturas", { salesOrderId: order.body.id }, { "Idempotency-Key": "pf-ped-1" });
    expect(again.body.id).toBe(prefactura.body.id);
    const duplicate = await api.post(owner, "/prefacturas", { salesOrderId: order.body.id });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("prefactura_exists");

    const paid = await api.post(owner, "/payments", { orderId: order.body.id, method: "spei", amount: "348.00", reference: "SPEI-7788" });
    expect(paid.status).toBe(201);
    const detail = await api.get(owner, `/prefacturas/${prefactura.body.id}`);
    expect(detail.body).toMatchObject({ amountDue: "0.00", satPaymentTiming: "PUE", orderFolio: order.body.folio });

    const today = new Date().toISOString().slice(0, 10);
    const pack = await api.get(owner, `/exports/accountant?from=2026-01-01&to=${today}&format=json`);
    expect(pack.status).toBe(200);
    expect(pack.body).toMatchObject({ version: "accountant_package_v1", countryCode: "MX" });
    expect(pack.body.documents).toHaveLength(1);
    expect(pack.body.payments).toHaveLength(1);
    expect(pack.body.totals.total).toBe("348.00");
    const zip = await request(app.getHttpServer())
      .get(`/api/v1/exports/accountant?from=2026-01-01&to=${today}&format=zip`)
      .set(bearer(owner))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(zip.status).toBe(200);
    expect(zip.headers["content-type"]).toContain("application/zip");
    const archive = zip.body as Buffer;
    expect(archive.subarray(0, 2).toString()).toBe("PK");
    expect(archive.includes(Buffer.from("prefacturas.csv"))).toBe(true);
    expect(archive.includes(Buffer.from("no son CFDI"))).toBe(true);

    const voided = await api.post(owner, `/prefacturas/${prefactura.body.id}/void`, { reason: "Cambio de razón social" });
    expect(voided.body.status).toBe("void");
    const reissued = await api.post(owner, "/prefacturas", { salesOrderId: order.body.id });
    expect(reissued.body.number).toBe("A-2");

    expect((await api.get(other, "/production-orders")).body.data).toEqual([]);
    expect((await api.get(other, "/prefacturas")).body.data).toEqual([]);
    const spent = await api.post(owner, "/expenses", {
      kind: "filament",
      itemId: pla.body.id,
      quantity: "1",
      amount: "180.00",
      occurredOn: "2026-09-01",
      paidAmount: "180.00",
      paidOn: "2026-09-01",
    });
    expect(spent.status).toBe(201);
    expect(spent.body.folio).toMatch(/^GAS-/);
    expect(await plaBalance(owner, pla.body.id)).toMatchObject({ onHand: "2000" });
    const utility = await api.post(owner, "/expenses", {
      kind: "service",
      description: "Luz del taller",
      amount: "900.00",
      occurredOn: "2026-09-01",
      paidAmount: "300.00",
      paidOn: "2026-09-15",
    });
    expect(utility.status).toBe(201);
    expect(utility.body).toMatchObject({
      kind: "service",
      description: "Luz del taller",
      occurredOn: "2026-09-01",
      amount: "900.00",
      paid: "300.00",
      balance: "600.00",
      paymentStatus: "partial",
    });
    const rest = await api.post(owner, `/expenses/${utility.body.id}/payments`, { amount: "600.00", paidOn: "2026-10-01" });
    expect(rest.status).toBe(201);
    const loaded = await api.get(owner, `/expenses/${utility.body.id}`);
    expect(loaded.body.paymentStatus).toBe("paid");
    expect(loaded.body.payments).toHaveLength(2);
    const rent = await api.post(owner, "/expenses", { kind: "other", description: "Renta de local", amount: "12000.00", occurredOn: "2026-09-01" });
    expect(rent.status).toBe(201);
    expect((await api.get(owner, "/expenses")).body.data).toHaveLength(3);
    expect((await api.get(other, "/expenses")).body.data).toEqual([]);
    expect((await api.get(other, "/purchase-orders")).body.data).toEqual([]);
    expect((await api.get(other, `/production-orders/${opId}`)).status).toBe(404);

    const dashboard = await api.get(owner, "/dashboard");
    expect(dashboard.body.operations).toMatchObject({ qcHold: 0, productionOpen: 0, prefacturasThisMonth: 1 });
  });

  it("fabrica sin existencia de filamento, pero no sin insumos", async () => {
    const owner = await onboard(app, "mar@taller-mar.test", "TMA010101AAA", "Taller Mar");
    const floor = await invite(app, owner, "piso@taller-mar.test", "production");
    const petg = await api.post(owner, "/filaments", {
      sku: "FIL-PETG-NEG",
      name: "PETG negro 1.75 mm",
      material: "PETG",
      color: "Negro",
      diameterMm: "1.75",
      cost: "300.00",
    });
    const magnet = await api.post(owner, "/products", { sku: "INS-IMAN", name: "Imán 10 mm", productType: "component", cost: "2.00" });
    const plain = await api.post(owner, "/products", { sku: "POR-01", name: "Portallaves liso", productType: "finished_good", salePrice: "90.00" });
    const magnetic = await api.post(owner, "/products", { sku: "POR-02", name: "Portallaves con imán", productType: "finished_good", salePrice: "120.00" });
    await api.post(owner, "/boms", { productId: plain.body.id, lines: [{ componentProductId: petg.body.id, quantity: "50" }] });
    await api.post(owner, "/boms", {
      productId: magnetic.body.id,
      lines: [
        { componentProductId: petg.body.id, quantity: "50" },
        { componentProductId: magnet.body.id, quantity: "2" },
      ],
    });

    const op = await api.post(owner, "/production-orders", { productId: plain.body.id, quantity: "3" });
    expect(op.status).toBe(201);
    const released = await api.post(floor, `/production-orders/${op.body.id}/release`, {});
    expect(released.body.shortages).toEqual([]);
    expect(released.body.materials[0]).toMatchObject({ required: "150", allocated: "0", shortage: "0", tracksStock: false });
    const done = await api.post(floor, `/production-orders/${op.body.id}/complete`, { quantityGood: "3" });
    expect(done.status).toBe(201);
    expect(done.body.actualCost).toBe("45.00");
    expect(done.body.materials[0]).toMatchObject({ consumed: "150" });
    expect((await plaBalance(owner, petg.body.id))?.onHand ?? "0").toBe("0");
    if (done.body.status === "qc_hold") {
      const approved = await api.post(floor, `/production-orders/${op.body.id}/inspections`, { result: "pass", qtyPassed: "3" });
      expect(approved.status).toBe(201);
    }
    const ledger = await api.get(owner, `/inventory/ledger?section=products&productId=${plain.body.id}`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.data).toHaveLength(1);
    expect(ledger.body.data[0]).toMatchObject({
      kind: "receipt",
      direction: "in",
      quantity: "3",
      sku: "POR-01",
      production: { id: op.body.id, folio: op.body.folio },
      salesOrder: null,
      purchase: null,
    });
    expect((await api.get(owner, "/inventory/ledger?section=supplies")).body.data).toEqual([]);

    const short = await api.post(owner, "/production-orders", { productId: magnetic.body.id, quantity: "1" });
    const shortReleased = await api.post(floor, `/production-orders/${short.body.id}/release`, {});
    expect(shortReleased.body.shortages).toEqual([{ productId: magnet.body.id, sku: "INS-IMAN", short: "2" }]);
    const blocked = await api.post(floor, `/production-orders/${short.body.id}/complete`, { quantityGood: "1" });
    expect(blocked.status).toBe(409);

    const supplyRecipe = await api.post(owner, "/boms", { productId: magnet.body.id, lines: [{ componentProductId: petg.body.id, quantity: "5" }] });
    expect(supplyRecipe.status).toBe(409);
    expect(supplyRecipe.body.code).toBe("not_manufacturable");
    const supplyOrder = await api.post(owner, "/production-orders", { productId: magnet.body.id, quantity: "10" });
    expect(supplyOrder.status).toBe(409);
    expect(supplyOrder.body.message).toBe("Solo se fabrican productos terminados. Los insumos se compran.");

    const retired = await api.patch(owner, `/products/${plain.body.id}`, { status: "inactive" });
    expect(retired.status).toBe(200);
    const inactive = await api.post(owner, "/production-orders", { productId: plain.body.id, quantity: "1" });
    expect(inactive.status).toBe(409);
    expect(inactive.body).toMatchObject({ code: "product_inactive", message: "«Portallaves liso» está inactivo. Actívalo en el catálogo para fabricarlo." });
  });

  async function plaBalance(token: string, productId: string) {
    const balances = await api.get(token, "/inventory/balances");
    return balances.body.data.find((row: { productId: string }) => row.productId === productId);
  }
});

function client(app: INestApplication) {
  const server = () => app.getHttpServer();
  return {
    get: (token: string, path: string) => request(server()).get(`/api/v1${path}`).set(bearer(token)),
    post: (token: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
      request(server()).post(`/api/v1${path}`).set(bearer(token)).set({ "Idempotency-Key": crypto.randomUUID(), ...headers }).send(body as object),
    patch: (token: string, path: string, body: unknown) =>
      request(server()).patch(`/api/v1${path}`).set(bearer(token)).send(body as object),
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
      paymentMethods: {
        efectivo: true,
        spei: true,
        tarjeta: false,
        mercadopago: false,
        conekta: false,
        stripe: false,
        cod: false,
        credito: false,
      },
      seedDemo: false,
      privacyAccepted: true,
    });
  expect(response.status).toBe(201);
  return response.body.token as string;
}

async function invite(app: INestApplication, owner: string, email: string, role: string): Promise<string> {
  const created = await request(app.getHttpServer()).post("/api/v1/invitations").set(bearer(owner)).send({ email, role });
  expect(created.status).toBe(201);
  const token = created.body.acceptPath.split("/").at(-1);
  const accepted = await request(app.getHttpServer()).post("/api/v1/invitations/accept").send({ token, password });
  expect(accepted.status).toBe(201);
  return accepted.body.token as string;
}
