import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface MigrationClient {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
  exec?(text: string): Promise<unknown>;
}

export function migrationFiles(root: string): string[] {
  return readdirSync(join(root, "supabase/migrations"))
    .filter((file) => /^(?:\d{4}|\d{14})_[a-z0-9_]+\.sql$/.test(file)).sort();
}

const checksum = (source: string) => createHash("sha256").update(source).digest("hex");

export async function verifyMigrations(client: MigrationClient, root: string): Promise<void> {
  let applied: { rows: Record<string, unknown>[] };
  try { applied = await client.query("select id, checksum from public.schema_migrations"); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "42P01" || code === "42703") throw new Error("Falta preparar el esquema. Ejecuta npm run db:migrate antes de iniciar la API.");
    throw error;
  }
  const byId = new Map(applied.rows.map((row) => [String(row.id), row.checksum]));
  for (const file of migrationFiles(root)) {
    const id = file.replace(/\.sql$/, "");
    if (!byId.has(id)) throw new Error(`Migración pendiente: ${id}. Ejecuta npm run db:migrate antes de iniciar la API.`);
    const stored = byId.get(id);
    if (stored && stored !== checksum(readFileSync(join(root, "supabase/migrations", file), "utf8"))) {
      throw new Error(`La migración aplicada ${id} cambió. Crea otra migración; no edites su historial.`);
    }
  }
}

/** PostgreSQL: llamar con una conexión dedicada, nunca con Pool.query. */
export async function applyMigrations(client: MigrationClient, root: string, postgres: boolean): Promise<void> {
  if (postgres) await client.query("select pg_advisory_lock(734329, 1)");
  try {
    const auth = await client.query("select to_regprocedure('auth.jwt()')::text as name");
    if (!auth.rows[0]?.name) await execute(client, readFileSync(join(root, "supabase/local/auth_stubs.sql"), "utf8"));
    const exists = await client.query("select to_regclass('public.schema_migrations')::text as name");
    if (exists.rows[0]?.name) await client.query("alter table public.schema_migrations add column if not exists checksum text");
    for (const file of migrationFiles(root)) {
      const id = file.replace(/\.sql$/, "");
      const source = readFileSync(join(root, "supabase/migrations", file), "utf8");
      const digest = checksum(source);
      const journal = await client.query("select to_regclass('public.schema_migrations')::text as name");
      const applied = journal.rows[0]?.name
        ? await client.query(`select checksum from public.schema_migrations where id = '${id}'`)
        : { rows: [] };
      if (applied.rows[0]?.checksum && applied.rows[0].checksum !== digest) {
        throw new Error(`La migración aplicada ${id} cambió.`);
      }
      if (!applied.rows.length) await execute(client, source);
      // Baseline explícito para las migraciones anteriores, que no tenían checksum.
      await client.query("alter table public.schema_migrations add column if not exists checksum text");
      await client.query(`update public.schema_migrations set checksum = '${digest}' where id = '${id}' and checksum is null`);
    }
    await verifyMigrations(client, root);
  } catch (error) {
    if (postgres) await client.query("rollback");
    throw error;
  } finally {
    if (postgres) await client.query("select pg_advisory_unlock(734329, 1)");
  }
}

async function execute(client: MigrationClient, source: string): Promise<void> {
  if (client.exec) await client.exec(source);
  else await client.query(source);
}
