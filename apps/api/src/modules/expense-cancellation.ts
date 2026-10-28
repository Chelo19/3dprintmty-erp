import { qtyFromDb } from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import { and, eq, gte, lt, or, sql } from "drizzle-orm";
import { expenses, receiptLines, receipts, spools, stockLedgers } from "../db/schema";
import type { TenantActor } from "../http/actor";
import { postStock, type Db } from "./support";

/** Runs inside the expense transaction and tenant write lock. Never deletes source records. */
export async function reverseExpenseInventory(db: Db, actor: TenantActor, expense: typeof expenses.$inferSelect, reason: string) {
  const entries = await db.select({ line: receiptLines, receipt: receipts }).from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId)).where(eq(receipts.expenseId, expense.id));
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
  }
  for (const { line, receipt } of entries) {
    await postStock(db, actor, {
      productId: line.productId, filamentId: line.filamentId, locationId: receipt.locationId,
      kind: "issue", delta: -qtyFromDb(line.stockQuantity), valueMinor: BigInt(line.valueMinor),
      reason: `Cancelación ${expense.folio}: ${reason}`, reference: { type: "expense_cancellation", id: expense.id }, lotId: line.lotId,
    });
  }
}
