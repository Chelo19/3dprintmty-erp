import { EmptyState } from "./empty-state";
import { Notice } from "./notice";
import { Modal } from "./modal";
import { SUPPLY_LABELS, type SupplyMode, uomShort } from "@3dprintmty/domain";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
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
  itemClass: string | null;
  supplyMode: SupplyMode | null;
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
  createdBy: string;
  actorEmail: string | null;
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
  purchase: { kind: "expense" | "receipt"; id: string; folio: string; receiptFolio?: string } | null;
}

const SECTION = {
  filaments: {
    title: "Inventario de filamentos",
    intro: "El filamento entra por Compras. Imprimir no lo descuenta: resta el consumo cuando quieras o haz un conteo físico y el sistema registra la diferencia.",
    empty: "No hay filamentos en el catálogo.",
  },
  supplies: {
    title: "Inventario de insumos",
    intro: "Insumos y materias primas del catálogo. Entran por Compras y salen al fabricar.",
    empty: "No hay insumos en el catálogo.",
  },
  finished: {
    title: "Inventario de productos fabricados",
    intro: "Productos que se abastecen mediante fabricación. Entran al fabricar y salen al entregar un pedido. Los artículos que también se compran aparecen en ambos listados con el mismo inventario.",
    empty: "No hay productos fabricados en el catálogo.",
  },
  resale: {
    title: "Inventario de productos",
    intro: "Productos que se compran para vender. Entran por Compras y salen al entregar un pedido. Los artículos que también se fabrican aparecen en ambos listados con el mismo inventario.",
    empty: "No hay productos de compra para venta en el catálogo.",
  },
} as const;

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
  fabricados: "finished",
  productos: "resale",
};

export function InventoryRedirect({ category }: { category: "fabricados" | "reventa" }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: `/app/inventario/productos/${category}`, search, hash }} replace />;
}

export function InventoryPage({ category }: { category?: "finished" | "resale" }) {
  const params = useParams();
  const section = category ?? SLUG[params.section ?? ""] ?? "filaments";
  const inventory = useQuery({ queryKey: ["inventory-catalog"], queryFn: () => api<Inventory>("/inventory") });
  const copy = SECTION[section];
  const all = rowsFor(section, inventory.data);
  const isFilament = section === "filaments";
  const isProduct = section === "finished" || section === "resale";
  const [itemFilter, setItemFilter] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);
  useEffect(() => {
    if (location.state) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate]);
  useEffect(() => { setItemFilter(""); setHistoryOpen(false); }, [section]);
  useEffect(() => {
    if (!isFilament) setNotice(null);
  }, [isFilament]);
  const { values, set, reset, dirty } = useFilters({ q: "", estado: "active", existencia: "", tipo: "" });
  const bySearch = all.filter((row) =>
    matchesText(values.q, row.sku, row.name)
    && matchesStock(row, values.existencia)
    && (!isProduct || !values.tipo || row.supplyMode === values.tipo));
  const rows = bySearch.filter((row) => matchesStatus(row.status, values.estado));
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div className="inventory-heading"><h1>{copy.title}</h1>
        <button className="ghost" type="button" disabled={!all.length} onClick={() => { setItemFilter(""); setHistoryOpen(true); }}>Ver entradas y salidas</button>
      </div>
      <p>{copy.intro}</p>
      {notice ? <Notice title="Inventario actualizado">{notice}</Notice> : null}
      {inventory.isPending ? <TableSkeleton columns={isProduct ? 7 : isFilament ? 4 : 6} /> : !inventory.data ? <Notice title="No se pudo cargar el inventario" tone="error" action={<button className="ghost" type="button" onClick={() => void inventory.refetch()}>Reintentar</button>}>Intenta nuevamente para consultar las existencias.</Notice> : !all.length ? <EmptyState title="Catálogo vacío" to={section === "filaments" ? "/app/filamentos/nuevo" : section === "supplies" ? "/app/insumos/nuevo" : section === "resale" ? "/app/productos/nuevo?abastecimiento=buy" : "/app/productos/nuevo"} actionLabel={section === "filaments" ? "Crear filamento" : section === "supplies" ? "Crear insumo" : "Crear producto"}>{copy.empty}</EmptyState> : (
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
          {isProduct ? (
            <FilterSelect
              label="Abastecimiento"
              value={values.tipo}
              onChange={(value) => set("tipo", value)}
              options={Object.entries(SUPPLY_LABELS).filter(([mode]) => mode === "both" || mode === (section === "finished" ? "make" : "buy")).map(([value, label]) => ({ value, label }))}
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
              {isProduct ? <th>Abastecimiento</th> : null}
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
                {isProduct ? <td>{row.supplyMode ? SUPPLY_LABELS[row.supplyMode] : "—"}</td> : null}
                {isFilament ? (
                  <td className={Number(row.onHand) <= 0 ? "stock-zero" : undefined}>
                    <strong>{formatKg(Number(row.onHand))}</strong>
                    <div className="costing-hint">{row.onHand} g{Number(row.onHand) > 0 ? ` · ${rollsHint(Number(row.onHand))}` : ""}</div>
                  </td>
                ) : <td>{row.onHand} {uomShort(row.stockUom)}</td>}
                {isFilament ? null : <td>{row.allocated} {uomShort(row.stockUom)}</td>}
                {isFilament ? null : <td>{row.available} {uomShort(row.stockUom)}</td>}
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
                    <IconAction label="Ver entradas y salidas" tone="view" operatorAllowed onClick={() => {
                      setItemFilter(row.id);
                      setHistoryOpen(true);
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
      {historyOpen ? (
        <Modal title="Historial de entradas y salidas" onClose={() => setHistoryOpen(false)}>
          <Movements section={section} items={all} itemFilter={itemFilter} onItemFilter={setItemFilter} />
        </Modal>
      ) : null}
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
      {movements.isPending ? <TableSkeleton columns={isFilament ? 7 : 9} /> : movements.isError ? (
        <Notice title="No se pudo cargar el historial" tone="error" action={<button className="ghost" type="button" onClick={() => void movements.refetch()}>Reintentar</button>}>Intenta nuevamente para consultar las entradas y salidas.</Notice>
      ) : !rows.length ? (
        <Notice title={direction ? "Sin movimientos que coincidan" : "Todavía no hay movimientos"}
          action={direction ? <button className="ghost" type="button" onClick={() => setDirection("")}>Ver entradas y salidas</button> : undefined}>
          {direction ? "No encontramos movimientos con el filtro seleccionado. Prueba mostrando entradas y salidas." : itemFilter ? "Este artículo todavía no tiene entradas ni salidas registradas." : "Todavía no hay entradas ni salidas registradas en este catálogo."}
        </Notice>
      ) : (
        <div className="scroll-x">
        <Paged rows={rows}>
        {(pageRows) => (
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
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
                <td>{row.actorEmail ?? row.createdBy}</td>
                <td>{row.sku} · {row.name}</td>
                <td><span className={`res res-badge mov-${row.direction}`}>{movementLabel(row)}</span></td>
                <td className={row.direction === "in" ? "profit-positive" : "profit-negative"} style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                  {row.direction === "in" ? "+" : ""}{row.quantity} {uomShort(row.stockUom)}
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
                      {row.purchase.kind === "expense" ? <Link to={`/app/compras/gastos/${row.purchase.id}`}>{row.purchase.folio}</Link> : <span>{row.purchase.folio}</span>}
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
  return (section === "finished" ? data.finished : data.resale)
    .map((row) => ({ ...row, kind: row.itemClass ?? row.productType ?? "finished_good", to: `/app/productos/${row.id}` }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}
