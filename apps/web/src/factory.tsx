import { ProductionMaterialReview } from "./production-material-review";
import { useRecordActions } from "./use-record-actions";
import { finishProduction } from "./production-actions";
import { Modal } from "./modal";
import { Notice } from "./notice";
import { EmptyState } from "./empty-state";
import { BackLink } from "./back-control";
import { canManufacture } from "@3dprintmty/domain";
import { uomShort } from "@3dprintmty/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CostOnly } from "./margin";
import { useRole } from "./roles";
import { api, postJson } from "./api";
import { FilterBar, FilterSelect, NoMatches, StatusBadge, matchesStatus, matchesText, useFilters } from "./filters";
import { BanIcon, CheckIcon, IconAction, PencilIcon, PlusIcon, QuoteButton, TrashIcon, ViewLink, money, useError } from "./operations";
import { DetailSkeleton, TableSkeleton } from "./skeleton";
import { Paged } from "./pager";

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 } as const;

const ORDER_STATUS: Record<string, string> = {
  draft: "Borrador",
  released: "Liberada",
  scheduled: "Programada",
  in_progress: "En proceso",
  qc_hold: "En calidad",
  completed: "Terminada",
  closed: "Cerrada",
  on_hold: "En pausa",
  cancelled: "Cancelada",
};

export function useProducts() {
  return useQuery({
    queryKey: ["products", "all"],
    queryFn: () => api<{ data: ProductOption[] }>("/products?limit=100"),
  });
}

export function useFilaments() {
  return useQuery({
    queryKey: ["filaments"],
    queryFn: () => api<{ data: ProductOption[] }>("/filaments"),
  });
}

