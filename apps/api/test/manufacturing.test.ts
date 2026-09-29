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

  it("compra filamento en rollos, fabrica un pedido con calidad y lo prefactura", async () => {
    const owner = await onboard(app, "rosa@taller-rosa.test", "TRO010101AAA", "Taller Rosa");
    const other = await onboard(app, "sol@taller-sol.test", "TSO010101AAA", "Taller Sol");
    const locationId = (await api.get(owner, "/locations")).body[0].id as string;

    const centers = await api.get(owner, "/work-centers");
    expect(centers.body.data.map((row: { code: string }) => row.code)).toEqual(["EMP", "IMP", "POST", "QC"]);
    const printer = centers.body.data.find((row: { code: string }) => row.code === "IMP");

    const pla = await api.post(owner, "/products", {
      sku: "FIL-PLA-ROJ",
      name: "PLA rojo 1.75 mm",
      productType: "raw_material",
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
    const stand = await api.post(owner, "/products", { sku: "EXH-01", name: "Exhibidor", productType: "component" });

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
    const confirmed = await api.post(owner, `/orders/${order.body.id}/confirm`, {
      creditOverrideReason: "Pago contra entrega autorizado",
    });
    expect(confirmed.status).toBe(201);

    const buyList = await api.get(owner, "/mrp/requirements?kind=buy");
    expect(buyList.body.data).toHaveLength(1);
    expect(buyList.body.data[0].sku).toBe("FIL-PLA-ROJ");
    expect(buyList.body.data[0].netShortage).toBe("252");
    expect(buyList.body.data[0].purchaseQuantity).toBe("0.252");

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
    const covered = await api.get(owner, "/mrp/requirements?kind=buy");
    expect(covered.body.data.filter((row: { netShortage: string }) => row.netShortage !== "0")).toEqual([]);

    const lineId = po.body.lines[0].id as string;
    const mismatch = await api.post(owner, `/purchase-orders/${po.body.id}/receive`, {
      lines: [{ lineId, quantity: "1", spoolWeights: ["600", "300"] }],
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.code).toBe("spool_weights_mismatch");
    const receipt = await api.post(
      owner,
      `/purchase-orders/${po.body.id}/receive`,
      { lines: [{ lineId, quantity: "1", vendorLot: "FN-2026-09", spoolWeights: ["600", "400"] }] },
      { "Idempotency-Key": "recepcion-oc-1" },
    );
    expect(receipt.status).toBe(201);
    expect(receipt.body.receipt.folio).toBe("REC-1");
    expect(receipt.body.spools.map((spool: { spoolNumber: string }) => spool.spoolNumber)).toEqual(["R-1", "R-2"]);
    expect(receipt.body.purchaseOrder.status).toBe("received");
    const replay = await api.post(
      owner,
      `/purchase-orders/${po.body.id}/receive`,
      { lines: [{ lineId, quantity: "1", vendorLot: "FN-2026-09", spoolWeights: ["600", "400"] }] },
      { "Idempotency-Key": "recepcion-oc-1" },
    );
    expect(replay.body.receipt.folio).toBe("REC-1");
    expect(await plaBalance(owner, pla.body.id)).toMatchObject({ onHand: "1000", allocated: "0" });
    const lots = await api.get(owner, "/lots");
    expect(lots.body.data[0]).toMatchObject({ lotNumber: "REC-1-1", vendorLot: "FN-2026-09", receivedQty: "1000" });

    const made = await api.post(owner, `/production-orders/from-sales-order/${order.body.id}`, {});
    expect(made.status).toBe(201);
    expect(made.body.data).toHaveLength(1);
    const opId = made.body.data[0].id as string;
    expect(made.body.data[0]).toMatchObject({ folio: "OP-1", quantityOrdered: "2", estimatedCost: "98.00" });
    const orderAfter = await api.get(owner, "/orders");
    expect(orderAfter.body.data[0].status).toBe("in_production");

    const mrp = await api.post(owner, "/mrp/run", { horizonDays: 30 });
    expect(mrp.status).toBe(201);
    const finished = mrp.body.rows.find((row: { sku: string }) => row.sku === "LLAV-01");
    expect(finished).toMatchObject({ grossDemand: "2", scheduledOutput: "2", netShortage: "0" });
    const material = mrp.body.rows.find((row: { sku: string }) => row.sku === "FIL-PLA-ROJ");
    expect(material).toMatchObject({ grossDemand: "252", onHand: "1000", netShortage: "0" });
    expect(mrp.body.planned).toEqual([]);

    const floor = await invite(app, owner, "piso@taller-rosa.test", "production");
    const released = await api.post(floor, `/production-orders/${opId}/release`, {});
    expect(released.status).toBe(201);
    expect(released.body.shortages).toEqual([]);
    expect(released.body.materials[0]).toMatchObject({ required: "252", allocated: "252" });
    expect(await plaBalance(owner, pla.body.id)).toMatchObject({ onHand: "1000", allocated: "252", available: "748" });
    const noPrefacturas = await api.get(floor, "/prefacturas");
    expect(noPrefacturas.status).toBe(403);

    const spools = await api.get(floor, "/spools");
    const first = spools.body.data.find((spool: { spoolNumber: string }) => spool.spoolNumber === "R-1");
    const materialId = released.body.materials[0].id as string;
    const consumed = await api.post(floor, `/production-orders/${opId}/consume`, {
      materialId,
      quantity: "200",
      spoolId: first.id,
    });
    expect(consumed.status).toBe(201);
    expect(consumed.body.status).toBe("in_progress");
    expect(consumed.body.materials[0]).toMatchObject({ consumed: "200", allocated: "52" });
    const tooMuch = await api.post(floor, `/production-orders/${opId}/consume`, {
      materialId,
      quantity: "500",
      spoolId: first.id,
    });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.code).toBe("spool_insufficient");
    const spool = await api.get(floor, `/spools/${first.id}`);
    expect(spool.body).toMatchObject({ currentGrams: "400", status: "in_use" });

    const completed = await api.post(floor, `/production-orders/${opId}/complete`, { quantityGood: "2" });
    expect(completed.status).toBe(201);
    expect(completed.body).toMatchObject({ status: "qc_hold", qcStatus: "pending", actualCost: "98.00" });
    expect(completed.body.materials[0]).toMatchObject({ consumed: "252", allocated: "0" });
    expect(await plaBalance(owner, pla.body.id)).toMatchObject({ onHand: "748", allocated: "0" });

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
    expect((await api.get(other, "/spools")).body.data).toEqual([]);
    expect((await api.get(other, "/prefacturas")).body.data).toEqual([]);
    expect((await api.get(other, "/purchase-orders")).body.data).toEqual([]);
    expect((await api.get(other, `/production-orders/${opId}`)).status).toBe(404);
    expect((await api.get(other, "/mrp/requirements")).body.data).toEqual([]);

    const preview = await api.post(owner, "/cycle-counts", {
      locationId,
      reference: "Conteo semanal",
      dryRun: true,
      lines: [{ productId: pla.body.id, countedQty: "740" }],
    });
    expect(preview.status).toBe(201);
    expect(preview.body).toMatchObject({ dryRun: true, adjustments: 1, varianceValue: "-2.00", folio: null });
    expect(await plaBalance(owner, pla.body.id)).toMatchObject({ onHand: "748" });
    const count = await api.post(owner, "/cycle-counts", {
      locationId,
      reference: "Conteo semanal",
      lines: [{ productId: pla.body.id, countedQty: "740", reason: "Purga de boquilla" }],
    });
    expect(count.body.folio).toBe("CC-1");
    expect(await plaBalance(owner, pla.body.id)).toMatchObject({ onHand: "740" });

    const dashboard = await api.get(owner, "/dashboard");
    expect(dashboard.body.operations).toMatchObject({ spoolsActive: 2, qcHold: 0, productionOpen: 0, prefacturasThisMonth: 1 });
  });

  it("MRP planea fabricar y comprar sin contar dos veces, y libera las órdenes", async () => {
    const owner = await onboard(app, "vera@taller-vera.test", "TVE010101AAA", "Taller Vera");
    const petg = await api.post(owner, "/products", {
      sku: "FIL-PETG",
      name: "PETG negro",
      productType: "raw_material",
      material: "PETG",
      cost: "300.00",
    });
    const part = await api.post(owner, "/products", { sku: "PIEZA-1", name: "Pieza", productType: "finished_good", salePrice: "90.00" });
    await api.post(owner, "/boms", { productId: part.body.id, lines: [{ componentProductId: petg.body.id, quantity: "50" }] });
    const customer = await api.post(owner, "/customers", {
      kind: "b2c",
      legalName: "Ana Pérez",
      paymentTerms: "pue",
      fiscal: { line1: "Calle 1", neighborhood: "Centro", postalCode: "44100", state: "Jalisco" },
    });
    const order = await api.post(owner, "/orders", {
      customerId: customer.body.id,
      lines: [{ productId: part.body.id, description: "Pieza", quantity: "10", unitPrice: "90.00" }],
    });
    await api.post(owner, `/orders/${order.body.id}/submit`, {});
    await api.post(owner, `/orders/${order.body.id}/confirm`, { creditOverrideReason: "Anticipo" });

    const run = await api.post(owner, "/mrp/run", {});
    const planned = run.body.planned as Array<{ id: string; sku: string; kind: string; quantity: string; purchaseQuantity: string | null }>;
    expect(planned.map((row) => [row.sku, row.kind, row.quantity]).sort()).toEqual([
      ["FIL-PETG", "buy", "500"],
      ["PIEZA-1", "make", "10"],
    ]);
    const make = planned.find((row) => row.kind === "make")!;
    const buy = planned.find((row) => row.kind === "buy")!;
    expect(buy.purchaseQuantity).toBe("0.5");

    const firmed = await api.post(owner, `/mrp/planned-orders/${make.id}/firm`, {});
    expect(firmed.body.status).toBe("firmed");
    const rerun = await api.post(owner, "/mrp/run", {});
    const statuses = (rerun.body.planned as Array<{ sku: string; kind: string; status: string; quantity: string }>).map((row) => [row.sku, row.status, row.quantity]).sort();
    expect(statuses).toEqual([
      ["FIL-PETG", "planned", "500"],
      ["PIEZA-1", "firmed", "10"],
    ]);

    const noVendor = await api.post(owner, `/mrp/planned-orders/${rerun.body.planned.find((row: { kind: string }) => row.kind === "buy").id}/release`, {});
    expect(noVendor.status).toBe(400);
    const vendor = await api.post(owner, "/vendors", { name: "Proveedor PETG" });
    const releaseBuy = await api.post(
      owner,
      `/mrp/planned-orders/${rerun.body.planned.find((row: { kind: string }) => row.kind === "buy").id}/release`,
      { vendorId: vendor.body.id },
    );
    expect(releaseBuy.body).toMatchObject({ releasedType: "purchase_order", folio: "OC-1" });
    const releaseMake = await api.post(owner, `/mrp/planned-orders/${make.id}/release`, {});
    expect(releaseMake.body).toMatchObject({ releasedType: "production_order", folio: "OP-1" });

    const po = await api.get(owner, `/purchase-orders/${releaseBuy.body.releasedId}`);
    expect(po.body.lines[0]).toMatchObject({ quantity: "0.5", purchaseUom: "KG", lineTotal: "150.00" });
    await api.post(owner, `/purchase-orders/${po.body.id}/transition`, { to: "ordered" });

    const after = await api.get(owner, "/mrp/requirements");
    const partRow = after.body.data.find((row: { sku: string }) => row.sku === "PIEZA-1");
    const petgRow = after.body.data.find((row: { sku: string }) => row.sku === "FIL-PETG");
    expect(partRow).toMatchObject({ grossDemand: "10", scheduledOutput: "10", netShortage: "0" });
    expect(petgRow).toMatchObject({ grossDemand: "500", incoming: "500", netShortage: "0" });
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
      request(server()).post(`/api/v1${path}`).set(bearer(token)).set(headers).send(body as object),
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
