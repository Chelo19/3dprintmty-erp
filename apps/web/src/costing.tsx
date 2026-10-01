import { Money, uomShort } from "@3dprintmty/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "./api";
import { FormActions, IconAction, PlusIcon, SaveButton, TrashIcon } from "./operations";
import { FormSkeleton } from "./skeleton";

interface CatalogItem {
  id: string;
  sku?: string;
  code?: string;
  name: string;
  productType?: string;
  stockUom?: string;
  unit?: string;
  status?: string;
  cost: string | null;
  salePrice?: string | null;
  pricesHidden?: boolean;
}

interface BomLine {
  componentProductId: string;
  quantity: string;
}

type Kind = "filament" | "supply" | "service";

interface Line {
  key: string;
  kind: Kind;
  itemId: string;
  quantity: string;
  unitPrice: string;
}

/** Lo que la calculadora le pasa a la pantalla de alta de producto. */
export interface CalculatorDraft {
  name: string;
  cost: string;
  salePrice: string;
  recipe: Array<{ componentProductId: string; name: string; quantity: string; uom: string }>;
  services: number;
}

const KIND_LABEL: Record<Kind, string> = { filament: "Filamento", supply: "Insumo", service: "Servicio" };
const DRAFT_KEY = "printmty.costing.draft";

/** Lee un número capturado; vacío, negativo o inválido cuenta como cero. */
function amount(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function pesos(cents: number): string {
  return Money.fromMinor(BigInt(Math.round(cents))).format("es-MX");
}

function qtyText(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}

function newLine(kind: Kind, item?: CatalogItem, quantity = "1"): Line {
  return { key: crypto.randomUUID(), kind, itemId: item?.id ?? "", quantity, unitPrice: item?.salePrice ?? "" };
}

function loadDraft(): { name: string; lines: Line[] } | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null") as { name?: string; lines?: Line[] } | null;
    return stored?.lines?.length ? { name: stored.name ?? "", lines: stored.lines } : null;
  } catch {
    return null;
  }
}

export function clearCalculatorDraft() {
  sessionStorage.removeItem(DRAFT_KEY);
}

