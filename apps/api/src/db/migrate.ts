import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./database.service";
import { applyMigrations } from "./migrations";

async function main() {
  const root = repoRoot();
  if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
  const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Define MIGRATION_DATABASE_URL para aplicar migraciones PostgreSQL.");
  const url = new URL(connectionString);
  if (url.hostname.endsWith("pooler.supabase.com") && url.port === "6543") {
    throw new Error("MIGRATION_DATABASE_URL requiere conexión directa o pooler en modo sesión (puerto 5432), no modo transacción.");
  }
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString,
    ssl: connectionString.includes("supabase.co") || connectionString.includes("supabase.com")
      ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  try {
    await applyMigrations(client, root, true);
    console.log("Migraciones verificadas y aplicadas.");
  } finally { await client.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "No se pudieron aplicar las migraciones."); process.exitCode = 1; });
