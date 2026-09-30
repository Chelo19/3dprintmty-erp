import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "./api";
import { formatKg, rollsHint } from "./filament-stock";
import { FilterBar, FilterSelect, NoMatches, StatusBadge, matchesStatus, matchesText, useFilters } from "./filters";
import { IconAction } from "./operations";
import { TableSkeleton } from "./skeleton";
import { Paged } from "./pager";

interface StockItem {
  id: string;
  sku: string;
  name: string;
  stockUom: string;
  status: string;
  productType: string | null;
  onHand: string;
  allocated: string;
  available: string;
}

interface Inventory {
  finished: StockItem[];
  resale: StockItem[];
  supplies: StockItem[];
  filaments: StockItem[];
}

interface Movement {
  id: string;
  createdAt: string;
  kind: string;
  direction: "in" | "out";
  quantity: string;
  reason: string;
  productId: string;
  sku: string;
  name: string;
  stockUom: string;
  locationName: string;
  production: { id: string; folio: string } | null;
  salesOrder: { id: string; folio: string; customerName: string | null } | null;
  purchase: { kind: "expense" | "purchase_order"; id: string; folio: string; receiptFolio?: string } | null;
}

const SECTION = {
  filaments: {
    title: "Inventario de filamentos",
    intro: "El filamento entra por Compras. Imprimir no lo descuenta: resta el consumo cuando quieras o haz un conteo físico y el sistema registra la diferencia.",
    empty: "No hay filamentos en el catálogo.",
  },
  supplies: {
    title: "Inventario de insumos",
    intro: "Insumos del catálogo. Entran por un gasto en Compras y salen al fabricar.",
    empty: "No hay insumos en el catálogo.",
  },
  products: {
    title: "Inventario de productos",
    intro: "Productos terminados y revendidos. El terminado entra al fabricarlo; el revendido, al comprarlo. Salen al embarcar un pedido.",
    empty: "No hay productos terminados ni revendidos en el catálogo.",
  },
} as const;

const KIND: Record<string, string> = {
  finished_good: "Terminado",
  resale: "Revendido",
};

const MOVEMENT: Record<string, string> = {
  receipt: "Entrada",
  issue: "Salida",
  adjustment: "Ajuste",
  scrap: "Merma",
  transfer: "Traspaso",
};

const SLUG: Record<string, keyof typeof SECTION> = {
  filamentos: "filaments",
  insumos: "supplies",
  productos: "products",
};