export function CostCalculatorPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const productId = params.get("producto") ?? "";
  const products = useQuery({ queryKey: ["products", "all"], queryFn: () => api<{ data: CatalogItem[] }>("/products?limit=100") });
  const filaments = useQuery({ queryKey: ["filaments"], queryFn: () => api<{ data: CatalogItem[] }>("/filaments") });
  const services = useQuery({ queryKey: ["services"], queryFn: () => api<{ data: CatalogItem[] }>("/services") });

  const stored = useRef(productId ? null : loadDraft());
  const [name, setName] = useState(stored.current?.name ?? "");
  const [lines, setLines] = useState<Line[]>(stored.current?.lines ?? []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = (item: CatalogItem) => item.status !== "inactive";
  const finished = (products.data?.data ?? []).filter((item) => item.productType === "finished_good" && active(item));
  const catalogs: Record<Kind, CatalogItem[]> = {
    filament: (filaments.data?.data ?? []).filter(active),
    supply: (products.data?.data ?? []).filter((item) => item.productType === "component" && active(item)),
    service: (services.data?.data ?? []).filter(active),
  };
  const product = finished.find((item) => item.id === productId) ?? null;
  const loaded = Boolean(products.data && filaments.data && services.data);

  const seeded = useRef(Boolean(stored.current));
  useEffect(() => {
    if (!loaded || productId || seeded.current) return;
    seeded.current = true;
    const firstFilament = filaments.data?.data.find(active);
    if (firstFilament) setLines([newLine("filament", firstFilament, "")]);
  }, [loaded, productId, filaments.data]);

  useEffect(() => {
    if (productId) return;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name, lines }));
  }, [name, lines, productId]);

  useEffect(() => {
    if (!productId || !loaded) return;
    let cancelled = false;
    const filamentById = new Map((filaments.data?.data ?? []).map((item) => [item.id, item]));
    const productById = new Map((products.data?.data ?? []).map((item) => [item.id, item]));
    const target = productById.get(productId);
    if (target) setName(target.name);
    void api<{ lines: BomLine[] }>(`/boms/${productId}`)
      .then((bom) => {
        if (cancelled) return;
        setLines(bom.lines.map((line) => {
          const filament = filamentById.get(line.componentProductId);
          return filament
            ? newLine("filament", filament, line.quantity)
            : newLine("supply", productById.get(line.componentProductId), line.quantity);
        }));
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, loaded, filaments.data, products.data]);

  const computed = lines.map((line) => {
    const item = catalogs[line.kind].find((entry) => entry.id === line.itemId);
    const quantity = amount(line.quantity);
    const unitCost = item?.cost ? (amount(item.cost) * 100) / (line.kind === "filament" ? 1000 : 1) : null;
    const cost = unitCost === null ? 0 : quantity * unitCost;
    const revenue = quantity * amount(line.unitPrice) * 100;
    const uom = line.kind === "filament" ? "g" : line.kind === "service" ? item?.unit ?? "servicio" : uomShort(item?.stockUom ?? "EA");
    return { line, item, quantity, cost, revenue, uom, missingCost: Boolean(item && unitCost === null) };
  });

  const groups = (Object.keys(KIND_LABEL) as Kind[])
    .map((kind) => {
      const entries = computed.filter((entry) => entry.line.kind === kind);
      const cost = entries.reduce((sum, entry) => sum + entry.cost, 0);
      const revenue = entries.reduce((sum, entry) => sum + entry.revenue, 0);
      return { kind, count: entries.length, cost, revenue };
    })
    .filter((group) => group.count > 0);
  const totalCost = Math.round(computed.reduce((sum, entry) => sum + entry.cost, 0));
  const totalPrice = Math.round(computed.reduce((sum, entry) => sum + entry.revenue, 0));
  const profit = totalPrice - totalCost;
  const missingCount = computed.filter((entry) => entry.missingCost).length;
  const usable = computed.filter((entry) => entry.item && entry.quantity > 0);
  const costText = (totalCost / 100).toFixed(2);
  const priceText = (totalPrice / 100).toFixed(2);

  function update(key: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      if (patch.kind && patch.kind !== line.kind) {
        const first = catalogs[patch.kind][0];
        next.itemId = first?.id ?? "";
        next.unitPrice = first?.salePrice ?? "";
      } else if (patch.itemId) {
        next.unitPrice = catalogs[next.kind].find((entry) => entry.id === patch.itemId)?.salePrice ?? "";
      }
      return next;
    }));
  }

  function toNewProduct() {
    const recipe = new Map<string, CalculatorDraft["recipe"][number]>();
    for (const entry of usable) {
      if (entry.line.kind === "service" || !entry.item) continue;
      const previous = recipe.get(entry.item.id);
      const quantity = (previous ? amount(previous.quantity) : 0) + entry.quantity;
      recipe.set(entry.item.id, { componentProductId: entry.item.id, name: entry.item.name, quantity: qtyText(quantity), uom: entry.uom });
    }
    const draft: CalculatorDraft = {
      name: name.trim(),
      cost: costText,
      salePrice: totalPrice > 0 ? priceText : "",
      recipe: [...recipe.values()],
      services: usable.filter((entry) => entry.line.kind === "service").length,
    };
    navigate("/app/productos/nuevo", { state: { calculator: draft } });
  }

  async function saveToProduct() {
    if (!product) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api(`/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ cost: costText, ...(totalPrice > 0 && !product.pricesHidden ? { salePrice: priceText } : {}) }),
      });
      await client.invalidateQueries({ queryKey: ["products"] });
      await client.invalidateQueries({ queryKey: ["product", product.id] });
      setMessage(totalPrice > 0 && !product.pricesHidden ? `Guardado: costo ${pesos(totalCost)} y precio ${pesos(totalPrice)}.` : `Costo guardado: ${pesos(totalCost)}.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <FormSkeleton fields={8} />;

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Calculadora de costo</h1>
        <button className="primary new-link" type="button" disabled={!usable.length} onClick={toNewProduct}>
          <PlusIcon />
          Dar de alta como producto
        </button>
      </div>
      <p>Arma un producto terminado como en una cotización: filamentos, insumos y servicios por pieza. Al final tienes su costo, su precio y su margen, y lo puedes dar de alta en el catálogo.</p>
      <article className="card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <label>
            Nombre del producto
            <input value={name} placeholder="Llavero personalizado" onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Recalcular un producto existente
            <select
              value={productId}
              onChange={(event) => {
                setMessage(null);
                setError(null);
                if (!event.target.value) {
                  const draft = loadDraft();
                  setName(draft?.name ?? "");
                  setLines(draft?.lines ?? []);
                }
                setParams(event.target.value ? { producto: event.target.value } : {});
              }}
            >
              <option value="">Producto nuevo</option>
              {finished.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
            </select>
          </label>
        </div>

        <div className="costing-kpis">
          <div><span>Costo por pieza</span><strong>{pesos(totalCost)}</strong></div>
          <div><span>Precio sin IVA</span><strong>{pesos(totalPrice)}</strong></div>
          <div><span>Utilidad</span><strong className={profitClass(profit)}>{pesos(profit)}</strong></div>
          <div><span>Margen</span><strong className={profitClass(profit)}>{marginLabel(totalCost, totalPrice)}</strong></div>
        </div>
        <p className="costing-hint" style={{ margin: 0 }}>Todo es por pieza. Si imprimes varias en una cama, divide los gramos y el tiempo del laminador entre las piezas. El precio es la suma de los importes; lo puedes ajustar al dar de alta.</p>
        {missingCount > 0 ? (
          <p className="costing-warn">
            {missingCount} partida{missingCount === 1 ? "" : "s"} sin costo en el catálogo. El costo real es mayor; captúralo en Filamentos, Insumos o Servicios.
          </p>
        ) : null}

        <div className="scroll-x">
          <table className="calc-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Concepto</th>
                <th>Cantidad</th>
                <th>Precio unitario</th>
                <th>Importe</th>
                <th>Costo unitario</th>
                <th>Costo</th>
                <th>Utilidad</th>
                <th>Margen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {computed.length === 0 ? (
                <tr><td colSpan={10}>Agrega filamentos, insumos o servicios para calcular.</td></tr>
              ) : computed.map(({ line, item, cost, revenue, uom, missingCost }) => {
                const lineProfit = missingCost ? null : Math.round(revenue) - Math.round(cost);
                return (
                  <tr key={line.key}>
                    <td>
                      <select aria-label="Tipo" value={line.kind} onChange={(event) => update(line.key, { kind: event.target.value as Kind })}>
                        {(Object.keys(KIND_LABEL) as Kind[]).map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
                      </select>
                    </td>
                    <td>
                      <select aria-label="Concepto" value={line.itemId} onChange={(event) => update(line.key, { itemId: event.target.value })}>
                        <option value="">Elige</option>
                        {catalogs[line.kind].map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <div className="calc-qty">
                        <input aria-label="Cantidad" inputMode="decimal" placeholder={line.kind === "filament" ? "85" : "1"} value={line.quantity} onChange={(event) => update(line.key, { quantity: event.target.value })} />
                        <span>{uom}</span>
                      </div>
                    </td>
                    <td>
                      <input aria-label="Precio unitario" className="calc-price" inputMode="decimal" placeholder="0.00" value={line.unitPrice} onChange={(event) => update(line.key, { unitPrice: event.target.value })} />
                    </td>
                    <td>{pesos(revenue)}</td>
                    <td>
                      {item?.cost ? `${pesos(amount(item.cost) * 100)}/${line.kind === "filament" ? "kg" : uom}`
                        : missingCost ? <Link className="costing-warn" to={editPath(line.kind, line.itemId)}>Sin costo</Link> : "—"}
                    </td>
                    <td>{missingCost ? "—" : pesos(cost)}</td>
                    <td className={profitClass(lineProfit)}>{lineProfit === null ? "—" : pesos(lineProfit)}</td>
                    <td className={profitClass(lineProfit)}>{missingCost ? "—" : marginLabel(cost, revenue)}</td>
                    <td>
                      <IconAction label="Quitar partida" tone="delete" onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>
                        <TrashIcon />
                      </IconAction>
                    </td>
                  </tr>
                );
              })}
              {groups.map((group) => (
                <tr key={group.kind} className="costing-subtotal">
                  <td colSpan={4}>Total {GROUP_LABEL[group.kind]}</td>
                  <td>{pesos(group.revenue)}</td>
                  <td></td>
                  <td>{pesos(group.cost)}</td>
                  <td className={profitClass(group.revenue - group.cost)}>{pesos(group.revenue - group.cost)}</td>
                  <td className={profitClass(group.revenue - group.cost)}>{marginLabel(group.cost, group.revenue)}</td>
                  <td></td>
                </tr>
              ))}
              {groups.length > 1 ? (
                <tr className="costing-section">
                  <td colSpan={4}>Total por pieza</td>
                  <td>{pesos(totalPrice)}</td>
                  <td></td>
                  <td>{pesos(totalCost)}</td>
                  <td className={profitClass(profit)}>{pesos(profit)}</td>
                  <td className={profitClass(profit)}>{marginLabel(totalCost, totalPrice)}</td>
                  <td></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="ghost" type="button" disabled={!catalogs.filament.length} onClick={() => setLines((current) => [...current, newLine("filament", catalogs.filament[0], "")])}>Agregar filamento</button>
          <button className="ghost" type="button" disabled={!catalogs.supply.length} onClick={() => setLines((current) => [...current, newLine("supply", catalogs.supply[0])])}>Agregar insumo</button>
          <button className="ghost" type="button" disabled={!catalogs.service.length} onClick={() => setLines((current) => [...current, newLine("service", catalogs.service[0])])}>Agregar servicio</button>
        </div>
        {product ? (
          <FormActions>
            <SaveButton pending={saving} label="Guardar costo y precio en el producto" onClick={() => void saveToProduct()} />
            <p className="costing-hint" style={{ margin: 0 }}>
              Hoy: costo {product.cost ? pesos(amount(product.cost) * 100) : "—"}
              {product.pricesHidden ? "" : ` · precio ${product.salePrice ? pesos(amount(product.salePrice) * 100) : "—"}`}
            </p>
            {message ? <p className="costing-ok">{message}</p> : null}
            {error ? <p className="error">{error}</p> : null}
          </FormActions>
        ) : null}
      </article>
    </section>
  );
}

const GROUP_LABEL: Record<Kind, string> = { filament: "filamento", supply: "insumos", service: "servicios" };

function editPath(kind: Kind, id: string): string {
  const base = kind === "filament" ? "filamentos" : kind === "supply" ? "insumos" : "servicios";
  return `/app/${base}/${id}/editar`;
}

function profitClass(cents: number | null) {
  if (cents === null) return undefined;
  if (cents > 0) return "profit-positive";
  if (cents < 0) return "profit-negative";
  return undefined;
}

function marginLabel(costCents: number, revenueCents: number): string {
  if (revenueCents <= 0) return "—";
  return `${(((revenueCents - costCents) / revenueCents) * 100).toFixed(1)}%`;
}

