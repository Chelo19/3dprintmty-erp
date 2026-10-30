import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/main";
import { productionMaterialReview } from "../src/modules/production-material-review";
import type { BomIndex, ProductInfo } from "../src/modules/manufacturing.shared";
import { parseQty } from "@3dprintmty/domain";

const password = "material-review-123";
describe("revisión agrupada de materiales de producción", () => {
  let app: INestApplication; let token: string; let foreign: string; let operator: string;
  let first: string; let second: string; let filament: string;
  const post = (path: string, body: unknown, auth = token) => request(app.getHttpServer()).post(`/api/v1${path}`).set("Authorization", `Bearer ${auth}`).set("Idempotency-Key", crypto.randomUUID()).send(body as object);
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
  beforeAll(async () => {
    app = await createApp({ dataDir: null });
    const onboard = async (email: string, rfc: string) => {
      const account = await post("/auth/register", { email, password });
      const result = await post("/onboarding", { legalName: "Revisión materiales", rfc, taxRegime: "626", fiscalPostalCode: "64000", state: "Nuevo León", locationName: "Matriz", locationPostalCode: "64000", vatRate: "0.16", paymentMethods: { efectivo: true, spei: true, tarjeta: false, mercadopago: false, conekta: false, stripe: false, cod: false, credito: false }, seedDemo: false, privacyAccepted: true }, account.body.token);
      expect(result.status).toBe(201); return result.body.token;
    };
    token = await onboard("review@materials.test", "RMA010101AAA");
    foreign = await onboard("foreign@materials.test", "RMB010101AAA");
    const invitation = await post("/invitations", { email: "operator@materials.test", role: "operator" });
    const accepted = await post("/invitations/accept", { token: invitation.body.acceptPath.split("/").at(-1), password });
    expect(accepted.status).toBe(201); operator = accepted.body.token;
    const f = await post("/filaments", { sku: "REVIEW-F", name: "PLA", material: "PLA", color: "Blanco", diameterMm: "1.75", cost: "200" });
    expect(f.status, JSON.stringify(f.body)).toBe(201); filament = f.body.id;
    const supply = await post("/products", { sku: "REVIEW-I", name: "Tornillo", itemClass: "component", supplyMode: "buy", cost: "3" });
    const service = await post("/services", { code: "REVIEW-S", name: "Acabado", unit: "hora", cost: "20", salePrice: "30" });
    expect(supply.status, JSON.stringify(supply.body)).toBe(201);
    expect(service.status, JSON.stringify(service.body)).toBe(201);
    const ids: string[] = [];
    for (const [sku, quantity] of [["REVIEW-A", "2"], ["REVIEW-B", "3"]]) {
      const product = await post("/products", { sku, name: sku, itemClass: "finished_good", supplyMode: "make" });
      expect(product.status, JSON.stringify(product.body)).toBe(201);
      const bom = await post("/boms", { productId: product.body.id, lines: [{ componentProductId: filament, quantity: "100", scrapPct: "10" }, { componentProductId: supply.body.id, quantity: "2" }], services: [{ serviceId: service.body.id, quantity: "0.5" }] });
      expect(bom.status, JSON.stringify(bom.body)).toBe(201);
      const order = await post("/production-orders", { productId: product.body.id, quantity });
      expect(order.status).toBe(201); ids.push(order.body.id);
    }
    first = ids[0]!; second = ids[1]!;
  });
  afterAll(async () => { await app?.close(); });

  it("agrupa materiales compartidos, merma y servicios con cantidades e importes precisos sin modificar OP", async () => {
    const before = (await get(`/production-orders/${first}`)).body;
    const result = await post("/production-orders/material-review", { orderIds: [first, second, first] });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body).toMatchObject({ totalPieces: "5", materialCost: "140.00", serviceCost: "50.00", totalCost: "190.00", missingCosts: false });
    expect(result.body.orders).toHaveLength(2);
    expect(result.body.lines).toHaveLength(3);
    expect(result.body.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "filament", quantity: "550", unit: "G", unitCost: "0.2", totalCost: "110.00" }),
      expect.objectContaining({ kind: "supply", quantity: "10", totalCost: "30.00" }),
      expect.objectContaining({ kind: "service", quantity: "2.5", unit: "hora", totalCost: "50.00" }),
    ]));
    expect((await get(`/production-orders/${first}`)).body).toEqual(before);
  });

  it("permite cantidades al operador sin exponer costos ni totales monetarios", async () => {
    const result = await post("/production-orders/material-review", { orderIds: [first, second] }, operator);
    expect(result.status).toBe(201);
    expect(result.body.totalPieces).toBe("5");
    expect(result.body.totalCost).toBeNull();
    expect(result.body.lines.every((line: { unitCost: unknown; totalCost: unknown }) => line.unitCost === null && line.totalCost === null)).toBe(true);
  });

  it("rechaza órdenes ajenas, inexistentes y selecciones inválidas", async () => {
    expect((await post("/production-orders/material-review", { orderIds: [first] }, foreign)).status).toBe(404);
    expect((await post("/production-orders/material-review", { orderIds: [first, crypto.randomUUID()] })).status).toBe(404);
    for (const orderIds of [[], ["incorrecto"], Array(1001).fill(first)]) expect((await post("/production-orders/material-review", { orderIds })).status).toBe(400);
  });

  it("señala costos pendientes y usa el catálogo vigente sin cambiar el costo histórico de las órdenes", async () => {
    const before = (await get(`/production-orders/${first}`)).body;
    expect((await request(app.getHttpServer()).patch(`/api/v1/filaments/${filament}`).set("Authorization", `Bearer ${token}`).send({ cost: null })).status).toBe(200);
    const result = await post("/production-orders/material-review", { orderIds: [first] });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ missingCosts: true, materialCost: null, serviceCost: "20.00", totalCost: null });
    expect(result.body.lines.find((line: { kind: string }) => line.kind === "filament")).toMatchObject({ quantity: "220", unitCost: null, totalCost: null });
    expect((await get(`/production-orders/${first}`)).body).toEqual(before);
  });
});

it("expande subrecetas con merma sin duplicar sus costos y rechaza ciclos", () => {
  const item = (id: string): ProductInfo => ({ id, sku: id, name: id, productType: "component", itemClass: "component", supplyMode: "buy", stockUom: "EA", purchaseUom: "EA", uomFactor: "1", costMinor: 100n, qcRigor: "off" });
  const catalog = new Map(["parent", "child", "leaf"].map(id => [id, item(id)]));
  const recipes = new Map([["parent", [{ componentId: "child", quantity: parseQty("2"), scrapPct: 0n }]], ["child", [{ componentId: "leaf", quantity: parseQty("3"), scrapPct: parseQty("10") }]]]);
  const index: BomIndex = { lookup: id => recipes.get(id), bomIdByProduct: new Map(), servicesByProduct: new Map(), laborByProduct: new Map() };
  const orders = [{ id: "op", folio: "OP-1", productId: "parent", quantityOrdered: "2" }];
  expect(productionMaterialReview(orders, index, catalog)).toMatchObject({ totalCost: "13.20", lines: [expect.objectContaining({ id: "leaf", quantity: "13.2" })] });
  recipes.set("leaf", [{ componentId: "parent", quantity: parseQty("1"), scrapPct: 0n }]);
  expect(() => productionMaterialReview(orders, index, catalog)).toThrow("ciclo");
});
