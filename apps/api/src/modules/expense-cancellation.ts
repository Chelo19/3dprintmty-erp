import { formatQty, qtyFromDb, stockUnitCostMinor } from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import Decimal from "decimal.js";
import { and, eq, gte, lt, or, sql } from "drizzle-orm";
import { expenses, filaments, products, receiptLines, receipts, spools, stockBalances, stockLedgers } from "../db/schema";
import type { TenantActor } from "../http/actor";
import { roundMinor } from "./manufacturing.shared";
import { syncDependentProductCosts } from "./product-cost-sync";
import { one, postStock, type Db } from "./support";

/** Runs inside the expense transaction and tenant write lock. Never deletes source records. */
export async function reverseExpenseInventory(db: Db, actor: TenantActor, expense: typeof expenses.$inferSelect, reason: string) {
  const entries = await db.select({ line: receiptLines, receipt: receipts }).from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId)).where(eq(receipts.expenseId, expense.id));
  const grouped = new Map<string, { productId: string | null; filamentId: string | null; quantity: bigint; value: bigint }>();
  for (const { line, receipt } of entries) {
    const itemCondition = line.filamentId ? eq(stockLedgers.filamentId, line.filamentId) : eq(stockLedgers.productId, line.productId!);
    // Stock is fungible, so availability alone cannot prove this receipt remains unused.
    const [used] = await db.select({ id: stockLedgers.id }).from(stockLedgers).where(and(itemCondition,
      gte(stockLedgers.createdAt, receipt.createdAt), lt(stockLedgers.quantity, "0"),
      or(sql`${stockLedgers.referenceType} is null`, sql`${stockLedgers.referenceType} <> 'expense_cancellation'`))).limit(1);
    if (used) throw new AppError("purchase_stock_used", "No puedes cancelar esta compra: el artículo tiene salidas posteriores. Revisa sus movimientos de inventario.", 409);
    if (line.lotId) {
      const [spool] = await db.select({ id: spools.id }).from(spools).where(eq(spools.lotId, line.lotId)).limit(1);
      if (spool) throw new AppError("purchase_lot_in_use", "No puedes cancelar esta compra: uno de sus lotes está asociado a una bobina.", 409);
    }
    const itemId = line.filamentId ?? line.productId!;
    const key = `${line.filamentId ? "filament" : "product"}:${itemId}`;
    const group = grouped.get(key) ?? { productId: line.productId, filamentId: line.filamentId, quantity: 0n, value: 0n };
    group.quantity += qtyFromDb(line.stockQuantity);
    group.value += BigInt(line.valueMinor);
    grouped.set(key, group);
  }
  // Calculate inverse weighted cost before posting reversals, once per item (including repeated lines).
  for (const group of grouped.values()) {
    const balances = await db.select().from(stockBalances).where(group.filamentId ? eq(stockBalances.filamentId, group.filamentId) : eq(stockBalances.productId, group.productId!));
    const quantity = balances.reduce((sum: bigint, row: { onHand: string }) => sum + qtyFromDb(row.onHand), 0n);
    const remaining = quantity - group.quantity;
    if (remaining < 0n) throw new AppError("negative_stock", "No hay existencias suficientes para revertir esta compra.", 409);
    const item = group.filamentId
      ? await one(db, filaments, filaments.id, group.filamentId, "No encontramos el filamento.")
      : await one(db, products, products.id, group.productId!, "No encontramos el producto.");
    // At zero stock retain the last catalog cost as a reference for the next purchase.
    if (remaining > 0n && item.costMinor !== null) {
      const factor = group.filamentId ? "1000" : (item as typeof products.$inferSelect).uomFactor;
      const value = new Decimal(formatQty(quantity)).mul(stockUnitCostMinor(BigInt(item.costMinor), factor)).minus(group.value.toString());
      const costMinor = roundMinor(Decimal.max(0, value).div(formatQty(remaining)).mul(factor));
      if (group.filamentId) await db.update(filaments).set({ costMinor, updatedAt: new Date() }).where(eq(filaments.id, item.id));
      else await db.update(products).set({ costMinor, updatedAt: new Date() }).where(eq(products.id, item.id));
      await syncDependentProductCosts(db, item.id);
    }
  }
  for (const { line, receipt } of entries) {
    await postStock(db, actor, {
      productId: line.productId, filamentId: line.filamentId, locationId: receipt.locationId,
      kind: "issue", delta: -qtyFromDb(line.stockQuantity), valueMinor: BigInt(line.valueMinor),
      reason: `Cancelación ${expense.folio}: ${reason}`, reference: { type: "expense_cancellation", id: expense.id }, lotId: line.lotId,
    });
  }
}
