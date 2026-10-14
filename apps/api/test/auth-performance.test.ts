import "reflect-metadata";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { jwtVerify } from "jose";
import { DatabaseService } from "../src/db/database.service";
import { AuthService } from "../src/modules/auth.service";
import { idempotencyRequests, tenantMemberships, tenants, userAccounts } from "../src/db/schema";

vi.mock("jose", async (original) => ({ ...await original<typeof import("jose")>(), jwtVerify: vi.fn() }));

const database = new DatabaseService({ dataDir: null });
const auth = new AuthService(database);
const userId = crypto.randomUUID();
const tenantId = crypto.randomUUID();
const email = "fresh-role@performance.test";
const token = `${Buffer.from(JSON.stringify({ alg: "ES256" })).toString("base64url")}.e30.signature`;

beforeAll(async () => {
  await database.onModuleInit();
  await database.asAdmin(async (db) => {
    await db.insert(userAccounts).values({ id: userId, email });
    await db.insert(tenants).values({ id: tenantId, slug: "performance", countryCode: "MX", status: "active" });
    await db.insert(tenantMemberships).values({ userId, tenantId, email, role: "operator" });
  });
});
afterAll(async () => { vi.unstubAllEnvs(); await database.onModuleDestroy(); });

it("verifica cuentas existentes en un viaje y aplica cambios de rol y bajas sin caché", async () => {
  vi.stubEnv("AUTH_DRIVER", "supabase");
  vi.stubEnv("SUPABASE_URL", "https://performance.supabase.co");
  vi.mocked(jwtVerify).mockResolvedValue({ payload: { sub: userId, email }, protectedHeader: { alg: "ES256" } } as never);
  const calls = vi.spyOn(database, "asAdmin");
  const first = await auth.verify(token);
  expect(first.role).toBe("operator");
  expect(calls).toHaveBeenCalledTimes(1);
  await database.asAdmin((db) => db.update(tenantMemberships).set({ role: "viewer" }).where(eq(tenantMemberships.userId, userId)));
  calls.mockClear();
  expect((await auth.verify(token)).role).toBe("viewer");
  expect(calls).toHaveBeenCalledTimes(1);
  await database.asAdmin((db) => db.delete(tenantMemberships).where(eq(tenantMemberships.userId, userId)));
  calls.mockClear();
  expect(await auth.verify(token)).toMatchObject({ tenantId: null, role: null });
  expect(calls).toHaveBeenCalledTimes(1);
  calls.mockRestore();
});

it("vincula la identidad de Supabase sin perder membresía ni respuestas activas o archivadas", async () => {
  const oldId = crypto.randomUUID();
  const newId = crypto.randomUUID();
  const linkedEmail = "linked-account@performance.test";
  const response = { paymentId: "preserved-payment", amount: "50.00" };
  await database.asAdmin(async (db) => {
    await db.insert(userAccounts).values({ id: oldId, email: linkedEmail });
    await db.insert(tenantMemberships).values({ userId: oldId, tenantId, email: linkedEmail, role: "operator" });
    await db.execute(sql`insert into erp_archive.idempotency_keys(user_id,key,request_hash,response) values (${oldId}::uuid,'legacy','old-hash',${JSON.stringify(response)}::jsonb)`);
    await db.insert(idempotencyRequests).values({ tenantId, userId: oldId, operation: "payments", key: "active", requestHash: "active-hash", response, status: "completed", completedAt: new Date() });
  });
  vi.stubEnv("AUTH_DRIVER", "supabase");
  vi.stubEnv("SUPABASE_URL", "https://performance.supabase.co");
  vi.mocked(jwtVerify).mockResolvedValue({ payload: { sub: newId, email: linkedEmail }, protectedHeader: { alg: "ES256" } } as never);
  expect(await auth.verify(token)).toMatchObject({ userId: newId, email: linkedEmail, tenantId, role: "operator" });
  await database.asAdmin(async (db) => {
    expect(await db.select().from(userAccounts).where(eq(userAccounts.id, oldId))).toHaveLength(0);
    const [active] = await db.select().from(idempotencyRequests).where(eq(idempotencyRequests.userId, newId));
    expect(active.response).toEqual(response);
    const archived = await db.execute(sql`select response from erp_archive.idempotency_keys where user_id=${newId}::uuid`);
    expect(archived.rows[0].response).toEqual(response);
  });
});
