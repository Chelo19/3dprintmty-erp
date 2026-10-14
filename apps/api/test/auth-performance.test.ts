import "reflect-metadata";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import { DatabaseService } from "../src/db/database.service";
import { AuthService } from "../src/modules/auth.service";
import { tenantMemberships, tenants, userAccounts } from "../src/db/schema";

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
    await db.insert(tenants).values({ id: tenantId, slug: "performance", rfc: "PER010101AAA", countryCode: "MX", status: "active" });
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
