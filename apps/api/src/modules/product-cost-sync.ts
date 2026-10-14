import { canManufacture } from "@3dprintmty/domain";
import { eq } from "drizzle-orm";
import { products } from "../db/schema";
import { loadBomIndex, loadProducts, roundMinor, recipeCosts, type BomIndex, type ProductInfo } from "./manufacturing.shared";
import type { Db } from "./support";

export async function captureProductCosts(db: Db) {
  return { index: await loadBomIndex(db), catalog: await loadProducts(db) };
}

/** El costo guardado es una caché; la receta es la fuente de verdad. */
export async function syncDependentProductCosts(db: Db, componentId: string,
  includeRoot = false) {
  const { index, catalog } = await captureProductCosts(db);
  const affected = new Set([componentId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const parent of index.bomIdByProduct.keys()) {
      if (!affected.has(parent) && (index.lookup(parent)?.some((line) => affected.has(line.componentId))
        || index.servicesByProduct.get(parent)?.some((line) => affected.has(line.serviceId)))) {
        affected.add(parent); grew = true;
      }
    }
  }
  if (!includeRoot) affected.delete(componentId);
  for (const id of affected) {
    const current = catalog.get(id);
    if (!current || !canManufacture(current) || !index.lookup(id)?.length) continue;
    const cost = recipeCosts(id, index, catalog);
    const total = cost.missing ? null : roundMinor(cost.total);
    if (total !== current.costMinor) await db.update(products).set({ costMinor: total, updatedAt: new Date() }).where(eq(products.id, id));
  }
}

/** También cubre recetas editadas por producción, que no puede editar el catálogo. */
export async function withRecipeCosts<T extends { id: string; costMinor: bigint | number | string | null }>(db: Db, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const index = await loadBomIndex(db);
  if (!rows.some((row) => index.bomIdByProduct.has(row.id))) return rows;
  const catalog = await loadProducts(db);
  return rows.map((row) => {
    const item = catalog.get(row.id);
    if (!item || !canManufacture(item) || !index.lookup(row.id)?.length) return row;
    const cost = recipeCosts(row.id, index, catalog);
    return { ...row, costMinor: cost.missing ? null : roundMinor(cost.total) };
  });
}