export function InventoryPage() {
  const params = useParams();
  const section = SLUG[params.section ?? ""] ?? "filaments";
  const inventory = useQuery({ queryKey: ["inventory-catalog"], queryFn: () => api<Inventory>("/inventory") });
  const copy = SECTION[section];
  const all = rowsFor(section, inventory.data);
  const isFilament = section === "filaments";
  const [itemFilter, setItemFilter] = useState("");
  const movementsRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);
  useEffect(() => {
    if (location.state) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate]);
  useEffect(() => setItemFilter(""), [section]);
  useEffect(() => {
    if (!isFilament) setNotice(null);
  }, [isFilament]);
  const { values, set, reset, dirty } = useFilters({ q: "", estado: "active", existencia: "", tipo: "" });
  const statusRows = all.filter((row) => matchesStatus(row.status, values.estado));
  const bySearch = all.filter((row) =>
    matchesText(values.q, row.sku, row.name)
    && matchesStock(row, values.existencia)
    && (section !== "products" || !values.tipo || row.kind === values.tipo));
  const rows = bySearch.filter((row) => matchesStatus(row.status, values.estado));
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>{copy.title}</h1>
      <p>{copy.intro}</p>
      {notice ? <p className="muted-note">{notice}</p> : null}
      {inventory.isPending ? <TableSkeleton columns={section === "products" ? 7 : isFilament ? 4 : 6} /> : !inventory.data ? <p className="error">No se pudo cargar el inventario.</p> : !all.length ? <p>{copy.empty}</p> : (
        <>
        <FilterBar
          search={values.q}
          onSearch={(value) => set("q", value)}
          placeholder="SKU o nombre"
          status={values.estado}
          onStatus={(value) => set("estado", value)}
          hiddenInactive={values.estado === "active" ? bySearch.length - rows.length : 0}
          dirty={dirty}
          onClear={reset}
        >
          <FilterSelect
            label="Existencia"
            value={values.existencia}
            onChange={(value) => set("existencia", value)}
            options={[
              { value: "con", label: "Con existencia" },
              { value: "sin", label: "Sin existencia" },
              ...(isFilament ? [] : [{ value: "apartado", label: "Con apartado" }]),
            ]}
          />
          {section === "products" ? (
            <FilterSelect
              label="Tipo"
              value={values.tipo}
              onChange={(value) => set("tipo", value)}
              options={[{ value: "finished_good", label: "Terminado" }, { value: "resale", label: "Revendido" }]}
            />
          ) : null}
        </FilterBar>
        {!rows.length ? <NoMatches onClear={reset} /> : (
        <Paged rows={rows}>
        {(pageRows) => (
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Nombre</th>
              {section === "products" ? <th>Tipo</th> : null}
              <th>Existencia</th>
              {isFilament ? null : <th>Apartado</th>}
              {isFilament ? null : <th>Disponible</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id}>
                <td>{row.sku}</td>
                <td>
                  <Link to={row.to}>{row.name}</Link>
                  {row.status === "inactive" ? <> <StatusBadge status={row.status} /></> : null}
                </td>
                {section === "products" ? <td>{KIND[row.kind] ?? row.kind}</td> : null}
                {isFilament ? (
                  <td className={Number(row.onHand) <= 0 ? "stock-zero" : undefined}>
                    <strong>{formatKg(Number(row.onHand))}</strong>
                    <div className="costing-hint">{row.onHand} g{Number(row.onHand) > 0 ? ` · ${rollsHint(Number(row.onHand))}` : ""}</div>
                  </td>
                ) : <td>{row.onHand} {row.stockUom}</td>}
                {isFilament ? null : <td>{row.allocated} {row.stockUom}</td>}
                {isFilament ? null : <td>{row.available} {row.stockUom}</td>}
                <td>
                  <div className="record-actions">
                    {isFilament ? (
                      <>
                        <IconAction label="Restar consumo" tone="warn" disabled={Number(row.onHand) <= 0} onClick={() => navigate(`/app/inventario/filamentos/${row.id}/ajustar`)}>
                          <MinusIcon />
                        </IconAction>
                        <IconAction label="Conteo físico" tone="edit" onClick={() => navigate(`/app/inventario/filamentos/${row.id}/ajustar?modo=conteo`)}>
                          <CountIcon />
                        </IconAction>
                      </>
                    ) : null}
                    <IconAction label="Ver entradas y salidas" tone="view" onClick={() => {
                      setItemFilter(row.id);
                      movementsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}>
                      <HistoryIcon />
                    </IconAction>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        </Paged>
        )}
        </>
      )}
      <div ref={movementsRef} style={{ display: "grid", gap: 12 }}>
        <Movements section={section} items={statusRows} itemFilter={itemFilter} onItemFilter={setItemFilter} />
      </div>
    </section>
  );
}

function Movements({
  section,
  items,
  itemFilter,
  onItemFilter,
}: {
  section: keyof typeof SECTION;
  items: Array<{ id: string; sku: string; name: string }>;
  itemFilter: string;
  onItemFilter: (id: string) => void;
}) {
  const [direction, setDirection] = useState("");
  const isFilament = section === "filaments";
  const movements = useQuery({
    queryKey: ["inventory-ledger", section, itemFilter],
    queryFn: () => api<{ data: Movement[] }>(`/inventory/ledger?section=${section}${itemFilter ? `&productId=${itemFilter}` : ""}`),
  });
  const visible = new Set(items.map((item) => item.id));
  const rows = (movements.data?.data ?? []).filter((row) =>
    (!direction || row.direction === direction) && (itemFilter || visible.has(row.productId)));
  return (
    <>
      <h2 style={{ margin: 0 }}>Entradas y salidas</h2>
      <p style={{ margin: 0 }}>
        {isFilament
          ? "Cada entrada por compra y cada consumo o conteo, con su fecha y motivo."
          : "Cada movimiento con su fecha y el documento que lo originó: la orden de producción, el pedido al que se entregó o la compra."}
      </p>
      <div className="filters">
        <label>
          Artículo
          <select value={itemFilter} onChange={(event) => onItemFilter(event.target.value)}>
            <option value="">Todos</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
          </select>
        </label>
        <label>
          Movimiento
          <select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="">Entradas y salidas</option>
            <option value="in">Solo entradas</option>
            <option value="out">Solo salidas</option>
          </select>
        </label>
      </div>
      {movements.isPending ? <TableSkeleton columns={isFilament ? 6 : 8} /> : !rows.length ? <p>Todavía no hay movimientos{itemFilter ? " de este artículo" : ""}.</p> : (
        <div className="scroll-x">
        <Paged rows={rows}>
        {(pageRows) => (
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Artículo</th>
              <th>Movimiento</th>
              <th>Cantidad</th>
              {isFilament ? null : <th>Producción</th>}
              {isFilament ? null : <th>Pedido</th>}
              <th>Compra</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id}>
                <td style={{ whiteSpace: "nowrap" }}>{formatDate(row.createdAt)}</td>
                <td>{row.sku} · {row.name}</td>
                <td><span className={`res res-badge mov-${row.direction}`}>{movementLabel(row)}</span></td>
                <td className={row.direction === "in" ? "profit-positive" : "profit-negative"} style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                  {row.direction === "in" ? "+" : ""}{row.quantity} {row.stockUom}
                </td>
                {isFilament ? null : <td>{row.production ? <Link to={`/app/produccion/${row.production.id}`}>{row.production.folio}</Link> : "—"}</td>}
                {isFilament ? null : (
                  <td>
                    {row.salesOrder ? (
                      <>
                        <Link to={`/app/pedidos/${row.salesOrder.id}`}>{row.salesOrder.folio}</Link>
                        {row.salesOrder.customerName ? <div className="costing-hint">{row.salesOrder.customerName}</div> : null}
                      </>
                    ) : "—"}
                  </td>
                )}
                <td>
                  {row.purchase ? (
                    <>
                      <Link to={row.purchase.kind === "expense" ? `/app/compras/gastos/${row.purchase.id}` : `/app/compras/${row.purchase.id}`}>{row.purchase.folio}</Link>
                      {row.purchase.receiptFolio ? <div className="costing-hint">{row.purchase.receiptFolio}</div> : null}
                    </>
                  ) : "—"}
                </td>
                <td className="costing-hint">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        </Paged>
        </div>
      )}
    </>
  );
}

function movementLabel(row: Movement): string {
  if (row.kind === "adjustment") return row.direction === "in" ? "Ajuste +" : "Ajuste −";
  return MOVEMENT[row.kind] ?? row.kind;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" });
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </svg>
  );
}

function CountIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <path d="m9 13 2 2 4-4" />
    </svg>
  );
}

function matchesStock(row: StockItem, filter: string) {
  if (filter === "con") return Number(row.onHand) > 0;
  if (filter === "sin") return Number(row.onHand) <= 0;
  if (filter === "apartado") return Number(row.allocated) > 0;
  return true;
}

function rowsFor(section: keyof typeof SECTION, data: Inventory | undefined) {
  if (!data) return [];
  if (section === "filaments") {
    return data.filaments.map((row) => ({ ...row, kind: "filament", to: `/app/filamentos/${row.id}` }));
  }
  if (section === "supplies") {
    return (data.supplies ?? []).map((row) => ({ ...row, kind: "component", to: `/app/insumos/${row.id}` }));
  }
  return [...data.finished, ...data.resale]
    .map((row) => ({ ...row, kind: row.productType ?? "finished_good", to: `/app/productos/${row.id}` }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}
