import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { repoRoot } from "../src/db/database.service";
import { migrationFiles } from "../src/db/migrations";

it("migra una base existente conservando datos fiscales, clasificación y respuestas históricas", async () => {
  const db = new PGlite();
  const root = repoRoot();
  const migration = "20261014210912_simplify_database_foundations.sql";
  const user = "10000000-0000-4000-8000-000000000001";
  const tenant = "10000000-0000-4000-8000-000000000002";
  const rate = "10000000-0000-4000-8000-000000000003";
  try {
    await db.exec(readFileSync(join(root, "supabase/local/auth_stubs.sql"), "utf8"));
    for (const file of migrationFiles(root).filter((file) => file < migration)) {
      await db.exec(readFileSync(join(root, "supabase/migrations", file), "utf8"));
    }
    await db.query("insert into public.user_accounts(id,email) values ($1,'migration@example.test')", [user]);
    await db.query("insert into public.tenants(id,slug,rfc,status) values ($1,'migration','MIG010101AAA','active')", [tenant]);
    await db.query("insert into public.tax_rates(id,tenant_id,name,rate,is_default,created_by) values ($1,$2,'IVA',0.08,true,$3)", [rate, tenant, user]);
    await db.query("insert into public.company_profiles(tenant_id,legal_name,rfc,tax_regime,fiscal_postal_code,default_vat_rate,privacy_accepted_at,created_by) values ($1,'Taller histórico','MIG010101AAA','626','64000',0.08,now(),$2)", [tenant, user]);
    await db.query("insert into public.products(tenant_id,sku,name,product_type,cost_minor,created_by) values ($1,'LEGACY','Artículo existente','resale',125,$2)", [tenant, user]);
    await db.query("insert into public.idempotency_keys(user_id,key,request_hash,response) values ($1,'old-request','old-hash',$2::jsonb)", [user, JSON.stringify({ paymentId: "historical-response", amount: "125.00" })]);
    const before = (await db.query("select rfc,default_vat_rate,updated_at from public.company_profiles")).rows;
    const product = (await db.query("select product_type,item_class,supply_mode,cost_minor,updated_at from public.products")).rows;
    const oldResponse = (await db.query("select * from public.idempotency_keys")).rows;

    await db.exec(readFileSync(join(root, "supabase/migrations", migration), "utf8"));

    expect((await db.query("select p.rfc,r.rate as default_vat_rate,p.updated_at from public.company_profiles p join public.tax_rates r on r.id=p.default_tax_rate_id and r.tenant_id=p.tenant_id")).rows).toEqual(before);
    expect((await db.query("select product_type,item_class,supply_mode,cost_minor,updated_at from public.products")).rows).toEqual(product);
    expect((await db.query("select * from erp_archive.idempotency_keys")).rows).toEqual(oldResponse);
    expect((await db.query("select to_regclass('public.idempotency_keys') as name")).rows[0]).toEqual({ name: null });
    await db.query("insert into public.products(tenant_id,sku,name,item_class,supply_mode,created_by) values ($1,'RAW','Materia prima','raw_material','buy',$2)", [tenant, user]);
    expect((await db.query("select product_type from public.products where sku='RAW'")).rows[0]).toEqual({ product_type: "raw_material" });

    await db.exec("begin; set local role erp_api;");
    try { await expect(db.query("select * from erp_archive.idempotency_keys")).rejects.toMatchObject({ code: "42501" }); }
    finally { await db.exec("rollback"); }
  } finally { await db.close(); }
});
