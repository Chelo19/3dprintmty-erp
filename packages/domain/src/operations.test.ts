import { describe, expect, it } from "vitest";
import {
  createsBomCycle,
  directRequirements,
  explodeToLeaves,
  extendCostMinor,
  lineRequirement,
  rollupUnitCostMinor,
  stockUnitCostMinor,
  type BomLine,
} from "./bom";
import { planRequirements, type MrpSupply } from "./mrp";
import { formatQty, mulQty, parseQty, QTY_SCALE } from "./quantity";
import {
  countsAsIncoming,
  qcOutcome,
  requiresInspection,
  spoolStateAfterUse,
  transitionPlannedOrder,
  transitionProductionOrder,
  transitionPurchaseOrder,
} from "./states";

const q = parseQty;

function lookupFrom(table: Record<string, BomLine[]>) {
  return (productId: string) => table[productId];
}

function supply(productId: string, overrides: Partial<MrpSupply> = {}): MrpSupply {
  return { productId, onHand: 0n, incoming: 0n, scheduledOutput: 0n, reorderPoint: 0n, leadTimeDays: 0, ...overrides };
}

describe("cantidades", () => {
  it("lee y escribe cuatro decimales sin float", () => {
    expect(formatQty(q("0.1") + q("0.2"))).toBe("0.3");
    expect(formatQty(q("500.0000"))).toBe("500");
    expect(() => q("1.23456")).toThrow(/cantidad/);
  });

  it("multiplica y redondea a la cuarta cifra", () => {
    expect(formatQty(mulQty(q("2"), q("120")))).toBe("240");
    expect(formatQty(mulQty(q("0.3333"), q("3")))).toBe("0.9999");
  });
});

describe("BOM", () => {
  const bom = lookupFrom({
    llavero: [{ componentId: "pla", quantity: q("120"), scrapPct: q("5") }],
    kit: [
      { componentId: "llavero", quantity: q("2"), scrapPct: 0n },
      { componentId: "caja", quantity: q("1"), scrapPct: 0n },
    ],
  });

  it("aplica la merma sobre el requerimiento", () => {
    expect(formatQty(lineRequirement(q("2"), { componentId: "pla", quantity: q("120"), scrapPct: q("5") }))).toBe("252");
    expect(formatQty(directRequirements("llavero", q("2"), bom).get("pla")!)).toBe("252");
  });

  it("explota varios niveles hasta el material", () => {
    const leaves = explodeToLeaves("kit", q("1"), bom);
    expect(formatQty(leaves.get("pla")!)).toBe("252");
    expect(formatQty(leaves.get("caja")!)).toBe("1");
    expect(leaves.has("llavero")).toBe(false);
  });

  it("detecta un ciclo antes de guardarlo", () => {
    expect(createsBomCycle("llavero", ["kit"], bom)).toBe(true);
    expect(createsBomCycle("kit", ["pla"], bom)).toBe(false);
  });

  it("suma el costo de material por pieza desde MXN/kg", () => {
    const pla = stockUnitCostMinor(25_000n, "1000");
    expect(pla.toString()).toBe("25");
    const perPiece = rollupUnitCostMinor("llavero", bom, (id) => (id === "pla" ? pla : stockUnitCostMinor(null, "1")));
    expect(extendCostMinor(QTY_SCALE, perPiece)).toBe(3_150n);
    expect(extendCostMinor(q("2"), perPiece)).toBe(6_300n);
  });
});

