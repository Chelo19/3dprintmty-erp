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
});
