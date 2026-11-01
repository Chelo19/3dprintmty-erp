import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createApp } from "../src/main";
import { withIdempotency } from "../src/modules/support";
import { services } from "../src/container";
import { products } from "../src/db/schema";
import { requireTenant, type TenantActor } from "../src/http/actor";

process.env.VITEST = "1";
delete process.env.DATABASE_URL;
const password = "auditoria-local-123";
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("autores de movimientos sin bitácora de actividad", () => {
  let app: INestApplication;
  let token: string;
  let owner: TenantActor;
  let foreign: TenantActor;
  let operator: TenantActor;
  let operatorToken: string;
  beforeAll(async () => {
    app = await createApp({ dataDir: null });
    async function onboard(email: string, rfc: string) {
      const registered = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email, password });
      const result = await request(app.getHttpServer()).post("/api/v1/onboarding").set(bearer(registered.body.token)).send({ legalName: "Taller auditoría", rfc, taxRegime: "626", fiscalPostalCode: "64000", state: "Nuevo León", locationName: "Matriz", locationPostalCode: "64000", vatRate: "0.16", paymentMethods: { efectivo: true, spei: true, tarjeta: false, mercadopago: false, conekta: false, stripe: false, cod: true, credito: false }, seedDemo: false, privacyAccepted: true });
      expect(result.status).toBe(201);
      return { token: result.body.token as string, actor: requireTenant(await services().auth.verify(result.body.token)) };
    }
    ({ token, actor: owner } = await onboard("owner@audit.test", "AUD010101AAA"));
    foreign = (await onboard("other@audit.test", "AUX010101AAA")).actor;
    const invite = await post("/invitations", { email: "operator@audit.test", role: "operator" });
    const joined = await request(app.getHttpServer()).post("/api/v1/invitations/accept").send({ token: invite.body.acceptPath.split("/").at(-1), password });
    expect(joined.status).toBe(201);
    operatorToken = joined.body.token;
    operator = requireTenant(await services().auth.verify(operatorToken));
  });
  afterAll(async () => { await app?.close(); });
  const post = (path: string, body: unknown) => request(app.getHttpServer()).post(`/api/v1${path}`).set(bearer(token)).send(body as object);
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set(bearer(token));
  async function product(actor = owner) {
    return services().database.asUser(actor, async (db) => {
      const [row] = await db.insert(products).values({ tenantId: actor.tenantId, sku: crypto.randomUUID(), name: "Pieza auditable", itemClass: "finished_good", supplyMode: "buy", costMinor: 100n, salePriceMinor: 1000n, createdBy: actor.userId }).returning();
      return row as typeof products.$inferSelect;
    });
  }


  it("retira la tabla, API y triggers de actividad sin impedir altas, cambios y bajas", async () => {
    const result = await services().database.asAdmin(db => db.execute(sql`
      select to_regclass('public.audit_events') as table_name,
        to_regprocedure('public.audit_record_change()') as logging_function,
        (select count(*)::int from pg_trigger where not tgisinternal and tgname='record_audit') as logging_triggers`));
    expect(result.rows[0]).toEqual({ table_name: null, logging_function: null, logging_triggers: 0 });
    expect((await get("/audit-events")).status).toBe(404);
    const row = await product();
    await services().database.asUser(owner, db => db.update(products).set({ name: "Actualizado" }).where(eq(products.id,row.id)));
    await services().database.asUser(owner, db => db.delete(products).where(eq(products.id,row.id)));
  });

  it("conserva el autor original e impide suplantarlo, con aislamiento por taller", async () => {
    const row = await product();
    await expect(services().database.asUser(owner, db => db.update(products).set({ createdBy: foreign.userId }).where(eq(products.id,row.id)))).rejects.toThrow();
    await expect(services().database.asUser(owner, db => db.insert(products).values({ tenantId: owner.tenantId, sku: crypto.randomUUID(), name: "Autor falso", createdBy: foreign.userId }))).rejects.toThrow();
    const [stored] = await services().database.asUser(owner, db => db.select().from(products).where(eq(products.id,row.id)));
    expect(stored.createdBy).toBe(owner.userId);
    expect(await services().database.asUser(foreign, db => db.select().from(products).where(eq(products.id,row.id)))).toHaveLength(0);
  });

  it("mantiene la firma del operador en el historial de inventario", async () => {
    const row = await product();
    const locations = (await get("/locations")).body;
    const result = await request(app.getHttpServer()).post("/api/v1/inventory/movements").set(bearer(operatorToken)).send({ productId: row.id, locationId: locations[0].id, kind: "receipt", quantity: "2", reason: "Entrada del operador", createdBy: foreign.userId });
    expect(result.status).toBe(201);
    const ledger = await get(`/inventory/ledger?section=resale&productId=${row.id}`);
    expect(ledger.body.data[0]).toMatchObject({ createdBy: operator.userId, actorEmail: operator.email });
  });

  it("conserva atomicidad y reintentos idempotentes sin depender de la bitácora", async () => {
    const key = crypto.randomUUID();
    const execute = () => withIdempotency(services().database, owner, key, { route: "author.test.operation" }, async () => {
      const row = await product();
      await services().database.asUser(owner, db => db.update(products).set({ name: "Segunda acción" }).where(eq(products.id,row.id)));
      return { id: row.id };
    });
    const first = await execute();
    expect(await execute()).toEqual(first);
    const [row] = await services().database.asUser(owner, db => db.select().from(products).where(eq(products.id,first.id)));
    await expect(services().database.asUser(owner, async db => { await db.update(products).set({ name: "Debe revertirse" }).where(eq(products.id,row.id)); throw new Error("fallo intencional"); })).rejects.toThrow("fallo intencional");
    const [stored] = await services().database.asUser(owner, db => db.select().from(products).where(eq(products.id,row.id)));
    expect(stored.name).toBe("Segunda acción");
  });

  it("los módulos futuros conservan firma de autor y RLS sin crear registros de actividad", async () => {
    await services().database.asAdmin(async db => {
      await db.execute(sql.raw("create table public.author_future_module (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id), name text, created_by uuid not null)"));
      await db.execute(sql.raw("select public.apply_tenant_rls('author_future_module', array['owner'])"));
    });
    const result = await services().database.asUser(owner, db => db.execute(sql`insert into public.author_future_module(tenant_id,name,created_by) values (${owner.tenantId},'Nuevo módulo',${owner.userId}) returning created_by`));
    expect(result.rows[0]).toEqual({ created_by: owner.userId });
    await expect(services().database.asUser(owner, db => db.execute(sql`insert into public.author_future_module(tenant_id,name,created_by) values (${owner.tenantId},'Autor falso',${foreign.userId})`))).rejects.toThrow();
    const triggers = await services().database.asAdmin(db => db.execute(sql.raw("select tgname from pg_trigger where tgrelid='public.author_future_module'::regclass and not tgisinternal")));
    expect(triggers.rows).toEqual([{ tgname: "record_author" }]);
  });
});