describe("MRP", () => {
  const bom = lookupFrom({
    llavero: [{ componentId: "pla", quantity: q("120"), scrapPct: q("5") }],
  });

  it("planea fabricar el terminado y comprar el faltante de filamento", () => {
    const rows = planRequirements({
      demands: [{ productId: "llavero", quantity: q("2"), needBy: null, source: { type: "sales_order", id: "p1", folio: "PED-1" } }],
      supply: new Map([["pla", supply("pla", { onHand: q("100") })]]),
      bom,
    });
    const fg = rows.find((row) => row.productId === "llavero")!;
    const pla = rows.find((row) => row.productId === "pla")!;
    expect(fg.kind).toBe("make");
    expect(formatQty(fg.netShortage)).toBe("2");
    expect(pla.kind).toBe("buy");
    expect(formatQty(pla.grossDemand)).toBe("252");
    expect(formatQty(pla.netShortage)).toBe("152");
  });

  it("no cuenta dos veces un pedido que ya tiene orden de producción", () => {
    const rows = planRequirements({
      demands: [
        { productId: "llavero", quantity: q("2"), needBy: null, source: { type: "sales_order", id: "p1", folio: "PED-1" } },
        { productId: "pla", quantity: q("252"), needBy: null, source: { type: "production_order", id: "op1", folio: "OP-1" } },
      ],
      supply: new Map([
        ["llavero", supply("llavero", { scheduledOutput: q("2") })],
        ["pla", supply("pla", { onHand: q("100") })],
      ]),
      bom,
    });
    const fg = rows.find((row) => row.productId === "llavero")!;
    const pla = rows.find((row) => row.productId === "pla")!;
    expect(fg.netShortage).toBe(0n);
    expect(formatQty(pla.grossDemand)).toBe("252");
    expect(formatQty(pla.netShortage)).toBe("152");
  });

  it("descuenta lo que viene en camino y protege el punto de reorden", () => {
    const rows = planRequirements({
      demands: [{ productId: "pla", quantity: q("300"), needBy: new Date("2026-10-10"), source: { type: "production_order", id: "op1", folio: "OP-1" } }],
      supply: new Map([["pla", supply("pla", { onHand: q("100"), incoming: q("250"), reorderPoint: q("200"), leadTimeDays: 5 })]]),
      bom,
    });
    const pla = rows[0]!;
    expect(formatQty(pla.netShortage)).toBe("150");
    expect(pla.releaseBy?.toISOString().slice(0, 10)).toBe("2026-10-05");
  });

  it("explota subensambles por nivel", () => {
    const deep = lookupFrom({
      kit: [{ componentId: "llavero", quantity: q("2"), scrapPct: 0n }],
      llavero: [{ componentId: "pla", quantity: q("120"), scrapPct: 0n }],
    });
    const rows = planRequirements({
      demands: [{ productId: "kit", quantity: q("1"), needBy: null, source: { type: "sales_order", id: "p1", folio: "PED-1" } }],
      supply: new Map([["llavero", supply("llavero", { onHand: q("1") })]]),
      bom: deep,
    });
    expect(formatQty(rows.find((row) => row.productId === "llavero")!.netShortage)).toBe("1");
    expect(formatQty(rows.find((row) => row.productId === "pla")!.netShortage)).toBe("120");
  });
});

describe("estados de operación", () => {
  it("libera una OP y permite arrancar sin programar", () => {
    expect(transitionProductionOrder("draft", "released").ok).toBe(true);
    expect(transitionProductionOrder("released", "in_progress").ok).toBe(true);
    expect(transitionProductionOrder("completed", "in_progress").ok).toBe(false);
  });

  it("recibe una OC por partes y solo cuenta lo colocado como suministro", () => {
    expect(transitionPurchaseOrder("draft", "received").ok).toBe(false);
    expect(transitionPurchaseOrder("ordered", "partially_received").ok).toBe(true);
    expect(transitionPurchaseOrder("partially_received", "received").ok).toBe(true);
    expect(countsAsIncoming("draft")).toBe(false);
    expect(countsAsIncoming("ordered")).toBe(true);
  });

  it("no libera dos veces una orden planeada", () => {
    expect(transitionPlannedOrder("planned", "firmed").ok).toBe(true);
    expect(transitionPlannedOrder("released", "cancelled").ok).toBe(false);
  });

  it("marca vacío el rollo por debajo de 5 g", () => {
    expect(spoolStateAfterUse(q("4.9"), QTY_SCALE)).toBe("empty");
    expect(spoolStateAfterUse(q("5"), QTY_SCALE)).toBe("in_use");
  });

  it("bloquea el terminado si la inspección falla en modo bloqueo", () => {
    expect(requiresInspection("basic", "block")).toBe(true);
    expect(requiresInspection("off", "block")).toBe(false);
    expect(qcOutcome("block", "fail", undefined).ok).toBe(false);
    const rework = qcOutcome("block", "fail", "rework");
    expect(rework.ok && rework.value).toBe("rework");
    const warn = qcOutcome("warn", "fail", undefined);
    expect(warn.ok && warn.value).toBe("complete");
  });
});
