import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createApp } from "../src/main";
import { withIdempotency } from "../src/modules/support";
import { services } from "../src/container";
import { auditEvents, products } from "../src/db/schema";
import { requireTenant, type TenantActor } from "../src/http/actor";

process.env.VITEST = "1";
delete process.env.DATABASE_URL;
const password = "auditoria-local-123";
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("trazabilidad de acciones autenticadas", () => {
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
  const history = (id: string) => services().database.asUser(owner, (db) => db.select().from(auditEvents).where(eq(auditEvents.entityId, id)));
  async function product(actor = owner) {
    return services().database.asUser(actor, async (db) => {
      const [row] = await db.insert(products).values({ tenantId: actor.tenantId, sku: crypto.randomUUID(), name: "Pieza auditable", itemClass: "finished_good", supplyMode: "buy", costMinor: 100n, salePriceMinor: 1000n, createdBy: actor.userId }).returning();
      return row as typeof products.$inferSelect;
    });
  }

  it("firma automáticamente altas, cambios y bajas con datos anteriores, nuevos y la transacción", async () => {
    const row = await product();
    await services().database.asUser(owner, (db) => db.update(products).set({ name: "Nuevo nombre" }).where(eq(products.id, row.id)));
    await services().database.asUser(owner, (db) => db.delete(products).where(eq(products.id, row.id)));
    const events = await history(row.id);
    expect(events).toHaveLength(3);
    expect(events.map((event: { action: string }) => event.action).sort()).toEqual(["record.delete", "record.insert", "record.update"]);
    expect(events.every((event: { actorUserId: string }) => event.actorUserId === owner.userId)).toBe(true);
    const changed = events.find((event: { action: string }) => event.action === "record.update");
    expect(changed.metadata).toMatchObject({ actorEmail: owner.email, actorRole: "owner", origin: "user", before: { name: "Pieza auditable" }, after: { name: "Nuevo nombre" }, changedFields: ["name"] });
    expect(changed.metadata.transactionId).toMatch(/^\d+$/);
  });

  it("no permite suplantar autor ni cambiar al creador original", async () => {
    const row = await product();
    await expect(services().database.asUser(owner, (db) => db.insert(products).values({ tenantId: owner.tenantId, sku: crypto.randomUUID(), name: "Suplantación", itemClass: "finished_good", supplyMode: "buy", createdBy: foreign.userId }))).rejects.toThrow();
    await expect(services().database.asUser(owner, (db) => db.update(products).set({ createdBy: foreign.userId }).where(eq(products.id, row.id)))).rejects.toThrow();
    await expect(services().database.asUser(owner, (db) => db.insert(auditEvents).values({ tenantId: owner.tenantId, actorUserId: foreign.userId, action: "fake", entityType: "products", entityId: row.id }))).rejects.toThrow();
    expect(await history(row.id)).toHaveLength(1);
  });

  it("la auditoría es inmutable y se revierte junto con la acción fallida", async () => {
    const row = await product();
    const events = await history(row.id);
    await expect(services().database.asUser(owner, (db) => db.delete(auditEvents).where(eq(auditEvents.id, events[0].id)))).rejects.toThrow();
    await expect(services().database.asAdmin((db) => db.execute(sql.raw("truncate public.audit_events")))).rejects.toThrow();
    await expect(services().database.asAdmin((db) => db.update(auditEvents).set({ action: "tampered" }).where(eq(auditEvents.id, events[0].id)))).rejects.toThrow();
    await expect(services().database.asUser(owner, async (db) => { await db.update(products).set({ name: "Debe revertirse" }).where(eq(products.id, row.id)); throw new Error("fallo intencional"); })).rejects.toThrow("fallo intencional");
    expect(await history(row.id)).toHaveLength(1);
    const [stored] = await services().database.asUser(owner, (db) => db.select().from(products).where(eq(products.id, row.id)));
    expect(stored.name).toBe(row.name);
  });

  it("muestra al operador real en inventario y mantiene su identidad después de retirarlo del equipo", async () => {
    const row = await product();
    const locations = (await get("/locations")).body;
    const result = await request(app.getHttpServer()).post("/api/v1/inventory/movements").set(bearer(operatorToken)).send({ productId: row.id, locationId: locations[0].id, kind: "receipt", quantity: "2", reason: "Entrada del operador", createdBy: foreign.userId });
    expect(result.status).toBe(201);
    const events = await get("/audit-events?entityType=stock_ledgers&actor=operator%40audit.test");
    expect(events.status).toBe(200);
    expect(events.body.data).toHaveLength(1);
    expect(events.body.data[0]).toMatchObject({ actorUserId: operator.userId, actorEmail: operator.email, actorRole: "operator", metadata: { after: { created_by: operator.userId } } });
    const ledger = await get(`/inventory/ledger?section=resale&productId=${row.id}`);
    expect(ledger.body.data[0]).toMatchObject({ createdBy: operator.userId, actorEmail: operator.email });
    expect((await request(app.getHttpServer()).get("/api/v1/audit-events").set(bearer(operatorToken))).status).toBe(403);
    expect((await request(app.getHttpServer()).delete(`/api/v1/team/members/${operator.userId}`).set(bearer(token))).status).toBe(200);
    expect((await get("/audit-events?entityType=stock_ledgers")).body.data[0]).toMatchObject({ actorUserId: operator.userId, actorEmail: operator.email });
    const membershipEvents = await get("/audit-events?entityType=tenant_memberships&action=record.delete");
    expect(membershipEvents.body.data[0]).toMatchObject({ actorUserId: owner.userId, actorEmail: owner.email });
  });

  it("aísla talleres, omite tokens y atribuye altas administrativas al usuario verificado", async () => {
    const row = await product(foreign);
    expect((await get(`/audit-events?entityId=${row.id}`)).body).toMatchObject({ data: [], total: 0 });
    const company = (await get("/audit-events?entityType=company_profiles&action=record.insert")).body.data;
    expect(company[0]).toMatchObject({ actorUserId: owner.userId, actorEmail: owner.email });
    const modules = (await get("/audit-events?entityType=company_profiles&limit=1")).body.entityTypes;
    expect(modules).toContain("company_profiles");
    expect(modules).toContain("invitations");
    expect(modules).not.toContain("commercial_documents");
    expect(modules).not.toContain("idempotency_requests");
    expect(modules).not.toContain("company");
    const absentUser = (await get("/audit-events?actor=nobody%40audit.test")).body;
    expect(absentUser).toMatchObject({ data: [], total: 0, entityTypes: [] });
    const invite = (await get("/audit-events?entityType=invitations&action=record.insert")).body.data;
    expect(JSON.stringify(invite)).not.toContain("token_hash");
    const visible = await services().database.asUser(foreign, (db) => db.select().from(auditEvents).where(eq(auditEvents.tenantId, owner.tenantId)));
    expect(visible).toEqual([]);
  });

  it("agrupa una operación atómica y un reintento idempotente no duplica firmas", async () => {
    const key = crypto.randomUUID();
    const payload = { route: "audit.test.operation" };
    const execute = () => withIdempotency(services().database, owner, key, payload, async () => {
      const row = await product();
      await services().database.asUser(owner, (db) => db.update(products).set({ name: "Segunda acción" }).where(eq(products.id, row.id)));
      return { id: row.id };
    });
    const first = await execute();
    expect(await execute()).toEqual(first);
    const cached = await services().database.asUser(owner, (db) => db.select().from(auditEvents).where(eq(auditEvents.entityType, "idempotency_requests")));
    expect(cached).toHaveLength(0);
    const events = await history(first.id);
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event: { metadata: { transactionId: string } }) => event.metadata.transactionId)).size).toBe(1);
    const [row] = await services().database.asUser(owner, (db) => db.select().from(products).where(eq(products.id, first.id)));
    await services().database.asUser(owner, (db) => db.update(products).set({ name: row.name }).where(eq(products.id, row.id)));
    expect(await history(first.id)).toHaveLength(2);
  });

  it("pagina sin perder eventos incluso dentro del mismo milisegundo y audita módulos futuros", async () => {
    const row = await product();
    await services().database.asUser(owner, async (db) => {
      for (let index = 0; index < 6; index++) await db.update(products).set({ name: `Nombre ${index}` }).where(eq(products.id, row.id));
    });
    const ids: string[] = [];
    let cursor = "";
    do {
      const page = await get(`/audit-events?entityId=${row.id}&limit=2${cursor}`);
      expect(page.status).toBe(200);
      expect(page.body.total).toBe(7);
      ids.push(...page.body.data.map((event: { id: string }) => event.id));
      cursor = page.body.next ? `&${new URLSearchParams(page.body.next)}` : "";
    } while (cursor);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    await services().database.asAdmin(async (db) => {
      await db.execute(sql.raw("create table public.audit_future_module (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id), name text)"));
      await db.execute(sql.raw("select public.apply_tenant_rls('audit_future_module', array['owner'])"));
    });
    const future = await services().database.asUser(owner, (db) => db.execute(sql`insert into public.audit_future_module(tenant_id,name) values (${owner.tenantId},'Nuevo módulo') returning id`));
    const event = (await get(`/audit-events?entityId=${future.rows[0].id}`)).body.data[0];
    expect(event).toMatchObject({ actorUserId: owner.userId, entityType: "audit_future_module", action: "record.insert" });
  });
});
