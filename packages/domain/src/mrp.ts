import { AppError } from "@3dprintmty/shared";
import { lineRequirement, type BomLookup } from "./bom";
import { maxQty } from "./quantity";

export interface MrpSupply {
  productId: string;
  /** Existencia física en todas las sucursales (incluye lo apartado). */
  onHand: bigint;
  /** Pendiente por recibir en órdenes de compra colocadas. */
  incoming: bigint;
  /** Pendiente por terminar en órdenes de producción abiertas. */
  scheduledOutput: bigint;
  /** Existencia mínima que MRP debe proteger. */
  reorderPoint: bigint;
  leadTimeDays: number;
}

export interface MrpDemandSource {
  type: "sales_order" | "production_order" | "planned_make";
  id: string;
  folio: string;
}

export interface MrpDemand {
  productId: string;
  quantity: bigint;
  needBy: Date | null;
  source: MrpDemandSource;
}

export interface MrpRow {
  productId: string;
  level: number;
  grossDemand: bigint;
  onHand: bigint;
  incoming: bigint;
  scheduledOutput: bigint;
  reorderPoint: bigint;
  netShortage: bigint;
  kind: "buy" | "make";
  needBy: Date | null;
  releaseBy: Date | null;
  sources: MrpDemandSource[];
}

const MAX_LEVEL = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Neteo por nivel. La demanda de un pedido que ya tiene OP entra como salida
 * programada del terminado y como requerimiento de material de la OP; el pedido
 * no se vuelve a explotar. Así no hay doble conteo.
 */
export function planRequirements(input: {
  demands: readonly MrpDemand[];
  supply: ReadonlyMap<string, MrpSupply>;
  bom: BomLookup;
}): MrpRow[] {
  const levels = lowLevelCodes(
    [...new Set([...input.demands.map((d) => d.productId), ...input.supply.keys()])],
    input.bom,
  );
  const gross = new Map<string, bigint>();
  const needBy = new Map<string, Date | null>();
  const sources = new Map<string, MrpDemandSource[]>();

  const addDemand = (demand: MrpDemand) => {
    gross.set(demand.productId, (gross.get(demand.productId) ?? 0n) + demand.quantity);
    const current = needBy.get(demand.productId) ?? null;
    if (demand.needBy && (!current || demand.needBy < current)) needBy.set(demand.productId, demand.needBy);
    const list = sources.get(demand.productId) ?? [];
    list.push(demand.source);
    sources.set(demand.productId, list);
  };
  input.demands.forEach(addDemand);

  const ordered = [...levels.entries()].sort((a, b) => a[1] - b[1]);
  const rows: MrpRow[] = [];
  for (const [productId, level] of ordered) {
    const supply = input.supply.get(productId) ?? {
      productId,
      onHand: 0n,
      incoming: 0n,
      scheduledOutput: 0n,
      reorderPoint: 0n,
      leadTimeDays: 0,
    };
    const demand = gross.get(productId) ?? 0n;
    const available = supply.onHand + supply.incoming + supply.scheduledOutput;
    const net = maxQty(0n, demand + supply.reorderPoint - available);
    const lines = input.bom(productId) ?? [];
    const kind = lines.length ? "make" : "buy";
    const date = needBy.get(productId) ?? null;
    if (net > 0n && kind === "make") {
      for (const line of lines) {
        addDemand({
          productId: line.componentId,
          quantity: lineRequirement(net, line),
          needBy: date,
          source: { type: "planned_make", id: productId, folio: "" },
        });
      }
    }
    if (demand === 0n && net === 0n) continue;
    rows.push({
      productId,
      level,
      grossDemand: demand,
      onHand: supply.onHand,
      incoming: supply.incoming,
      scheduledOutput: supply.scheduledOutput,
      reorderPoint: supply.reorderPoint,
      netShortage: net,
      kind,
      needBy: date,
      releaseBy: date ? new Date(date.getTime() - supply.leadTimeDays * DAY_MS) : null,
      sources: sources.get(productId) ?? [],
    });
  }
  return rows;
}

/** Nivel más profundo en el que aparece cada producto dentro de cualquier BOM. */
export function lowLevelCodes(roots: readonly string[], bom: BomLookup): Map<string, number> {
  const levels = new Map<string, number>();
  const visit = (productId: string, level: number, path: Set<string>) => {
    if (level > MAX_LEVEL) throw new AppError("bom_too_deep", "El BOM tiene demasiados niveles.");
    if ((levels.get(productId) ?? -1) >= level) return;
    levels.set(productId, level);
    for (const line of bom(productId) ?? []) {
      if (path.has(line.componentId)) throw new AppError("bom_cycle", "El BOM se contiene a sí mismo.");
      visit(line.componentId, level + 1, new Set(path).add(line.componentId));
    }
  };
  for (const root of roots) visit(root, levels.get(root) ?? 0, new Set([root]));
  return levels;
}
