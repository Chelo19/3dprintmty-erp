import "reflect-metadata";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repoRoot } from "../src/db/database.service";
import { migrationFiles } from "../src/db/migrations";
import { services } from "../src/container";
import { sql } from "drizzle-orm";
import { createApp } from "../src/main";

process.env.VITEST = "1";
delete process.env.DATABASE_URL;

it("retira tablas de OC conservando gastos, abonos, recepciones, lotes y kardex históricos", async () => {
  const db = new PGlite(); const root = repoRoot();
  const migration = "20261015011845_remove_purchase_orders_keep_direct_purchases.sql";
  const ids = Array.from({ length: 10 }, (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  const [user, tenant, location, vendor, product, order, line, expense, receipt, lot] = ids;
  try {
    await db.exec(readFileSync(join(root, "supabase/local/auth_stubs.sql"), "utf8"));
    for (const file of migrationFiles(root).filter((file) => file < migration)) await db.exec(readFileSync(join(root, "supabase/migrations", file), "utf8"));
    await db.query("insert into user_accounts(id,email) values ($1,'historic@purchase.test')", [user]);
    await db.query("insert into tenants(id,slug,status) values ($1,'historical-purchases','active')", [tenant]);
    await db.query("insert into locations(id,tenant_id,name,kind,postal_code,state,country_code,created_by) values ($1,$2,'Matriz','warehouse','64000','Nuevo León','MX',$3)", [location,tenant,user]);
    await db.query("insert into vendors(id,tenant_id,name,created_by) values ($1,$2,'Proveedor histórico',$3)", [vendor,tenant,user]);
    await db.query("insert into products(id,tenant_id,sku,name,item_class,supply_mode,cost_minor,created_by) values ($1,$2,'HIST','Artículo','finished_good','buy',5000,$3)", [product,tenant,user]);
    await db.query("insert into purchase_orders(id,tenant_id,folio,vendor_id,vendor_name,location_id,status,subtotal_minor,total_minor,created_by) values ($1,$2,'OC-1',$3,'Proveedor histórico',$4,'received',10000,10000,$5)", [order,tenant,vendor,location,user]);
    await db.query("insert into purchase_order_lines(id,tenant_id,purchase_order_id,product_id,description,purchase_uom,uom_factor,quantity,received_qty,unit_cost_minor,line_total_minor) values ($1,$2,$3,$4,'Artículo','PZA',1,2,2,5000,10000)", [line,tenant,order,product]);
    await db.query("insert into expenses(id,tenant_id,folio,kind,product_id,description,quantity,amount_minor,occurred_on,purchase_order_id,created_by) values ($1,$2,'GAS-1','product',$3,'Compra histórica',2,10000,'2026-10-01',$4,$5)", [expense,tenant,product,order,user]);
    await db.query("insert into expense_payments(tenant_id,expense_id,paid_on,amount_minor,created_by) values ($1,$2,'2026-10-02',2000,$3)", [tenant,expense,user]);
    await db.query("insert into receipts(id,tenant_id,folio,purchase_order_id,location_id,created_by) values ($1,$2,'REC-1',$3,$4,$5)", [receipt,tenant,order,location,user]);
    await db.query("insert into material_lots(id,tenant_id,product_id,lot_number,source,received_qty,vendor_id,purchase_order_id,receipt_id,created_by) values ($1,$2,$3,'REC-1-1','purchase',2,$4,$5,$6,$7)", [lot,tenant,product,vendor,order,receipt,user]);
    await db.query("insert into receipt_lines(tenant_id,receipt_id,purchase_order_line_id,product_id,quantity,stock_quantity,lot_id,value_minor) values ($1,$2,$3,$4,2,2,$5,10000)", [tenant,receipt,line,product,lot]);
    await db.query("insert into stock_balances(tenant_id,product_id,location_id,on_hand,created_by) values ($1,$2,$3,2,$4)", [tenant,product,location,user]);
    await db.query("insert into stock_ledgers(tenant_id,product_id,location_id,kind,quantity,reason,reference_type,reference_id,lot_id,value_minor,created_by) values ($1,$2,$3,'receipt',2,'Histórico','receipt',$4,$5,10000,$6)", [tenant,product,location,receipt,lot,user]);
    const before: Record<string, unknown> = {};
    for (const table of ["expense_payments","stock_ledgers","stock_balances"]) before[table] = (await db.query(`select * from ${table}`)).rows;
    const oldExpense = (await db.query("select id,amount_minor,quantity,created_by,created_at from expenses")).rows;
    await db.exec(readFileSync(join(root, "supabase/migrations", migration), "utf8"));
    for (const table of ["expense_payments","stock_ledgers","stock_balances"]) expect((await db.query(`select * from ${table}`)).rows).toEqual(before[table]);
    expect((await db.query("select id,amount_minor,quantity,created_by,created_at from expenses")).rows).toEqual(oldExpense);
    expect((await db.query("select to_regclass('public.purchase_orders') as orders,to_regclass('public.purchase_order_lines') as lines")).rows[0]).toEqual({ orders:null,lines:null });
    expect((await db.query("select expense_id,vendor_id,source_folio from receipts")).rows[0]).toEqual({ expense_id:expense,vendor_id:vendor,source_folio:"OC-1" });
    expect((await db.query("select expense_id,receipt_id,received_qty from material_lots")).rows[0]).toMatchObject({ expense_id:expense,receipt_id:receipt,received_qty:"2.0000" });
    expect((await db.query("select description,purchase_uom,unit_cost_minor,value_minor from receipt_lines")).rows[0]).toMatchObject({ description:"Artículo",purchase_uom:"PZA",unit_cost_minor:5000,value_minor:10000 });
    const archived = (await db.query("select metadata from audit_events where action='purchase_order.archived' and entity_id=$1", [order])).rows[0] as {metadata:{before:{folio:string};lines:unknown[]}};
    expect(archived.metadata.before.folio).toBe("OC-1"); expect(archived.metadata.lines).toHaveLength(1);
    for (const file of migrationFiles(root).filter((file) => file > migration)) await db.exec(readFileSync(join(root, "supabase/migrations", file), "utf8"));
    expect((await db.query("select id,amount_minor,quantity,created_by,created_at from expenses")).rows).toEqual(oldExpense);
    for (const table of ["expense_payments","stock_ledgers","stock_balances"]) {
      const rows = (await db.query(`select * from ${table}`)).rows.map((row) => {
        const { canceled_at, canceled_by, cancellation_reason, ...historic } = row as Record<string, unknown>;
        return historic;
      });
      expect(rows).toEqual(before[table]);
    }
    expect((await db.query("select expense_id,position,kind,product_id,quantity,purchase_uom,uom_factor,amount_minor,created_by from expense_lines")).rows[0]).toMatchObject({ expense_id: expense, position: 0, kind: "product", product_id: product, quantity: "2.0000", purchase_uom: "PZA", uom_factor: "1.0000", amount_minor: 10000, created_by: user });
  } finally { await db.close(); }
});

describe("compras directas sin OC", () => {
  let app: INestApplication; let token: string;
  beforeAll(async () => {
    app = await createApp({ dataDir: null });
    const account = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email:"direct@purchases.test",password:"purchase-test-123" });
    const result = await request(app.getHttpServer()).post("/api/v1/onboarding").set("Authorization",`Bearer ${account.body.token}`).send({legalName:"Compras directas",rfc:"DPC010101AAA",taxRegime:"626",fiscalPostalCode:"64000",state:"Nuevo León",locationName:"Matriz",locationPostalCode:"64000",vatRate:"0.16",paymentMethods:{efectivo:true,spei:true,tarjeta:false,mercadopago:false,conekta:false,stripe:false,cod:true,credito:false},seedDemo:false,privacyAccepted:true});
    expect(result.status).toBe(201);token=result.body.token;
  });
  afterAll(async () => {await app?.close();});
  const get = (path:string) => request(app.getHttpServer()).get(`/api/v1${path}`).set("Authorization",`Bearer ${token}`);
  const post = (path:string,body:unknown,key?:string) => {const call=request(app.getHttpServer()).post(`/api/v1${path}`).set("Authorization",`Bearer ${token}`);return(key?call.set("Idempotency-Key",key):call).send(body as object);};
  it("mantiene inventario, lotes, abonos, costos y vínculos al gasto con idempotencia", async () => {
    const filament=await post("/filaments",{sku:"DIRECT-PLA",name:"PLA",material:"PLA",color:"Azul",diameterMm:"1.75",cost:"200"});
    const payload={kind:"filament",itemId:filament.body.id,quantity:"2",amount:"500",paidAmount:"100",paidOn:"2026-10-14",occurredOn:"2026-10-14",vendorLot:"LOT-1"};
    const key=crypto.randomUUID();const created=await post("/expenses",payload,key);expect(created.status).toBe(201);expect(created.body).toMatchObject({amount:"500.00",paid:"100.00",balance:"400.00"});
    expect((await post("/expenses",payload,key)).body.id).toBe(created.body.id);
    expect((await get(`/filaments/${filament.body.id}`)).body.cost).toBe("250.00");
    const ledger=(await get(`/inventory/ledger?section=filaments&productId=${filament.body.id}`)).body.data;expect(ledger).toHaveLength(1);expect(ledger[0]).toMatchObject({quantity:"2000",purchase:{kind:"expense",id:created.body.id,folio:created.body.folio}});
    expect((await get(`/lots?productId=${filament.body.id}`)).body.data[0]).toMatchObject({expenseId:created.body.id,vendorLot:"LOT-1",receivedQty:"2000"});
    expect((await post(`/expenses/${created.body.id}/payments`,{amount:"400",paidOn:"2026-10-15"})).status).toBe(201);expect((await get(`/expenses/${created.body.id}`)).body.paymentStatus).toBe("paid");
    const tables=await services().database.asAdmin((db)=>db.execute(sql.raw("select to_regclass('public.purchase_orders') as orders,to_regclass('public.purchase_order_lines') as lines")));expect(tables.rows[0]).toEqual({orders:null,lines:null});
    for(const path of ["/purchase-orders","/purchase-orders/20000000-0000-4000-8000-000000000001"])expect((await get(path)).status).toBe(503);
  });
  it("revierte gasto, abono y existencias si falla una compra", async () => {
    const vendor=await post("/vendors",{name:"Proveedor inactivo"});await request(app.getHttpServer()).patch(`/api/v1/vendors/${vendor.body.id}`).set("Authorization",`Bearer ${token}`).send({active:false});
    const item=await post("/products",{sku:"FAIL-P",name:"Artículo",itemClass:"component",supplyMode:"buy",cost:"3"});
    const before=(await get("/expenses")).body.data.length;
    expect((await post("/expenses",{kind:"product",itemId:item.body.id,vendorId:vendor.body.id,quantity:"1",amount:"10",paidAmount:"5",paidOn:"2026-10-14",occurredOn:"2026-10-14"},crypto.randomUUID())).status).toBe(409);
    expect((await get("/expenses")).body.data).toHaveLength(before);
    expect((await get(`/inventory/ledger?section=supplies&productId=${item.body.id}`)).body.data).toEqual([]);
    expect((await get(`/lots?productId=${item.body.id}`)).body.data).toEqual([]);
  });
  it("guarda una compra con productos, filamento y gastos, con una recepción y abonos sobre el total", async () => {
    const product = await post("/products", { sku: "MULTI-P", name: "Insumo múltiple", itemClass: "component", supplyMode: "buy", cost: "10" });
    const filament = await post("/filaments", { sku: "MULTI-F", name: "PLA múltiple", material: "PLA", color: "Verde", diameterMm: "1.75", cost: "200" });
    const payload = { occurredOn: "2026-10-27", paidAmount: "100", paidOn: "2026-10-27", note: "Factura con varias partidas", lines: [
      { kind: "product", itemId: product.body.id, quantity: "3", amount: "120" },
      { kind: "filament", itemId: filament.body.id, quantity: "2", amount: "500", vendorLot: "PROVEEDOR-MULTI" },
      { kind: "service", description: "Mensajería", quantity: "1", amount: "10.50" },
      { kind: "other", description: "Empaque", quantity: "1", amount: "2.50" },
    ] };
    const created = await post("/expenses", payload, crypto.randomUUID());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ kind: "mixed", amount: "633.00", paid: "100.00", balance: "533.00", paymentStatus: "partial" });
    const detail = await get(`/expenses/${created.body.id}`);
    expect(detail.body.lines).toHaveLength(4);
    expect(detail.body.lines[0]).toMatchObject({ itemId: product.body.id, itemClass: "component", quantity: "3", amount: "120.00" });
    expect(detail.body.lines[1]).toMatchObject({ itemId: filament.body.id, purchaseUom: "KG", quantity: "2", amount: "500.00" });
    const productLedger = (await get(`/inventory/ledger?section=supplies&productId=${product.body.id}`)).body.data;
    const filamentLedger = (await get(`/inventory/ledger?section=filaments&productId=${filament.body.id}`)).body.data;
    expect(productLedger).toHaveLength(1);
    expect(filamentLedger).toHaveLength(1);
    expect(productLedger[0]).toMatchObject({ quantity: "3", purchase: { id: created.body.id, folio: created.body.folio } });
    expect(filamentLedger[0]).toMatchObject({ quantity: "2000", purchase: { id: created.body.id, folio: created.body.folio } });
    expect(productLedger[0].referenceId).toBe(filamentLedger[0].referenceId);
    expect((await get(`/products/${product.body.id}`)).body.cost).toBe("40.00");
    expect((await get(`/filaments/${filament.body.id}`)).body.cost).toBe("250.00");
    expect((await get(`/lots?productId=${filament.body.id}`)).body.data[0]).toMatchObject({ expenseId: created.body.id, vendorLot: "PROVEEDOR-MULTI", receivedQty: "2000" });
    expect((await post(`/expenses/${created.body.id}/payments`, { amount: "533", paidOn: "2026-10-28" })).status).toBe(201);
    expect((await get(`/expenses/${created.body.id}`)).body).toMatchObject({ paymentStatus: "paid", balance: "0.00" });
  });

  it("permite dos lotes del mismo artículo y reintentos sin duplicar existencias ni alterar el costo promedio", async () => {
    const product = await post("/products", { sku: "MULTI-REPEAT", name: "Reventa por lotes", itemClass: "finished_good", supplyMode: "buy", cost: "20" });
    const payload = { occurredOn: "2026-10-27", paid: true, lines: [
      { kind: "product", itemId: product.body.id, quantity: "1", amount: "100" },
      { kind: "product", itemId: product.body.id, quantity: "3", amount: "900" },
    ] };
    const key = crypto.randomUUID();
    const [first, second] = await Promise.all([post("/expenses", payload, key), post("/expenses", payload, key)]);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(first.body).toMatchObject({ amount: "1000.00", paid: "1000.00", balance: "0.00" });
    expect((await get(`/products/${product.body.id}`)).body.cost).toBe("250.00");
    const ledger = (await get(`/inventory/ledger?section=resale&productId=${product.body.id}`)).body.data;
    expect(ledger).toHaveLength(2);
    expect(ledger.map((row: { quantity: string }) => row.quantity).sort()).toEqual(["1", "3"]);
    const lots = (await get(`/lots?productId=${product.body.id}`)).body.data;
    expect(lots).toHaveLength(2);
    expect(new Set(lots.map((row: { lotNumber: string }) => row.lotNumber)).size).toBe(2);
    expect((await get(`/expenses/${first.body.id}`)).body.lines).toHaveLength(2);
  });

  it("revierte todas las partidas, costos, abonos y entradas si el segundo artículo tiene conflicto de lote", async () => {
    const first = await post("/products", { sku: "MULTI-ROLL-1", name: "Insumo uno", itemClass: "component", supplyMode: "buy", cost: "10" });
    const second = await post("/products", { sku: "MULTI-ROLL-2", name: "Insumo dos", itemClass: "component", supplyMode: "buy", cost: "20" });
    const before = (await get("/expenses")).body.data.length;
    const payload = { occurredOn: "2026-10-27", paid: true, lines: [
      { kind: "product", itemId: first.body.id, quantity: "2", amount: "200", lotNumber: "MULTI-SAME-LOT" },
      { kind: "product", itemId: second.body.id, quantity: "1", amount: "100", lotNumber: "MULTI-SAME-LOT" },
    ] };
    const result = await post("/expenses", payload, crypto.randomUUID());
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("lot_conflict");
    expect((await get("/expenses")).body.data).toHaveLength(before);
    for (const item of [first, second]) {
      expect((await get(`/inventory/ledger?section=supplies&productId=${item.body.id}`)).body.data).toEqual([]);
      expect((await get(`/lots?productId=${item.body.id}`)).body.data).toEqual([]);
    }
    expect((await get(`/products/${first.body.id}`)).body.cost).toBe("10.00");
    expect((await get(`/products/${second.body.id}`)).body.cost).toBe("20.00");
    const invalid = [
      { ...payload, lines: [] },
      { ...payload, lines: [{ ...payload.lines[0], quantity: "0" }] },
      { ...payload, lines: [{ kind: "other", amount: "10" }] },
      { ...payload, paid: undefined, paidAmount: "999" },
    ];
    for (const body of invalid) expect((await post("/expenses", body, crypto.randomUUID())).status).toBe(400);
  });

  it("sigue rechazando productos fabricados dentro de una compra con múltiples partidas", async () => {
    const product = await post("/products", { sku: "MULTI-MAKE", name: "Fabricado", itemClass: "finished_good", supplyMode: "make", cost: "10" });
    const before = (await get("/expenses")).body.data.length;
    const result = await post("/expenses", { occurredOn: "2026-10-27", lines: [
      { kind: "other", description: "Gasto válido", amount: "20" },
      { kind: "product", itemId: product.body.id, quantity: "1", amount: "100" },
    ] }, crypto.randomUUID());
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("not_purchasable");
    expect((await get("/expenses")).body.data).toHaveLength(before);
  });

  it("aísla las partidas entre talleres y rechaza referencias a artículos ajenos", async () => {
    const product = await post("/products", { sku: "TENANT-MULTI", name: "Artículo propio", itemClass: "component", supplyMode: "buy", cost: "10" });
    const created = await post("/expenses", { occurredOn: "2026-10-27", lines: [
      { kind: "product", itemId: product.body.id, quantity: "1", amount: "10" },
      { kind: "other", description: "Gasto propio", amount: "20" },
    ] }, crypto.randomUUID());
    expect(created.status).toBe(201);
    const account = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email: "other@multi-purchases.test", password: "purchase-test-123" });
    const onboard = await request(app.getHttpServer()).post("/api/v1/onboarding").set("Authorization", `Bearer ${account.body.token}`).send({ legalName: "Otro taller compras", rfc: "OTC010101AAA", taxRegime: "626", fiscalPostalCode: "64000", state: "Nuevo León", locationName: "Matriz", locationPostalCode: "64000", vatRate: "0.16", paymentMethods: { efectivo: true, spei: true, tarjeta: false, mercadopago: false, conekta: false, stripe: false, cod: true, credito: false }, seedDemo: false, privacyAccepted: true });
    expect(onboard.status).toBe(201);
    const header = { Authorization: `Bearer ${onboard.body.token}` };
    expect((await request(app.getHttpServer()).get(`/api/v1/expenses/${created.body.id}`).set(header)).status).toBe(404);
    expect((await request(app.getHttpServer()).post(`/api/v1/expenses/${created.body.id}/cancel`).set(header).set("Idempotency-Key", crypto.randomUUID()).send({ reason: "Intento desde otro taller" })).status).toBe(404);
    const other = await services().auth.verify(onboard.body.token);
    const visible = await services().database.asUser(other, (db) => db.execute(sql`select id from public.expense_lines where expense_id = ${created.body.id}::uuid`));
    expect(visible.rows).toEqual([]);
    expect((await request(app.getHttpServer()).post("/api/v1/expenses").set(header).send({ occurredOn: "2026-10-27", lines: [{ kind: "product", itemId: product.body.id, quantity: "1", amount: "10" }] })).status).toBe(404);
  });

  it("cancela un gasto y todos sus abonos conservando importes y auditoría, sin admitir nuevos pagos", async () => {
    const created = await post("/expenses", { kind: "other", description: "Gasto cancelable", amount: "100", occurredOn: "2026-10-27", paidAmount: "40", paidOn: "2026-10-27" });
    await post(`/expenses/${created.body.id}/payments`, { amount: "60", paidOn: "2026-10-27" });
    const body = { reason: "Captura duplicada del comprobante" }; const key = crypto.randomUUID();
    const result = await post(`/expenses/${created.body.id}/cancel`, body, key);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body).toMatchObject({ amount: "100.00", paid: "0.00", balance: "0.00", paymentStatus: "canceled", cancellationReason: body.reason });
    expect(result.body.payments).toHaveLength(2);
    expect(result.body.payments.every((payment: { canceledAt: string }) => Boolean(payment.canceledAt))).toBe(true);
    expect(result.body.payments.map((payment: { amount: string }) => payment.amount)).toEqual(["40.00", "60.00"]);
    expect((await post(`/expenses/${created.body.id}/cancel`, body, key)).body).toEqual(result.body);
    expect((await post(`/expenses/${created.body.id}/payments`, { amount: "1", paidOn: "2026-10-27" })).status).toBe(409);
    const audit = await services().database.asAdmin(db => db.execute(sql`select actor_user_id, metadata from audit_events where action='expense.canceled' and entity_id=${created.body.id}::uuid`));
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_user_id).toBe(result.body.canceledBy);
  });

  it("revierte existencias y valores de varias partidas una sola vez, y recupera el costo ponderado restante", async () => {
    const item = await post("/products", { sku: "CANCEL-MULTI", name: "Insumo cancelable", itemClass: "component", supplyMode: "buy", cost: "10" });
    const filament = await post("/filaments", { sku: "CANCEL-F", name: "PLA cancelable", material: "PLA", color: "Rojo", diameterMm: "1.75", cost: "200" });
    await post("/expenses", { kind: "product", itemId: item.body.id, quantity: "2", amount: "20", occurredOn: "2026-10-27" });
    const created = await post("/expenses", { occurredOn: "2026-10-27", paid: true, lines: [
      { kind: "product", itemId: item.body.id, quantity: "1", amount: "20" },
      { kind: "product", itemId: item.body.id, quantity: "1", amount: "40" },
      { kind: "filament", itemId: filament.body.id, quantity: "2", amount: "500" },
    ] });
    const key = crypto.randomUUID(); const body = { reason: "Compra capturada por error" };
    const results = await Promise.all([post(`/expenses/${created.body.id}/cancel`, body, key), post(`/expenses/${created.body.id}/cancel`, body, key)]);
    expect(results.map(result => result.status)).toEqual([201, 201]);
    expect((await get(`/products/${item.body.id}`)).body.cost).toBe("10.00");
    const ledger = (await get(`/inventory/ledger?section=supplies&productId=${item.body.id}`)).body.data;
    expect(ledger.filter((row: { quantity: string }) => Number(row.quantity) < 0)).toHaveLength(2);
    expect(ledger.filter((row: { quantity: string }) => Number(row.quantity) < 0).every((row: { purchase: { id: string } }) => row.purchase.id === created.body.id)).toBe(true);
    const quantities = await services().database.asAdmin(db => db.execute(sql`select product_id,filament_id,on_hand from stock_balances where product_id=${item.body.id}::uuid or filament_id=${filament.body.id}::uuid`));
    expect(quantities.rows).toEqual(expect.arrayContaining([expect.objectContaining({ product_id: item.body.id, on_hand: "2.0000" }), expect.objectContaining({ filament_id: filament.body.id, on_hand: "0.0000" })]));
    const movements = await services().database.asAdmin(db => db.execute(sql`select sum(value_minor)::text as value from stock_ledgers where reference_type='expense_cancellation' and reference_id=${created.body.id}::uuid`));
    expect(movements.rows[0]).toMatchObject({ value: "-56000" });
    expect((await post(`/expenses/${created.body.id}/cancel`, body, crypto.randomUUID())).status).toBe(201);
  });

  it("bloquea cancelar inventario consumido aunque se haya repuesto y conserva gasto y pagos activos", async () => {
    const item = await post("/products", { sku: "CANCEL-USED", name: "Consumido", itemClass: "component", supplyMode: "buy", cost: "10" });
    const created = await post("/expenses", { kind: "product", itemId: item.body.id, quantity: "3", amount: "30", paid: true, occurredOn: "2026-10-27" });
    const location = await services().database.asAdmin(db => db.execute(sql`select location_id from stock_balances where product_id=${item.body.id}::uuid`));
    for (const kind of ["issue", "receipt"]) expect((await post("/inventory/movements", { productId: item.body.id, locationId: location.rows[0].location_id, kind, quantity: "1", reason: "Prueba consumo y reposición" })).status).toBe(201);
    const result = await post(`/expenses/${created.body.id}/cancel`, { reason: "No debe cancelar existencias usadas" }, crypto.randomUUID());
    expect(result.status).toBe(409); expect(result.body.code).toBe("purchase_stock_used");
    expect((await get(`/expenses/${created.body.id}`)).body).toMatchObject({ canceledAt: null, paid: "30.00", paymentStatus: "paid" });
  });

  it("revierte toda la transacción si otra partida está apartada y exige motivo", async () => {
    const items: Array<{ id: string }> = [];
    for (const sku of ["CANCEL-FREE", "CANCEL-HELD"]) items.push((await post("/products", { sku, name: sku, itemClass: "component", supplyMode: "buy", cost: "10" })).body);
    const created = await post("/expenses", { occurredOn: "2026-10-27", paid: true, lines: items.map(item => ({ kind: "product", itemId: item.id, quantity: "2", amount: "20" })) });
    await services().database.asAdmin(db => db.execute(sql`update stock_balances set allocated=1 where product_id=${items[1]!.id}::uuid`));
    expect((await post(`/expenses/${created.body.id}/cancel`, { reason: " " }, crypto.randomUUID())).status).toBe(400);
    const result = await post(`/expenses/${created.body.id}/cancel`, { reason: "Existencias reservadas" }, crypto.randomUUID());
    expect(result.status).toBe(409);
    const ledger = await services().database.asAdmin(db => db.execute(sql`select id from stock_ledgers where reference_type='expense_cancellation' and reference_id=${created.body.id}::uuid`));
    expect(ledger.rows).toHaveLength(0);
    const expense = (await get(`/expenses/${created.body.id}`)).body;
    expect(expense).toMatchObject({ canceledAt: null, paymentStatus: "paid", paid: "40.00" });
    expect(expense.payments[0].canceledAt).toBeNull();
  });

  it("excluye gastos cancelados de pendientes y del dashboard, y limita la cancelación a compradores", async () => {
    const before = (await get("/dashboard")).body;
    const created = await post("/expenses", { kind: "other", description: "Pendiente a cancelar", amount: "123", paidAmount: "23", paidOn: "2026-10-27", occurredOn: "2026-10-27" });
    const active = (await get("/dashboard")).body;
    expect(Number(active.kpis.payables) - Number(before.kpis.payables)).toBe(100);
    const invite = await post("/invitations", { email: "operator@cancel.test", role: "operator" });
    const joined = await request(app.getHttpServer()).post("/api/v1/invitations/accept").send({ token: invite.body.acceptPath.split("/").at(-1), password: "purchase-test-123" });
    expect(joined.status).toBe(201);
    expect((await request(app.getHttpServer()).post(`/api/v1/expenses/${created.body.id}/cancel`).set("Authorization", `Bearer ${joined.body.token}`).set("Idempotency-Key", crypto.randomUUID()).send({ reason: "Sin permiso de compras" })).status).toBe(403);
    expect((await post(`/expenses/${created.body.id}/cancel`, { reason: "Duplicado en registro" }, crypto.randomUUID())).status).toBe(201);
    const after = (await get("/dashboard")).body;
    expect(after.kpis.payables).toBe(before.kpis.payables);
    expect(after.months).toEqual(before.months);
    expect((await get("/expenses")).body.data.find((row: { id: string }) => row.id === created.body.id)).toMatchObject({ paymentStatus: "canceled", balance: "0.00" });
  });

});