export function ProductionPage() {
  const client = useQueryClient();
  const { error, pendingKey, run } = useError();
  const rowActions = useRecordActions();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewIds, setReviewIds] = useState<string[] | null>(null);
  const [status, setStatus] = useState("draft,released,scheduled,in_progress,qc_hold,on_hold");
  const orders = useQuery({
    queryKey: ["production-orders", status],
    queryFn: () => api<{ data: ProductionOrder[] }>(`/production-orders${status ? `?status=${status}` : ""}`),
  });
  const selectedIds = (orders.data?.data ?? []).filter(order => selected.has(order.id)).map(order => order.id);
  const toggleSelection = (ids: string[], checked: boolean) => setSelected(previous => {
    const next = new Set(previous);
    for (const id of ids) { if (checked && next.size < 1000) next.add(id); else if (!checked) next.delete(id); }
    return next;
  });
  const products = useProducts();
  const recipes = useRecipes();
  const demand = useQuery({
    queryKey: ["production-demand"],
    queryFn: () => api<{ data: Array<{ id: string; folio: string; customerName: string }> }>("/production-orders/sales-demand"),
  });
  const withRecipe = new Set((recipes.data?.data ?? []).filter((row) => row.lines > 0).map((row) => row.productId));
  const makeable = (products.data?.data ?? []).filter((product) =>
    canManufacture(product) && product.status !== "inactive" && withRecipe.has(product.id));
  const pending = demand.data?.data ?? [];
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["production-orders"] }),
      client.invalidateQueries({ queryKey: ["orders"] }),
      client.invalidateQueries({ queryKey: ["production-demand"] }),
      client.invalidateQueries({ queryKey: ["order"] }),
      client.invalidateQueries({ queryKey: ["inventory-catalog"] }),
    ]);
  };
  const runOrder = (order: ProductionOrder, action: "finish" | "cancel", reason?: string) => rowActions.run(order.id, action, async () => {
    try {
      const updated = action === "finish"
        ? await finishProduction<ProductionDetail>(order.id, order.status, order.quantityOrdered)
        : await cancelProduction(order.id, reason!);
      await client.cancelQueries({ queryKey: ["production-order", order.id] });
      client.setQueryData(["production-order", order.id], updated);
    } finally {
      // También refresca si falló una etapa después de liberar o consumir material.
      await refresh();
    }
  });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Producción</h1>
      <p>Fabrica un producto terminado con receta y márcalo terminado. Los insumos no se fabrican: se obtienen comprándolos. Las impresiones de un pedido no pasan por aquí.</p>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        {products.isPending || recipes.isPending ? null : !makeable.length ? (
          <EmptyState title="Sin artículos listos para fabricar" to="/app/recetas" actionLabel="Configurar receta">Ningún artículo activo con fabricación habilitada tiene receta. Configura sus materiales para crear una orden de producción.</EmptyState>
        ) : (
        <form
          style={grid}
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void run(async () => {
              await postJson("/production-orders", {
                productId: data.get("productId"),
                quantity: data.get("quantity"),
                dueDate: String(data.get("dueDate") || "") || undefined,
                priority: Number(data.get("priority") || 3),
              });
              form.reset();
              await refresh();
            }, "create");
          }}
        >
          <label>
            Producto
            <select name="productId" required>
              {makeable.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
            </select>
          </label>
          <label>Piezas<input name="quantity" required placeholder="10" /></label>
          <button className="primary new-link form-inline-submit" type="submit" disabled={pendingKey !== null} aria-busy={pendingKey === "create"}>
            <PlusIcon />
            Nueva orden
          </button>
        </form>
        )}
        {makeable.length ? (
          <p className="costing-hint">Solo aparecen productos terminados activos con receta. ¿Falta alguno? Revisa sus <Link to="/app/recetas">recetas</Link>.</p>
        ) : null}
        {demand.isPending ? null : pending.length ? (
          <form
            style={grid}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void run(async () => {
                await postJson(`/production-orders/from-sales-order/${data.get("salesOrderId")}`, {});
                await refresh();
                await client.invalidateQueries({ queryKey: ["production-demand"] });
              }, "demand");
            }}
          >
            <label>
              Pedido con producto por fabricar
              <select name="salesOrderId" required>
                {pending.map((order) => <option key={order.id} value={order.id}>{order.folio} · {order.customerName}</option>)}
              </select>
            </label>
            <button className="primary new-link form-inline-submit" type="submit" disabled={pendingKey !== null} aria-busy={pendingKey === "demand"}>
              <PlusIcon />
              Generar órdenes del pedido
            </button>
          </form>
        ) : (
          <EmptyState title="Sin pedidos por fabricar" to="/app/pedidos/nuevo" actionLabel="Crear pedido">No hay pedidos confirmados con artículos pendientes de fabricación. Crea y confirma un pedido para generar su demanda.</EmptyState>
        )}
        {error ? <p className="error">{error}</p> : null}
      </div>
      <label style={{ maxWidth: 260 }}>
        Mostrar
        <select value={status} onChange={(event) => { setStatus(event.target.value); setSelected(new Set()); }}>
          <option value="draft,released,scheduled,in_progress,qc_hold,on_hold">Abiertas</option>
          <option value="completed,closed">Terminadas</option>
          <option value="">Todas</option>
        </select>
      </label>
      <div className="inventory-heading">
        <span aria-live="polite">{selectedIds.length ? `${selectedIds.length} órdenes seleccionadas` : "Selecciona órdenes para revisar los materiales y servicios requeridos."}</span>
        <div className="record-actions">
          {selectedIds.length ? <button className="ghost" type="button" onClick={() => setSelected(new Set())}>Limpiar selección</button> : null}
          <button className="primary" type="button" disabled={!selectedIds.length} onClick={() => setReviewIds(selectedIds)}>Revisar gasto de material</button>
        </div>
      </div>
      {selectedIds.length >= 1000 ? <Notice title="Límite de selección">Puedes revisar hasta 1,000 órdenes por consulta.</Notice> : null}
      {reviewIds ? <ProductionMaterialReview orderIds={reviewIds} onClose={() => setReviewIds(null)} /> : null}
      {rowActions.pendingCount > 0 ? (
        <p className="costing-hint" role="status" aria-live="polite">
          Procesando {rowActions.pendingCount} {rowActions.pendingCount === 1 ? "orden" : "órdenes"}. Puedes continuar con las demás.
        </p>
      ) : null}
      {orders.isPending ? <TableSkeleton columns={6} /> : (
      <Paged rows={orders.data?.data ?? []}>
      {(pageOrders) => (
      <table>
        <thead><tr><th><input type="checkbox" aria-label="Seleccionar órdenes de esta página" ref={input => { if (input) input.indeterminate = pageOrders.some(order => selected.has(order.id)) && !pageOrders.every(order => selected.has(order.id)); }} checked={pageOrders.length > 0 && pageOrders.every(order => selected.has(order.id))} onChange={event => toggleSelection(pageOrders.map(order => order.id), event.target.checked)} /></th><th>Folio</th><th>Producto</th><th>Piezas</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {pageOrders.map((order) => {
            const step = nextStep(order.status);
            const state = rowActions.records[order.id];
            return (
              <tr key={order.id}>
                <td><input type="checkbox" aria-label={`Seleccionar ${order.folio}`} checked={selected.has(order.id)} disabled={!selected.has(order.id) && selectedIds.length >= 1000} onChange={event => toggleSelection([order.id], event.target.checked)} /></td>
                <td>{order.folio}</td>
                <td>{order.sku} · {order.name}</td>
                <td>{order.quantityCompleted}/{order.quantityOrdered}</td>
                <td><ProductionStatusBadge status={order.status} /></td>
                <td>
                  <div className="record-actions">
                    <ViewLink to={`/app/produccion/${order.id}`} />
                    {step ? (
                      <IconAction operatorAllowed label={step.label} tone={step.tone} pending={state?.pending && state.action === "finish"} disabled={state?.pending} onClick={() => void runOrder(order, "finish")}>
                        {step.icon}
                      </IconAction>
                    ) : null}
                    {CANCELLABLE.has(order.status) ? (
                      <IconAction operatorAllowed label="Cancelar orden" tone="delete" pending={state?.pending && state.action === "cancel"} disabled={state?.pending} onClick={() => {
                        const reason = askCancelReason(order.folio);
                        if (reason) void runOrder(order, "cancel", reason);
                      }}>
                        <BanIcon />
                      </IconAction>
                    ) : null}
                  </div>
                  {state?.error ? <p className="error" role="alert">{order.folio}: {state.error}</p> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}
      </Paged>
      )}
    </section>
  );
}

export function useRecipes() {
  return useQuery({
    queryKey: ["boms"],
    queryFn: () => api<{ data: RecipeSummary[] }>("/boms"),
  });
}

export function RecipesPage() {
  const operator = useRole() === "operator";
  const products = useProducts();
  const recipes = useRecipes();
  const [params, setParams] = useSearchParams();
  const recipeId = params.get("producto") ?? "";
  const { values, set, reset, dirty } = useFilters({ q: "", estado: "active", receta: "" });
  const summaries = new Map((recipes.data?.data ?? []).map((row) => [row.productId, row]));
  const finished = (products.data?.data ?? []).filter(canManufacture);
  const bySearch = finished.filter((product) => {
    const lines = summaries.get(product.id)?.lines ?? 0;
    return matchesText(values.q, product.sku, product.name)
      && (!values.receta || (values.receta === "con" ? lines > 0 : lines === 0));
  });
  const rows = bySearch.filter((product) => matchesStatus(product.status, values.estado));
  const selected = finished.find((product) => product.id === recipeId);
  const choose = (id: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("producto", id);
      else next.delete("producto");
      return next;
    }, { replace: true });
  };
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Recetas</h1>
      <p>La receta define los materiales y servicios por pieza y determina el costo del producto terminado. Sin receta, el producto no se puede fabricar. Los productos e insumos se apartan y se descuentan del inventario; el filamento solo cuenta en el costo y se ajusta en Inventario ▸ Filamentos.</p>
      {products.isPending || recipes.isPending ? <TableSkeleton columns={6} /> : !finished.length ? (
        <EmptyState title="Sin artículos para crear recetas" to="/app/productos/nuevo?abastecimiento=make" actionLabel="Crear producto fabricado">Crea un artículo con fabricación habilitada para definir sus materiales y preparar su receta.</EmptyState>
      ) : (
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
            label="Receta"
            value={values.receta}
            onChange={(value) => set("receta", value)}
            options={[{ value: "con", label: "Con receta" }, { value: "sin", label: "Sin receta" }]}
          />
        </FilterBar>
        {!rows.length ? <NoMatches onClear={reset} /> : (
        <Paged rows={rows}>
        {(pageRows) => (
        <table>
          <thead><tr><th>SKU</th><th>Producto</th><th>Componentes</th><CostOnly><th>Costo por pieza</th></CostOnly><th>Estado</th><th></th></tr></thead>
          <tbody>
            {pageRows.map((product) => {
              const summary = summaries.get(product.id);
              const lines = summary?.lines ?? 0;
              return (
                <tr key={product.id} className={product.id === recipeId ? "row-selected" : undefined}>
                  <td>{product.sku}</td>
                  <td>{product.name}</td>
                  <td>{lines ? lines : <span className="res res-badge cat-inactive">Sin receta</span>}</td>
                  <CostOnly><td>{lines ? money(summary?.unitCost) : "—"}</td></CostOnly>
                  <td><StatusBadge status={product.status} /></td>
                  <td>
                    <div className="record-actions">
                      {operator ? <button className="ghost" type="button" onClick={() => choose(product.id)}>Ver receta</button> : <IconAction label={lines ? "Editar receta" : "Armar receta"} tone="edit" onClick={() => choose(product.id)}>
                        <PencilIcon />
                      </IconAction>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
        </Paged>
        )}
        </>
      )}
      {selected ? <RecipeEditor key={selected.id} product={selected} onClose={() => choose("")} /> : null}
    </section>
  );
}

function RecipeEditor({ product, onClose }: { product: ProductOption; onClose: () => void }) {
  const operator = useRole() === "operator";
  const client = useQueryClient();
  const products = useProducts();
  const filaments = useFilaments();
  const services = useQuery({ queryKey: ["services"], queryFn: () => api<{ data: Array<{ id: string; name: string; code: string; unit: string; status: string }> }>("/services") });
  const recipeId = product.id;
  const bom = useQuery({
    queryKey: ["bom", recipeId],
    queryFn: () => api<BomDetail>(`/boms/${recipeId}`),
  });
  const components = [
    ...(filaments.data?.data ?? []).map((filament) => ({ ...filament, stockUom: filament.stockUom ?? "G" })),
    ...(products.data?.data ?? []).filter((item) => item.productType !== "service" && item.id !== recipeId),
  ];
  const recipe = useError();
  const recipeError = recipe.error;
  const recipePending = recipe.pendingKey;
  const recipeLines = bom.data?.lines ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const saveRecipe = (lines: RecipeInput[], key: string, serviceLines = bom.data?.services ?? []) =>
    recipe.run(async () => {
      await postJson("/boms", { productId: recipeId, lines, services: serviceLines.map((line) => ({ serviceId: line.serviceId, quantity: line.quantity })) });
      setEditingId(null);
      await client.invalidateQueries({ queryKey: ["bom", recipeId] });
      await client.invalidateQueries({ queryKey: ["boms"] });
      await client.invalidateQueries({ queryKey: ["products"] });
      await client.invalidateQueries({ queryKey: ["product"] });
    }, key);
  const saveQuantity = (componentId: string) => {
    void saveRecipe(
      recipeLines.map((line) => (line.componentProductId === componentId ? { ...recipeInput(line), quantity: editQty.trim() } : recipeInput(line))),
      componentId,
    );
  };
  const saveServiceQuantity = (serviceId: string) => {
    void saveRecipe(recipeLines.map(recipeInput), `service-${serviceId}`,
      (bom.data?.services ?? []).map((line) => line.serviceId === serviceId ? { ...line, quantity: editQty.trim() } : line));
  };
  if (operator) return <Modal title={`Receta de ${product.sku} · ${product.name}`} onClose={onClose}>
    {bom.isPending ? <TableSkeleton columns={3} /> : bom.isError ? <Notice tone="error" title="No se pudo cargar la receta" action={<button className="ghost" type="button" onClick={() => bom.refetch()}>Reintentar</button>}>{bom.error.message}</Notice> : <table>
      <thead><tr><th>Componente</th><th>Cantidad por pieza</th><th>Merma</th></tr></thead>
      <tbody>{recipeLines.map((line) => <tr key={line.componentProductId}><td>{line.sku} · {line.name}</td><td>{line.quantity}</td><td>{line.scrapPct}%</td></tr>)}</tbody>
    </table>}
    <h2>Servicios por pieza</h2>
    <table><thead><tr><th>Servicio</th><th>Cantidad</th></tr></thead>
      <tbody>{(bom.data?.services ?? []).map((line) => <tr key={line.serviceId}><td>{line.name}</td><td>{line.quantity} {line.unit}</td></tr>)}</tbody></table>
  </Modal>;
  return (
    <Modal title={`Receta de ${product.sku} · ${product.name}`} onClose={onClose} closeDisabled={recipePending !== null}>
      <div style={{ display: "grid", gap: 10 }}>
        {product.status === "inactive" ? <p style={{ margin: 0 }}><StatusBadge status={product.status} /></p> : null}
        {bom.isPending ? <TableSkeleton columns={4} /> : bom.data ? (
          <>
            <h2 style={{ margin: 0 }}>Filamentos e insumos</h2>
            {recipeLines.length === 0 ? <p style={{ margin: 0 }}>Este producto todavía no tiene receta. Agrega su primer componente.</p> : (
            <Paged rows={recipeLines}>
            {(pageLines) => (
            <table>
              <thead><tr><th>Componente</th><th>Cantidad por pieza</th><th>Costo por pieza</th><th></th></tr></thead>
              <tbody>
                {pageLines.map((line) => {
                  const editing = editingId === line.componentProductId;
                  const only = recipeLines.length === 1;
                  return (
                    <tr key={line.componentProductId}>
                      <td>{line.sku} · {line.name}</td>
                      <td>
                        {editing ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <input
                              aria-label={`Cantidad de ${line.name}`}
                              inputMode="decimal"
                              disabled={recipePending !== null}
                              style={{ width: 100 }}
                              value={editQty}
                              autoFocus
                              onChange={(event) => setEditQty(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") saveQuantity(line.componentProductId);
                                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditingId(null); }
                              }}
                            />
                            {uomShort(line.stockUom)}
                          </span>
                        ) : `${line.quantity} ${uomShort(line.stockUom)}`}
                      </td>
                      <td>{money(line.extendedCost)}</td>
                      <td>
                        <div className="record-actions">
                          {editing ? (
                            <>
                              <IconAction label="Guardar cantidad" tone="accept" pending={recipePending === line.componentProductId} disabled={recipePending !== null} onClick={() => saveQuantity(line.componentProductId)}>
                                <CheckIcon />
                              </IconAction>
                              <IconAction label="Descartar cambio" tone="neutral" disabled={recipePending !== null} onClick={() => setEditingId(null)}>
                                <XIcon />
                              </IconAction>
                            </>
                          ) : (
                            <>
                              <IconAction label="Editar cantidad" tone="edit" disabled={recipePending !== null} onClick={() => { setEditingId(line.componentProductId); setEditQty(line.quantity); }}>
                                <PencilIcon />
                              </IconAction>
                              <IconAction
                                label={only ? "La receta necesita al menos un componente" : "Quitar de la receta"}
                                tone="delete"
                                pending={recipePending === `remove-${line.componentProductId}`}
                                disabled={only || recipePending !== null}
                                onClick={() => {
                                  if (!window.confirm(`¿Quitar ${line.name} de la receta?`)) return;
                                  void saveRecipe(recipeLines.filter((entry) => entry.componentProductId !== line.componentProductId).map(recipeInput), `remove-${line.componentProductId}`);
                                }}
                              >
                                <TrashIcon />
                              </IconAction>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr className="costing-subtotal">
                  <td colSpan={2}>Costo de material por pieza</td>
                  <td>{money(bom.data.materialCost)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
            )}
            </Paged>
            )}
            <form
              style={grid}
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                const added = {
                  componentProductId: String(data.get("componentProductId")),
                  quantity: String(data.get("quantity")),
                  scrapPct: "0",
                };
                const kept = recipeLines.filter((line) => line.componentProductId !== added.componentProductId).map(recipeInput);
                void saveRecipe([...kept, added], "add").then(() => form.reset());
              }}
            >
              <label>
                Componente
                <select name="componentProductId" required>
                  {components.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
                </select>
              </label>
              <label>Cantidad por pieza<input name="quantity" required placeholder="120" /></label>
              <button className="primary new-link form-inline-submit" type="submit" disabled={recipePending !== null} aria-busy={recipePending === "add"}>
                <PlusIcon />
                Agregar a la receta
              </button>
            </form>
            <p className="costing-hint" style={{ margin: 0 }}>Si agregas un componente que ya está en la receta, se reemplaza su cantidad.</p>
            <h2 style={{ margin: "12px 0 0" }}>Servicios por pieza</h2>
            <p className="costing-hint">Agrega impresión, acabado, diseño u otros servicios del catálogo. Se suman al costo, sin afectar existencias.</p>
            {(bom.data.services ?? []).length ? <table>
              <thead><tr><th>Servicio</th><th>Cantidad por pieza</th><th>Costo por pieza</th><th></th></tr></thead>
              <tbody>{bom.data.services.map((line) => {
                const key = `service-${line.serviceId}`;
                const editing = editingId === key;
                return <tr key={line.serviceId}>
                  <td>{line.code} · {line.name}</td>
                  <td>{editing ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <input aria-label={`Cantidad de ${line.name}`} inputMode="decimal" disabled={recipePending !== null}
                        style={{ width: 100 }} value={editQty} autoFocus onChange={(event) => setEditQty(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveServiceQuantity(line.serviceId);
                          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditingId(null); }
                        }} />
                      {line.unit}
                    </span>
                  ) : `${line.quantity} ${line.unit}`}</td>
                  <td>{money(line.extendedCost)}</td>
                  <td><div className="record-actions">
                    {editing ? <>
                      <IconAction label="Guardar cantidad" tone="accept" pending={recipePending === key} disabled={recipePending !== null} onClick={() => saveServiceQuantity(line.serviceId)}><CheckIcon /></IconAction>
                      <IconAction label="Descartar cambio" tone="neutral" disabled={recipePending !== null} onClick={() => setEditingId(null)}><XIcon /></IconAction>
                    </> : <>
                      <IconAction label="Editar cantidad" tone="edit" disabled={recipePending !== null} onClick={() => { setEditingId(key); setEditQty(line.quantity); }}><PencilIcon /></IconAction>
                      <IconAction label={`Quitar ${line.name}`} tone="delete" disabled={recipePending !== null}
                        onClick={() => {
                          if (!window.confirm(`¿Quitar ${line.name} de la receta?`)) return;
                          void saveRecipe(recipeLines.map(recipeInput), `remove-service-${line.serviceId}`,
                            bom.data!.services.filter((entry) => entry.serviceId !== line.serviceId));
                        }}><TrashIcon /></IconAction>
                    </>}
                  </div></td>
                </tr>;
              })}</tbody>
            </table> : <Notice title="Sin servicios en la receta">Selecciona un servicio abajo para incorporarlo al costo por pieza.</Notice>}
            <form style={grid} onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              const added = { serviceId: String(data.get("serviceId")), quantity: String(data.get("quantity")) };
              const selected = (services.data?.data ?? []).find((entry) => entry.id === added.serviceId);
              if (!selected) return;
              const kept = bom.data!.services.filter((entry) => entry.serviceId !== added.serviceId);
              void saveRecipe(recipeLines.map(recipeInput), "add-service", [...kept, { ...added, code: selected.code, name: selected.name, unit: selected.unit, extendedCost: null }]).then(() => form.reset());
            }}>
              <label>Servicio<select name="serviceId" required disabled={!services.data?.data.length}>
                <option value="">Selecciona un servicio</option>
                {(services.data?.data ?? []).filter((entry) => entry.status !== "inactive").map((entry) => <option key={entry.id} value={entry.id}>{entry.code} · {entry.name}</option>)}
              </select></label>
              <label>Cantidad por pieza<input name="quantity" required inputMode="decimal" placeholder="1" /></label>
              <button className="primary new-link form-inline-submit" type="submit" disabled={recipePending !== null || !recipeLines.length || !services.data?.data.length} aria-busy={recipePending === "add-service"}>
                <PlusIcon />
                Agregar servicio
              </button>
            </form>
            {services.isError ? <Notice tone="error" title="No se pudieron cargar los servicios" action={<button className="ghost" type="button" onClick={() => void services.refetch()}>Reintentar</button>}>Intenta nuevamente para consultar el catálogo.</Notice> : !services.isPending && !services.data?.data.length ? <EmptyState title="Sin servicios en el catálogo" to="/app/servicios/nuevo" actionLabel="Crear servicio">Registra un servicio para asociarlo a la receta.</EmptyState> : null}
            <CostOnly><article className="card" style={{ display: "grid", gap: 8 }}>
              <h2 style={{ margin: 0 }}>Costo por pieza</h2>
              {bom.data.missingCosts ? <Notice title="Costo incompleto">Hay materiales o servicios sin costo en su catálogo. Captura sus costos para calcular el total del producto.</Notice> : null}
              <div style={grid}>
                <span>Filamento <strong>{money(bom.data.filamentCost)}</strong></span>
                <span>Insumos <strong>{money(bom.data.suppliesCost)}</strong></span>
                <span>Servicios <strong>{money(bom.data.serviceCost)}</strong></span>
                <span>Ruta de fabricación <strong>{money(bom.data.laborCost)}</strong></span>
              </div>
              <p style={{ margin: 0 }}>Costo total <strong>{bom.data.missingCosts ? "Pendiente de completar" : money(bom.data.unitCost)}</strong></p>
            </article></CostOnly>
            {recipeError ? <Notice tone="error" title="No se pudo guardar la receta">{recipeError}</Notice> : null}
          </>
        ) : <Notice tone="error" title="No se pudo cargar la receta" action={<button className="ghost" type="button" onClick={() => bom.refetch()}>Reintentar</button>}>Intenta nuevamente para consultar sus componentes.</Notice>}
      </div>
    </Modal>
  );
}

const PRODUCTION_HINT: Record<string, string> = {
  draft: "Borrador. Al terminarla se libera, se consume el material de la receta y las piezas entran al inventario.",
  released: "Cuando las piezas estén listas, termínala: se consume el material y las piezas entran al inventario.",
  scheduled: "Cuando las piezas estén listas, termínala: se consume el material y las piezas entran al inventario.",
  in_progress: "Cuando las piezas estén listas, termínala: se consume el material y las piezas entran al inventario.",
  on_hold: "En pausa. Al terminarla se reanuda, se consume el material y las piezas entran al inventario.",
  qc_hold: "Las piezas esperan revisión de calidad. Apruébalas para cerrar la orden.",
  completed: "Terminada. Ciérrala para fijar su costo real.",
};

const OPEN_STATES = ["draft", "released", "scheduled", "in_progress", "on_hold", "qc_hold", "completed"];
const CANCELLABLE = new Set(["draft", "released", "scheduled", "in_progress", "on_hold", "qc_hold"]);

function nextStep(status: string): { label: string; tone: string; icon: ReactNode } | null {
  if (status === "qc_hold") return { label: "Aprobar calidad", tone: "accept", icon: <CheckIcon /> };
  if (status === "completed") return { label: "Cerrar orden", tone: "convert", icon: <LockIcon /> };
  if (OPEN_STATES.includes(status)) return { label: "Terminar", tone: "accept", icon: <CheckIcon /> };
  return null;
}

function ProductionStatusBadge({ status }: { status: string }) {
  return <span className={`res res-badge prod-${status}`}>{ORDER_STATUS[status] ?? status}</span>;
}

function askCancelReason(folio: string): string | null {
  const reason = window.prompt(`¿Por qué se cancela ${folio}? Se libera el material apartado.`);
  return reason?.trim() ? reason.trim() : null;
}

async function cancelProduction(id: string, reason: string) {
  return postJson<ProductionDetail>(`/production-orders/${id}/transition`, { to: "cancelled", reason });
}

interface RecipeInput {
  componentProductId: string;
  quantity: string;
  scrapPct: string;
}

function recipeInput(line: BomDetail["lines"][number]): RecipeInput {
  return { componentProductId: line.componentProductId, quantity: line.quantity, scrapPct: line.scrapPct };
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function ProductionDetailPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const { error, pendingKey, run } = useError();
  const order = useQuery({ queryKey: ["production-order", id], queryFn: () => api<ProductionDetail>(`/production-orders/${id}`) });
  if (order.isPending) return <DetailSkeleton />;
  if (!order.data) return <p className="error">No se pudo cargar la orden.</p>;
  const data = order.data;
  const step = nextStep(data.status);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["production-order", id] });
    await client.invalidateQueries({ queryKey: ["production-orders"] });
    await client.invalidateQueries({ queryKey: ["orders"] });
  };
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <header>
        <BackLink to="/app/produccion">Producción</BackLink>
        <h1 style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {data.folio} · {data.sku} {data.name}
          <ProductionStatusBadge status={data.status} />
        </h1>
        <p>
          {data.quantityCompleted} de {data.quantityOrdered} piezas
          {data.salesOrderFolio ? ` · pedido ${data.salesOrderFolio}` : ""}
        </p>
      </header>
      {step || CANCELLABLE.has(data.status) ? (
        <div className="card quote-actions">
          <div className="quote-actions-group">
            <span className="quote-actions-label">Siguiente paso</span>
            <p className="quote-actions-hint">{PRODUCTION_HINT[data.status] ?? ""}</p>
            <div className="quote-actions-row">
              {step ? (
                <QuoteButton
                  label={step.label === "Terminar" ? "Terminar la orden" : step.label}
                  tone={step.tone}
                  icon={step.icon}
                  pending={pendingKey === "finish"}
                  disabled={pendingKey !== null}
                  onClick={() => void run(async () => {
                    const updated = await finishProduction<ProductionDetail>(data.id, data.status, data.quantityOrdered);
                    await client.cancelQueries({ queryKey: ["production-order", id] });
                    client.setQueryData(["production-order", id], updated);
                    await Promise.all([
                      client.invalidateQueries({ queryKey: ["production-orders"] }),
                      client.invalidateQueries({ queryKey: ["production-demand"] }),
                      client.invalidateQueries({ queryKey: ["orders"] }),
                      client.invalidateQueries({ queryKey: ["order"] }),
                      client.invalidateQueries({ queryKey: ["inventory-catalog"] }),
                    ]);
                  }, "finish")}
                />
              ) : null}
              {CANCELLABLE.has(data.status) ? (
                <QuoteButton
                  label="Cancelar orden"
                  tone="danger"
                  icon={<BanIcon />}
                  pending={pendingKey === "cancel"}
                  disabled={pendingKey !== null}
                  onClick={() => {
                    const reason = askCancelReason(data.folio);
                    if (reason) void run(() => cancelProduction(data.id, reason).then(refresh), "cancel");
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <h2>Material</h2>
      <Paged rows={data.materials}>
      {(materials) => (
      <table>
        <thead><tr><th>Componente</th><th>Requerido</th><th>Consumido</th><th>Inventario</th></tr></thead>
        <tbody>
          {materials.map((material) => (
            <tr key={material.id}>
              <td>{material.sku} · {material.name}</td>
              <td>{material.required} {uomShort(material.stockUom)}</td>
              <td>{material.consumed}</td>
              <td>
                {!material.tracksStock ? <span className="costing-hint">Se ajusta en el inventario</span>
                  : Number(material.consumed) >= Number(material.required) ? <span className="costing-hint">Descontado</span>
                  : Number(material.shortage) > 0 ? <span className="res res-badge prod-cancelled">Faltan {material.shortage}</span>
                  : <span className="res res-badge prod-completed">Disponible</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      </Paged>
    </section>
  );
}

export interface ProductOption {
  id: string;
  sku: string;
  name: string;
  productType: string;
  supplyMode: string;
  itemClass: string;
  status?: string;
  stockUom: string;
  purchaseUom: string;
  cost: string | null;
}

interface RecipeSummary {
  productId: string;
  lines: number;
  materialCost: string | null;
  unitCost: string | null;
}

interface BomDetail {
  lines: Array<{ componentProductId: string; sku: string; name: string; stockUom: string; quantity: string; scrapPct: string; requiredPerUnit: string; extendedCost: string }>;
  services: Array<{ serviceId: string; name: string; code: string; unit: string; quantity: string; extendedCost: string | null }>;
  filamentCost: string | null;
  suppliesCost: string | null;
  serviceCost: string | null;
  missingCosts: boolean;
  materialCost: string;
  laborCost: string;
  unitCost: string;
  currentCost: string | null;
}

interface ProductionOrder {
  id: string;
  folio: string;
  sku: string;
  name: string;
  status: string;
  qcStatus: string;
  quantityOrdered: string;
  quantityCompleted: string;
  quantityScrapped: string;
  dueDate: string | null;
  estimatedCost: string | null;
  actualCost: string | null;
}

interface ProductionDetail extends ProductionOrder {
  salesOrderFolio: string | null;
  materials: Array<{ id: string; componentProductId: string; sku: string; name: string; stockUom: string; required: string; allocated: string; consumed: string; available: string; shortage: string; tracksStock: boolean }>;
  operations: Array<{ id: string; sequence: number; name: string; workCenterName: string; plannedMinutes: string; actualMinutes: string | null; status: string }>;
  consumptions: Array<{ id: string; sku: string; quantity: string; value: string; createdAt: string }>;
  inspections: Array<{ id: string; result: string; qtyPassed: string; qtyFailed: string; disposition: string | null; defect: string | null; createdAt: string }>;
}
