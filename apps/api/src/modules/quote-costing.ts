import { formatQty, Money, QTY_SCALE, qtyFromDb, roundDiv } from "@3dprintmty/domain";
import { inArray } from "drizzle-orm";
import { filaments, products, serviceOfferings } from "../db/schema";
import type { Db } from "./support";

export interface CostingLineInput {
  id?: string;
  printId: string | null;
  catalogId: string | null;
  lineKind: string;
  description: string;
  uom: string;
  quantity: string;
  netMinor: bigint;
}

export interface CostingPrintInput {
  id: string;
  name: string;
  quantity: string;
}

export interface QuoteCostingLine {
  id: string;
  printId: string | null;
  description: string;
  group: string;
  quantity: string;
  uom: string;
  unitCost: string | null;
  unitBasis: string;
  cost: string | null;
  revenue: string;
  profit: string | null;
}

export interface QuoteCostingTotals {
  label: string;
  cost: string;
  revenue: string;
  profit: string;
}

export interface QuoteCosting {
  lines: QuoteCostingLine[];
  groups: QuoteCostingTotals[];
  prints: Array<QuoteCostingTotals & { id: string; quantity: string; unitCost: string }>;
  cost: string;
  revenue: string;
  profit: string;
  marginPct: string | null;
  missing: number;
}

const GROUP_ORDER = ["Filamento", "Insumos", "Productos", "Servicios"];

interface CatalogCost {
  costMinor: bigint | null;
  group: string;
  perKg: boolean;
}

/** Costo de surtir la cotización con los costos vigentes del catálogo; el ingreso es el importe sin IVA. */
export async function quoteCosting(db: Db, lines: CostingLineInput[], prints: CostingPrintInput[]): Promise<QuoteCosting> {
  const catalog = await loadCatalogCosts(db, lines);
  let totalCost = 0n;
  let totalRevenue = 0n;
  let knownRevenue = 0n;
  let missing = 0;
  const groups = new Map<string, { cost: bigint; revenue: bigint }>();
  const byPrint = new Map<string, { cost: bigint; revenue: bigint }>();

  const mapped = lines.map((line) => {
    const entry = line.catalogId ? catalog.get(line.catalogId) : undefined;
    const group = entry?.group ?? groupFor(line.lineKind, null);
    const qty = qtyFromDb(line.quantity);
    const revenue = BigInt(line.netMinor);
    const cost = entry?.costMinor == null ? null : roundDiv(qty * entry.costMinor, entry.perKg ? QTY_SCALE * 1000n : QTY_SCALE);
    totalRevenue += revenue;
    if (cost === null) {
      missing += 1;
    } else {
      totalCost += cost;
      knownRevenue += revenue;
    }
    const bucket = groups.get(group) ?? { cost: 0n, revenue: 0n };
    bucket.cost += cost ?? 0n;
    bucket.revenue += revenue;
    groups.set(group, bucket);
    if (line.printId) {
      const printBucket = byPrint.get(line.printId) ?? { cost: 0n, revenue: 0n };
      printBucket.cost += cost ?? 0n;
      printBucket.revenue += revenue;
      byPrint.set(line.printId, printBucket);
    }
    return {
      id: line.id ?? "",
      printId: line.printId,
      description: line.description,
      group,
      quantity: formatQty(qty),
      uom: line.uom,
      unitCost: entry?.costMinor == null ? null : major(entry.costMinor),
      unitBasis: entry?.perKg ? "kg" : line.uom,
      cost: cost === null ? null : major(cost),
      revenue: major(revenue),
      profit: cost === null ? null : major(revenue - cost),
    };
  });

  const profit = knownRevenue - totalCost;
  return {
    lines: mapped,
    groups: [...groups.entries()]
      .sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))
      .map(([label, bucket]) => totals(label, bucket)),
    prints: prints.map((print) => {
      const bucket = byPrint.get(print.id) ?? { cost: 0n, revenue: 0n };
      const pieces = qtyFromDb(print.quantity);
      return {
        id: print.id,
        quantity: formatQty(pieces),
        unitCost: major(pieces > 0n ? roundDiv(bucket.cost * QTY_SCALE, pieces) : 0n),
        ...totals(print.name, bucket),
      };
    }),
    cost: major(totalCost),
    revenue: major(totalRevenue),
    profit: major(profit),
    marginPct: knownRevenue > 0n ? (Number((profit * 1000n) / knownRevenue) / 10).toFixed(1) : null,
    missing,
  };
}

async function loadCatalogCosts(db: Db, lines: CostingLineInput[]): Promise<Map<string, CatalogCost>> {
  const idsOf = (match: (kind: string) => boolean) => [
    ...new Set(lines.filter((line) => line.catalogId && match(line.lineKind)).map((line) => line.catalogId as string)),
  ];
  const filamentIds = idsOf((kind) => kind === "filament");
  const serviceIds = idsOf((kind) => kind === "service");
  const productIds = idsOf((kind) => kind !== "filament" && kind !== "service");
  const result = new Map<string, CatalogCost>();

  if (filamentIds.length) {
    const rows = await db.select({ id: filaments.id, costMinor: filaments.costMinor }).from(filaments).where(inArray(filaments.id, filamentIds));
    for (const row of rows) result.set(row.id, { costMinor: nullableMinor(row.costMinor), group: "Filamento", perKg: true });
  }
  if (serviceIds.length) {
    const rows = await db
      .select({ id: serviceOfferings.id, costMinor: serviceOfferings.costMinor })
      .from(serviceOfferings)
      .where(inArray(serviceOfferings.id, serviceIds));
    for (const row of rows) result.set(row.id, { costMinor: nullableMinor(row.costMinor), group: "Servicios", perKg: false });
  }
  if (productIds.length) {
    const rows = await db
      .select({ id: products.id, costMinor: products.costMinor, productType: products.productType })
      .from(products)
      .where(inArray(products.id, productIds));
    for (const row of rows) {
      result.set(row.id, { costMinor: nullableMinor(row.costMinor), group: groupFor("product", row.productType), perKg: false });
    }
  }
  return result;
}

function groupFor(lineKind: string, productType: string | null): string {
  if (lineKind === "filament") return "Filamento";
  if (lineKind === "service") return "Servicios";
  return productType === "component" ? "Insumos" : "Productos";
}

function totals(label: string, bucket: { cost: bigint; revenue: bigint }): QuoteCostingTotals {
  return { label, cost: major(bucket.cost), revenue: major(bucket.revenue), profit: major(bucket.revenue - bucket.cost) };
}

function nullableMinor(value: bigint | number | string | null): bigint | null {
  return value === null || value === undefined ? null : BigInt(value);
}

function major(minor: bigint): string {
  return Money.fromMinor(minor).toMajor();
}
