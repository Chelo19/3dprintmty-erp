import { and, eq, getTableColumns } from "drizzle-orm";
import { companyProfiles, taxRates } from "../db/schema";
import type { Db } from "./support";

/** Conserva el contrato fiscal de la API con una sola tasa almacenada. */
export async function loadCompanyProfile(db: Db) {
  const [profile] = await db.select({ ...getTableColumns(companyProfiles), defaultVatRate: taxRates.rate })
    .from(companyProfiles)
    .innerJoin(taxRates, and(eq(taxRates.id, companyProfiles.defaultTaxRateId), eq(taxRates.tenantId, companyProfiles.tenantId)))
    .limit(1);
  return profile as (typeof companyProfiles.$inferSelect & { defaultVatRate: string }) | undefined;
}
