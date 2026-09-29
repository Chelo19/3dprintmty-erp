import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Actor } from "../http/actor";

export const DB_OPTIONS = "DB_OPTIONS";

export interface DbOptions {
  dataDir?: string | null;
}

export function repoRoot(): string {
  const candidates = [process.cwd(), join(process.cwd(), "../..")];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "supabase/migrations/0001_phase0_tenancy.sql"))) {
      return candidate;
    }
  }
  throw new Error("No encuentro supabase/migrations. Ejecuta desde la raíz del repo o desde apps/api.");
}

type Queryable = {
  query: (text: string) => Promise<{ rows: Record<string, unknown>[] }>;
  exec?: (text: string) => Promise<unknown>;
};

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  orm!: any;
  driver: "pglite" | "postgres" = "pglite";
  private closer: (() => Promise<void>) | null = null;

  constructor(private readonly options: DbOptions) {}

  async onModuleInit(): Promise<void> {
    const root = repoRoot();
    const stubs = readFileSync(join(root, "supabase/local/auth_stubs.sql"), "utf8");

    if (process.env.DATABASE_URL) {
      const pg = await import("pg");
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const connectionString = process.env.DATABASE_URL;
      const pool = new pg.default.Pool({
        connectionString,
        ssl: connectionString.includes("supabase.co") || connectionString.includes("supabase.com")
          ? { rejectUnauthorized: false }
          : undefined,
      });
      this.driver = "postgres";
      this.closer = async () => {
        await pool.end();
      };
      await this.applyPending(pool, stubs, root);
      this.orm = drizzle(pool);
      return;
    }

    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dataDir = this.resolveDataDir(root);
    if (dataDir) mkdirSync(dataDir, { recursive: true });
    const client = dataDir ? new PGlite(dataDir) : new PGlite();
    this.driver = "pglite";
    this.closer = async () => {
      await client.close();
    };
    await this.applyPending(client, stubs, root);
    this.orm = drizzle(client);
  }

  async onModuleDestroy(): Promise<void> {
    await this.closer?.();
  }

  async asAdmin(fn: (db: any) => any): Promise<any> {
    return fn(this.orm);
  }

  async asUser(actor: Actor, fn: (db: any) => any): Promise<any> {
    if (!actor.tenantId || !actor.role) {
      throw new Error("La sesión no tiene taller.");
    }
    const claims = JSON.stringify({
      sub: actor.userId,
      tenant_id: actor.tenantId,
      role: actor.role,
      ...(actor.impersonator ? { impersonator: actor.impersonator } : {}),
    });
    return this.orm.transaction(async (tx: any) => {
      await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
      await tx.execute(sql.raw("set local role authenticated"));
      return fn(tx);
    });
  }

  private resolveDataDir(root: string): string | null {
    if (this.options && "dataDir" in this.options) {
      return this.options.dataDir ?? null;
    }
    return join(root, ".data/pglite");
  }

  private async applyPending(client: Queryable, stubs: string, root: string): Promise<void> {
    const auth = await client.query("select to_regprocedure('auth.jwt()')::text as name");
    if (!auth.rows[0]?.name) {
      await this.exec(client, stubs);
    }
    const files = readdirSync(join(root, "supabase/migrations"))
      .filter((file) => /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(file))
      .sort();
    for (const file of files) {
      const id = file.replace(/\.sql$/, "");
      if (await this.migrationApplied(client, id)) continue;
      await this.exec(client, readFileSync(join(root, "supabase/migrations", file), "utf8"));
    }
  }

  private async migrationApplied(client: Queryable, id: string): Promise<boolean> {
    try {
      const found = await client.query(
        `select id from public.schema_migrations where id = '${id}'`,
      );
      return found.rows.length > 0;
    } catch {
      return false;
    }
  }

  private async exec(client: Queryable, statement: string): Promise<void> {
    if (client.exec) {
      await client.exec(statement);
      return;
    }
    await client.query(statement);
  }
}
