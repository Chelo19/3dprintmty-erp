import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Actor } from "../http/actor";
import { applyMigrations, verifyMigrations } from "./migrations";

export const DB_OPTIONS = "DB_OPTIONS";
export interface DbOptions { dataDir?: string | null }

export function repoRoot(): string {
  for (const candidate of [process.cwd(), join(process.cwd(), "../..")]) {
    if (existsSync(join(candidate, "supabase/migrations/0001_phase0_tenancy.sql"))) return candidate;
  }
  throw new Error("No encuentro supabase/migrations. Ejecuta desde la raíz del repo o desde apps/api.");
}

interface TransactionContext { tx: any; actor: Actor | null }

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  orm!: any;
  driver: "pglite" | "postgres" = "pglite";
  private closer: (() => Promise<void>) | null = null;
  private readonly context = new AsyncLocalStorage<TransactionContext>();

  constructor(private readonly options: DbOptions) {}

  async onModuleInit(): Promise<void> {
    const root = repoRoot();
    if (process.env.DATABASE_URL) {
      const pg = await import("pg");
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const connectionString = process.env.DATABASE_URL;
      const pool = new pg.default.Pool({
        connectionString,
        ssl: connectionString.includes("supabase.co") || connectionString.includes("supabase.com")
          ? { rejectUnauthorized: false } : undefined,
      });
      // pg-pool retira los clientes antes de que termine su cierre de socket.
      // Esperar también el evento end evita conexiones pendientes al apagar.
      const connections = new Set<Promise<void>>();
      pool.on("connect", (client) => {
        const disconnected = new Promise<void>((resolve) => client.once("end", resolve));
        connections.add(disconnected);
        void disconnected.then(() => connections.delete(disconnected));
      });
      pool.on("error", (error) => console.error("Conexión PostgreSQL inactiva falló:", error.message));
      this.driver = "postgres";
      this.closer = async () => {
        await pool.end();
        await Promise.all([...connections]);
      };
      try {
        // El arranque verifica; el comando de despliegue es el único que ejecuta DDL.
        await verifyMigrations(pool, root);
        this.orm = drizzle(pool);
      } catch (error) {
        await this.closer();
        throw error;
      }
      return;
    }
    if (process.env.NODE_ENV === "production") throw new Error("Production requiere DATABASE_URL.");
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dataDir = this.options && "dataDir" in this.options ? this.options.dataDir ?? null : join(root, ".data/pglite");
    if (dataDir) mkdirSync(dataDir, { recursive: true });
    const client = dataDir ? new PGlite(dataDir) : new PGlite();
    this.closer = () => client.close();
    // Solo el entorno local embebido se prepara automáticamente.
    await applyMigrations(client, root, false);
    this.orm = drizzle(client);
  }

  async onModuleDestroy(): Promise<void> { await this.closer?.(); }

  /** Una unidad atómica, compartida por folios, efectos y respuesta idempotente. */
  async atomic<T>(fn: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return fn();
    return this.orm.transaction((tx: any) => this.context.run({ tx, actor: null }, fn));
  }

  async asAdmin<T>(fn: (db: any) => T | Promise<T>): Promise<T> {
    const current = this.context.getStore();
    if (current?.actor) throw new Error("No se permite elevar privilegios dentro de asUser.");
    return fn(current?.tx ?? this.orm);
  }

  async asUser<T>(actor: Actor, fn: (db: any) => T | Promise<T>): Promise<T> {
    if (!actor.tenantId || !actor.role) throw new Error("La sesión no tiene taller.");
    const current = this.context.getStore();
    if (current?.actor) {
      if (current.actor.userId !== actor.userId || current.actor.tenantId !== actor.tenantId || current.actor.role !== actor.role) {
        throw new Error("No se permite cambiar actor dentro de una transacción de usuario.");
      }
      return fn(current.tx);
    }
    return this.atomic(async () => {
      const tx = this.context.getStore()!.tx;
      // READ COMMITTED + mutex transaccional: las siguientes lecturas ven el commit
      // anterior. Todos los procesos de un taller siguen el mismo orden de bloqueo.
      // Distintos talleres no comparten el mutex. PGlite ya serializa transacciones.
      if (this.driver === "postgres") {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`erp:tenant:${actor.tenantId}`}, 0))`);
      }
      const claims = JSON.stringify({ sub: actor.userId, tenant_id: actor.tenantId, role: actor.role,
        ...(actor.impersonator ? { impersonator: actor.impersonator } : {}) });
      await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
      await tx.execute(sql.raw("set local role erp_api"));
      const result = await this.context.run({ tx, actor }, () => fn(tx));
      // Solo se restaura tras éxito; si falla, atomic revierte efectos y SET LOCAL.
      await tx.execute(sql.raw("set local role none"));
      return result;
    });
  }
}
