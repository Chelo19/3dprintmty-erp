import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, postJson } from "./api";
import { money, useError } from "./operations";

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

const QC_STATUS: Record<string, string> = {
  not_required: "—",
  pending: "Pendiente",
  passed: "Aprobada",
  failed: "Rechazada",
  waived: "Dispensada",
};

const OPERATION_STATUS: Record<string, string> = {
  pending: "Pendiente",
  running: "En curso",
  complete: "Hecha",
  skipped: "Omitida",
};

const CENTER_KIND: Record<string, string> = {
  printer: "Impresora",
  post_process: "Postproceso",
  quality: "Calidad",
  packing: "Empaque",
  other: "Otro",
};

const SPOOL_STATUS: Record<string, string> = {
  available: "Disponible",
  in_use: "En uso",
  empty: "Vacío",
  scrapped: "Baja",
};

export function useProducts() {
  return useQuery({
    queryKey: ["products", "all"],
    queryFn: () => api<{ data: ProductOption[] }>("/products?limit=100"),
  });
}

export function useLocations() {
  return useQuery({ queryKey: ["locations"], queryFn: () => api<Array<{ id: string; name: string }>>("/locations") });
}

export function SpoolsPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const [status, setStatus] = useState("available,in_use");
  const spools = useQuery({ queryKey: ["spools"], queryFn: () => api<{ data: Spool[] }>("/spools") });
  const products = useProducts();
  const locations = useLocations();
  const filaments = (products.data?.data ?? []).filter((product) => product.stockUom === "G");
  const visible = (spools.data?.data ?? []).filter((spool) => status === "all" || status.split(",").includes(spool.status));
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["spools"] });
    await client.invalidateQueries({ queryKey: ["inventory"] });
  };
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Rollos</h1>
      <p>Cada rollo lleva su peso neto. Pésalo de vez en cuando: la diferencia se ajusta en el kardex.</p>
      <form
        className="card"
        style={grid}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void run(async () => {
            await postJson("/spools", {
              productId: data.get("productId"),
              locationId: data.get("locationId") || undefined,
              grams: data.get("grams"),
              lotNumber: String(data.get("lotNumber") || "") || undefined,
              addToStock: data.has("addToStock"),
            });
            form.reset();
            await refresh();
          });
        }}
      >
        <label>
          Filamento
          <select name="productId" required>
            {filaments.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
          </select>
        </label>
        <label>
          Sucursal
          <select name="locationId">
            {(locations.data ?? []).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <label>Peso neto (g)<input name="grams" required placeholder="1000" /></label>
        <label>Lote<input name="lotNumber" placeholder="Opcional" /></label>
        <label style={{ gridTemplateColumns: "auto 1fr", alignItems: "center" }}>
          <input name="addToStock" type="checkbox" defaultChecked />
          Sumar al inventario
        </label>
        <button className="primary" type="submit">Dar de alta rollo</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <label style={{ maxWidth: 240 }}>
        Mostrar
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="available,in_use">Activos</option>
          <option value="empty,scrapped">Vacíos y bajas</option>
          <option value="all">Todos</option>
        </select>
      </label>
      <table>
        <thead><tr><th>Rollo</th><th>Filamento</th><th>Lote</th><th>Restante</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {visible.map((spool) => (
            <tr key={spool.id}>
              <td>{spool.spoolNumber}</td>
              <td>{spool.sku} · {spool.color ?? spool.name}</td>
              <td>{spool.lotNumber ?? "—"}</td>
              <td>{spool.currentGrams} g ({spool.percentRemaining}%)</td>
              <td>{SPOOL_STATUS[spool.status] ?? spool.status}</td>
              <td style={{ display: "flex", gap: 8 }}>
                {spool.status !== "scrapped" ? (
                  <>
                    <Action
                      label="Pesar"
                      onClick={() => {
                        const grams = window.prompt(`Peso neto actual de ${spool.spoolNumber} (g)`, spool.currentGrams);
                        if (!grams) return;
                        void run(async () => {
                          await postJson(`/spools/${spool.id}/weigh`, { grams, reason: "Pesaje en báscula" });
                          await refresh();
                        });
                      }}
                    />
                    <Action
                      label="Baja"
                      onClick={() => {
                        const reason = window.prompt(`¿Por qué se da de baja ${spool.spoolNumber}?`);
                        if (!reason) return;
                        void run(async () => {
                          await postJson(`/spools/${spool.id}/scrap`, { reason });
                          await refresh();
                        });
                      }}
                    />
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function CycleCountsPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const [preview, setPreview] = useState<CountResult | null>(null);
  const counts = useQuery({ queryKey: ["cycle-counts"], queryFn: () => api<{ data: CountSummary[] }>("/cycle-counts") });
  const products = useProducts();
  const locations = useLocations();
  const [draft, setDraft] = useState<{ locationId: string; reference: string; lines: Array<{ productId: string; countedQty: string }> }>({
    locationId: "",
    reference: "",
    lines: [{ productId: "", countedQty: "" }],
  });
  const body = (dryRun: boolean) => ({
    locationId: draft.locationId || locations.data?.[0]?.id,
    reference: draft.reference || "Conteo",
    dryRun,
    lines: draft.lines.filter((line) => line.productId && line.countedQty),
  });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Conteo cíclico</h1>
      <p>Captura lo contado, revisa las diferencias y su valor, y después aplica el ajuste.</p>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div style={grid}>
          <label>
            Sucursal
            <select value={draft.locationId} onChange={(event) => setDraft({ ...draft, locationId: event.target.value })}>
              {(locations.data ?? []).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          <label>Referencia<input value={draft.reference} onChange={(event) => setDraft({ ...draft, reference: event.target.value })} placeholder="Conteo semanal" /></label>
        </div>
        {draft.lines.map((line, index) => (
          <div key={index} style={grid}>
            <label>
              Producto
              <select
                value={line.productId}
                onChange={(event) => setDraft({ ...draft, lines: draft.lines.map((item, i) => (i === index ? { ...item, productId: event.target.value } : item)) })}
              >
                <option value="">—</option>
                {(products.data?.data ?? []).filter((product) => product.productType !== "service").map((product) => (
                  <option key={product.id} value={product.id}>{product.sku} · {product.name} ({product.stockUom})</option>
                ))}
              </select>
            </label>
            <label>
              Contado
              <input
                value={line.countedQty}
                onChange={(event) => setDraft({ ...draft, lines: draft.lines.map((item, i) => (i === index ? { ...item, countedQty: event.target.value } : item)) })}
              />
            </label>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost" type="button" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { productId: "", countedQty: "" }] })}>Agregar renglón</button>
          <button className="ghost" type="button" onClick={() => void run(async () => setPreview(await postJson<CountResult>("/cycle-counts", body(true))))}>Revisar diferencias</button>
          <button
            className="primary"
            type="button"
            disabled={!preview}
            onClick={() =>
              void run(async () => {
                setPreview(await postJson<CountResult>("/cycle-counts", body(false)));
                await client.invalidateQueries({ queryKey: ["cycle-counts"] });
                await client.invalidateQueries({ queryKey: ["inventory"] });
              })
            }
          >
            Aplicar ajuste
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>
      {preview ? (
        <div className="card">
          <strong>{preview.folio ? `Conteo ${preview.folio} aplicado` : "Vista previa (no se ha guardado)"}</strong>
          <p>{preview.adjustments} ajustes · valor {money(preview.varianceValue)}</p>
          <table>
            <thead><tr><th>SKU</th><th>Sistema</th><th>Contado</th><th>Diferencia</th><th>Valor</th></tr></thead>
            <tbody>
              {preview.lines.map((line) => (
                <tr key={line.productId}>
                  <td>{line.sku}</td>
                  <td>{line.systemQty} {line.stockUom}</td>
                  <td>{line.countedQty}</td>
                  <td>{line.variance}</td>
                  <td>{money(line.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <h2>Historial</h2>
      <table>
        <thead><tr><th>Folio</th><th>Referencia</th><th>Sucursal</th><th>Ajustes</th><th>Valor</th><th>Fecha</th></tr></thead>
        <tbody>
          {(counts.data?.data ?? []).map((count) => (
            <tr key={count.id}>
              <td>{count.folio}</td>
              <td>{count.reference}</td>
              <td>{count.locationName}</td>
              <td>{count.adjustments}</td>
              <td>{money(count.varianceValue)}</td>
              <td>{new Date(count.createdAt).toLocaleDateString("es-MX")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ManufacturingPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const products = useProducts();
  const centers = useQuery({ queryKey: ["work-centers"], queryFn: () => api<{ data: WorkCenter[] }>("/work-centers") });
  const boms = useQuery({ queryKey: ["boms"], queryFn: () => api<{ data: BomSummary[] }>("/boms") });
  const [productId, setProductId] = useState("");
  const bom = useQuery({
    queryKey: ["bom", productId],
    queryFn: () => api<BomDetail>(`/boms/${productId}`),
    enabled: Boolean(productId),
  });
  const routing = useQuery({
    queryKey: ["routing", productId],
    queryFn: () => api<RoutingDetail>(`/routings/${productId}`),
    enabled: Boolean(productId),
  });
  const makeable = (products.data?.data ?? []).filter((product) => product.productType === "finished_good" || product.productType === "component");
  const components = (products.data?.data ?? []).filter((product) => product.productType !== "service" && product.id !== productId);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["boms"] });
    await client.invalidateQueries({ queryKey: ["bom", productId] });
    await client.invalidateQueries({ queryKey: ["routing", productId] });
  };
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Manufactura</h1>
      <p>Lista de materiales con merma, ruta por estación de trabajo y costo estándar por pieza.</p>
      <h2>Estaciones de trabajo</h2>
      <table>
        <thead><tr><th>Clave</th><th>Nombre</th><th>Tipo</th><th>Tarifa por hora</th><th>Horas por día</th></tr></thead>
        <tbody>
          {(centers.data?.data ?? []).map((center) => (
            <tr key={center.id}>
              <td>{center.code}</td>
              <td>{center.name}</td>
              <td>{CENTER_KIND[center.kind] ?? center.kind}</td>
              <td>{money(center.hourlyRate)}</td>
              <td>{center.capacityHours}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Productos con BOM</h2>
      <table>
        <thead><tr><th>SKU</th><th>Producto</th><th>Versión</th><th>Componentes</th><th>Material por pieza</th><th></th></tr></thead>
        <tbody>
          {(boms.data?.data ?? []).map((row) => (
            <tr key={row.bomId}>
              <td>{row.sku}</td>
              <td>{row.name}</td>
              <td>v{row.version}</td>
              <td>{row.lines}</td>
              <td>{money(row.materialCost)}</td>
              <td><Action label="Editar" onClick={() => setProductId(row.productId)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <label style={{ maxWidth: 360 }}>
          Producto a fabricar
          <select value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">Elige un terminado o componente</option>
            {makeable.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
          </select>
        </label>
        {productId && bom.data ? (
          <>
            <p style={{ margin: 0 }}>
              Material {money(bom.data.materialCost)} + mano de obra {money(bom.data.laborCost)} = <strong>{money(bom.data.unitCost)}</strong> por pieza
              {bom.data.currentCost ? ` · costo en catálogo ${money(bom.data.currentCost)}` : ""}
            </p>
            <table>
              <thead><tr><th>Componente</th><th>Cantidad</th><th>Merma</th><th>Requerido por pieza</th><th>Costo</th></tr></thead>
              <tbody>
                {bom.data.lines.map((line) => (
                  <tr key={line.componentProductId}>
                    <td>{line.sku} · {line.name}</td>
                    <td>{line.quantity} {line.stockUom}</td>
                    <td>{line.scrapPct}%</td>
                    <td>{line.requiredPerUnit} {line.stockUom}</td>
                    <td>{money(line.extendedCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form
              style={grid}
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                const existing = bom.data.lines.map((line) => ({
                  componentProductId: line.componentProductId,
                  quantity: line.quantity,
                  scrapPct: line.scrapPct,
                }));
                const added = {
                  componentProductId: String(data.get("componentProductId")),
                  quantity: String(data.get("quantity")),
                  scrapPct: String(data.get("scrapPct") || "0"),
                };
                void run(async () => {
                  await postJson("/boms", {
                    productId,
                    lines: [...existing.filter((line) => line.componentProductId !== added.componentProductId), added],
                  });
                  form.reset();
                  await refresh();
                });
              }}
            >
              <label>
                Componente
                <select name="componentProductId" required>
                  {components.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name} ({product.stockUom})</option>)}
                </select>
              </label>
              <label>Cantidad por pieza<input name="quantity" required placeholder="120" /></label>
              <label>Merma %<input name="scrapPct" placeholder="5" /></label>
              <button className="primary" type="submit">Agregar o reemplazar (nueva versión)</button>
            </form>
            <form
              style={grid}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void run(async () => {
                  await postJson(`/boms/${productId}/copy`, {
                    targetProductId: data.get("targetProductId"),
                    swap: data.get("fromComponentId") && data.get("toComponentId")
                      ? { fromComponentId: data.get("fromComponentId"), toComponentId: data.get("toComponentId") }
                      : undefined,
                  });
                  await refresh();
                });
              }}
            >
              <label>
                Copiar a
                <select name="targetProductId" required>
                  {makeable.filter((product) => product.id !== productId).map((product) => <option key={product.id} value={product.id}>{product.sku}</option>)}
                </select>
              </label>
              <label>
                Cambiar
                <select name="fromComponentId">
                  <option value="">—</option>
                  {bom.data.lines.map((line) => <option key={line.componentProductId} value={line.componentProductId}>{line.sku}</option>)}
                </select>
              </label>
              <label>
                Por
                <select name="toComponentId">
                  <option value="">—</option>
                  {components.map((product) => <option key={product.id} value={product.id}>{product.sku}</option>)}
                </select>
              </label>
              <button className="ghost" type="submit">Copiar BOM (variante de color)</button>
            </form>
            <button
              className="ghost"
              type="button"
              style={{ justifySelf: "start" }}
              onClick={() => void run(async () => {
                await postJson(`/products/${productId}/cost-from-bom`, {});
                await refresh();
                await client.invalidateQueries({ queryKey: ["products"] });
              })}
            >
              Usar este costo en el catálogo
            </button>
            <h3>Ruta</h3>
            <table>
              <thead><tr><th>Sec.</th><th>Operación</th><th>Estación</th><th>Preparación</th><th>Min. por pieza</th></tr></thead>
              <tbody>
                {(routing.data?.operations ?? []).map((operation) => (
                  <tr key={operation.sequence}>
                    <td>{operation.sequence}</td>
                    <td>{operation.name}</td>
                    <td>{operation.workCenterName}</td>
                    <td>{operation.setupMinutes} min</td>
                    <td>{operation.runMinutes} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form
              style={grid}
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                const current = (routing.data?.operations ?? []).map((operation) => ({
                  sequence: operation.sequence,
                  code: operation.code,
                  name: operation.name,
                  workCenterId: operation.workCenterId,
                  setupMinutes: operation.setupMinutes,
                  runMinutes: operation.runMinutes,
                }));
                const sequence = (current.at(-1)?.sequence ?? 0) + 10;
                void run(async () => {
                  await postJson("/routings", {
                    productId,
                    operations: [
                      ...current,
                      {
                        sequence,
                        code: String(data.get("name")).slice(0, 6).toUpperCase().replace(/\s+/g, ""),
                        name: data.get("name"),
                        workCenterId: data.get("workCenterId"),
                        setupMinutes: String(data.get("setupMinutes") || "0"),
                        runMinutes: data.get("runMinutes"),
                      },
                    ],
                  });
                  form.reset();
                  await refresh();
                });
              }}
            >
              <label>Operación<input name="name" required placeholder="Impresión" /></label>
              <label>
                Estación
                <select name="workCenterId" required>
                  {(centers.data?.data ?? []).map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
                </select>
              </label>
              <label>Preparación (min)<input name="setupMinutes" placeholder="10" /></label>
              <label>Min. por pieza<input name="runMinutes" required placeholder="45" /></label>
              <button className="primary" type="submit">Agregar operación</button>
            </form>
          </>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </div>
    </section>
  );
}

export function ProductionPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const [status, setStatus] = useState("draft,released,scheduled,in_progress,qc_hold,on_hold");
  const orders = useQuery({
    queryKey: ["production-orders", status],
    queryFn: () => api<{ data: ProductionOrder[] }>(`/production-orders${status ? `?status=${status}` : ""}`),
  });
  const products = useProducts();
  const sales = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<{ data: Array<{ id: string; folio: string; customerName: string; status: string }> }>("/orders"),
  });
  const makeable = (products.data?.data ?? []).filter((product) => product.productType === "finished_good" || product.productType === "component");
  const pending = (sales.data?.data ?? []).filter((order) => order.status === "confirmed" || order.status === "in_production");
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["production-orders"] });
    await client.invalidateQueries({ queryKey: ["orders"] });
  };
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Producción</h1>
      <p>Una orden aparta material al liberarse, consume de rollos específicos y recibe el terminado al pasar calidad.</p>
      <div className="card" style={{ display: "grid", gap: 10 }}>
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
            });
          }}
        >
          <label>
            Producto
            <select name="productId" required>
              {makeable.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
            </select>
          </label>
          <label>Piezas<input name="quantity" required placeholder="10" /></label>
          <label>Fecha compromiso<input name="dueDate" type="date" /></label>
          <label>
            Prioridad
            <select name="priority" defaultValue="3">
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button className="primary" type="submit">Nueva orden para stock</button>
        </form>
        <form
          style={grid}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void run(async () => {
              await postJson(`/production-orders/from-sales-order/${data.get("salesOrderId")}`, {});
              await refresh();
            });
          }}
        >
          <label>
            Pedido confirmado
            <select name="salesOrderId" required>
              {pending.map((order) => <option key={order.id} value={order.id}>{order.folio} · {order.customerName}</option>)}
            </select>
          </label>
          <button className="ghost" type="submit">Generar órdenes del pedido</button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </div>
      <label style={{ maxWidth: 260 }}>
        Mostrar
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="draft,released,scheduled,in_progress,qc_hold,on_hold">Abiertas</option>
          <option value="completed,closed">Terminadas</option>
          <option value="">Todas</option>
        </select>
      </label>
      <table>
        <thead><tr><th>Folio</th><th>Producto</th><th>Piezas</th><th>Estado</th><th>Calidad</th><th>Compromiso</th><th>Costo est.</th></tr></thead>
        <tbody>
          {(orders.data?.data ?? []).map((order) => (
            <tr key={order.id}>
              <td><Link to={`/app/produccion/${order.id}`}>{order.folio}</Link></td>
              <td>{order.sku} · {order.name}</td>
              <td>{order.quantityCompleted}/{order.quantityOrdered}</td>
              <td>{ORDER_STATUS[order.status] ?? order.status}</td>
              <td>{QC_STATUS[order.qcStatus] ?? order.qcStatus}</td>
              <td>{order.dueDate ?? "—"}</td>
              <td>{money(order.estimatedCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ProductionDetailPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const { error, run } = useError();
  const order = useQuery({ queryKey: ["production-order", id], queryFn: () => api<ProductionDetail>(`/production-orders/${id}`) });
  const spools = useQuery({ queryKey: ["spools"], queryFn: () => api<{ data: Spool[] }>("/spools") });
  const defects = useQuery({ queryKey: ["defect-types"], queryFn: () => api<{ data: Array<{ id: string; name: string }> }>("/quality/defect-types") });
  const [shortages, setShortages] = useState<Array<{ sku: string; short: string }>>([]);
  if (!order.data) return <p>Cargando…</p>;
  const data = order.data;
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["production-order", id] });
    await client.invalidateQueries({ queryKey: ["production-orders"] });
    await client.invalidateQueries({ queryKey: ["spools"] });
    await client.invalidateQueries({ queryKey: ["inventory"] });
  };
  const act = (path: string, body: unknown = {}) =>
    run(async () => {
      const result = await postJson<ProductionDetail & { shortages?: Array<{ sku: string; short: string }> }>(`/production-orders/${id}${path}`, body);
      setShortages(result.shortages ?? []);
      await refresh();
    });
  const running = ["released", "scheduled", "in_progress"].includes(data.status);
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <header>
        <Link to="/app/produccion">← Producción</Link>
        <h1>{data.folio} · {data.sku} {data.name}</h1>
        <p>
          {ORDER_STATUS[data.status] ?? data.status} · {data.quantityCompleted} de {data.quantityOrdered} piezas
          {data.quantityScrapped !== "0" ? ` · ${data.quantityScrapped} de merma` : ""}
          {data.salesOrderFolio ? ` · pedido ${data.salesOrderFolio}` : ""} · costo estimado {money(data.estimatedCost)}
          {data.actualCost ? ` · real ${money(data.actualCost)}` : ""}
        </p>
      </header>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {data.status === "draft" ? <button className="primary" type="button" onClick={() => void act("/release")}>Liberar y apartar material</button> : null}
        {data.status === "released" ? <Action label="Programar" onClick={() => void act("/transition", { to: "scheduled" })} /> : null}
        {running ? <Action label="Pausar" onClick={() => void act("/transition", { to: "on_hold" })} /> : null}
        {data.status === "on_hold" ? <Action label="Reanudar" onClick={() => void act("/transition", { to: "in_progress" })} /> : null}
        {data.status === "completed" ? <button className="primary" type="button" onClick={() => void act("/close")}>Cerrar orden</button> : null}
        {!["completed", "closed", "cancelled"].includes(data.status) ? (
          <Action
            label="Cancelar"
            onClick={() => {
              const reason = window.prompt("¿Por qué se cancela?");
              if (reason) void act("/transition", { to: "cancelled", reason });
            }}
          />
        ) : null}
      </div>
      {shortages.length ? (
        <p className="banner">Faltó material para apartar: {shortages.map((item) => `${item.sku} ${item.short}`).join(", ")}. Revisa MRP.</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <h2>Material</h2>
      <table>
        <thead><tr><th>Componente</th><th>Requerido</th><th>Apartado</th><th>Consumido</th><th>Disponible</th><th>Falta</th></tr></thead>
        <tbody>
          {data.materials.map((material) => (
            <tr key={material.id}>
              <td>{material.sku} · {material.name}</td>
              <td>{material.required} {material.stockUom}</td>
              <td>{material.allocated}</td>
              <td>{material.consumed}</td>
              <td>{material.available}</td>
              <td>{material.shortage !== "0" ? material.shortage : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {running ? (
        <form
          className="card"
          style={grid}
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = new FormData(form);
            void act("/consume", {
              materialId: values.get("materialId"),
              quantity: values.get("quantity"),
              spoolId: String(values.get("spoolId") || "") || undefined,
            }).then(() => form.reset());
          }}
        >
          <label>
            Material
            <select name="materialId" required>
              {data.materials.map((material) => <option key={material.id} value={material.id}>{material.sku}</option>)}
            </select>
          </label>
          <label>
            Rollo
            <select name="spoolId">
              <option value="">Sin rollo (a granel)</option>
              {(spools.data?.data ?? [])
                .filter((spool) => (spool.status === "available" || spool.status === "in_use") && data.materials.some((material) => material.componentProductId === spool.productId))
                .map((spool) => <option key={spool.id} value={spool.id}>{spool.spoolNumber} · {spool.sku} · {spool.currentGrams} g</option>)}
            </select>
          </label>
          <label>Cantidad<input name="quantity" required placeholder="120" /></label>
          <button className="primary" type="submit">Registrar consumo</button>
        </form>
      ) : null}
      <h2>Operaciones</h2>
      <table>
        <thead><tr><th>Sec.</th><th>Operación</th><th>Estación</th><th>Plan (min)</th><th>Real (min)</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {data.operations.map((operation) => (
            <tr key={operation.id}>
              <td>{operation.sequence}</td>
              <td>{operation.name}</td>
              <td>{operation.workCenterName}</td>
              <td>{operation.plannedMinutes}</td>
              <td>{operation.actualMinutes ?? "—"}</td>
              <td>{OPERATION_STATUS[operation.status] ?? operation.status}</td>
              <td style={{ display: "flex", gap: 8 }}>
                {running && operation.status === "pending" ? <Action label="Iniciar" onClick={() => void act(`/operations/${operation.id}`, { status: "running" })} /> : null}
                {running && operation.status !== "complete" && operation.status !== "skipped" ? (
                  <Action
                    label="Terminar"
                    onClick={() => {
                      const minutes = window.prompt("Minutos reales", operation.plannedMinutes);
                      if (minutes) void act(`/operations/${operation.id}`, { status: "complete", actualMinutes: minutes });
                    }}
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {running ? (
        <form
          className="card"
          style={grid}
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            void act("/complete", {
              quantityGood: values.get("quantityGood"),
              quantityScrapped: String(values.get("quantityScrapped") || "0"),
              scrapReason: String(values.get("scrapReason") || "") || undefined,
              shortReason: String(values.get("shortReason") || "") || undefined,
            });
          }}
        >
          <label>Piezas buenas<input name="quantityGood" required defaultValue={data.quantityOrdered} /></label>
          <label>Merma<input name="quantityScrapped" placeholder="0" /></label>
          <label>Motivo de merma<input name="scrapReason" /></label>
          <label>Si salieron menos, ¿por qué?<input name="shortReason" /></label>
          <button className="primary" type="submit">Terminar orden</button>
          <p style={{ margin: 0, gridColumn: "1 / -1" }}>Lo que falte por consumir según el BOM se descuenta automáticamente (backflush).</p>
        </form>
      ) : null}
      {data.status === "qc_hold" ? (
        <form
          className="card"
          style={grid}
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const failed = String(values.get("qtyFailed") || "0");
            void act("/inspections", {
              result: failed !== "0" ? "fail" : "pass",
              qtyPassed: values.get("qtyPassed"),
              qtyFailed: failed,
              defectTypeId: String(values.get("defectTypeId") || "") || undefined,
              disposition: String(values.get("disposition") || "") || undefined,
              notes: String(values.get("notes") || "") || undefined,
            });
          }}
        >
          <strong style={{ gridColumn: "1 / -1" }}>Inspección de calidad ({data.quantityCompleted} piezas)</strong>
          <label>Aprobadas<input name="qtyPassed" required defaultValue={data.quantityCompleted} /></label>
          <label>Rechazadas<input name="qtyFailed" placeholder="0" /></label>
          <label>
            Defecto
            <select name="defectTypeId">
              <option value="">—</option>
              {(defects.data?.data ?? []).map((defect) => <option key={defect.id} value={defect.id}>{defect.name}</option>)}
            </select>
          </label>
          <label>
            Qué hacer con las rechazadas
            <select name="disposition">
              <option value="">—</option>
              <option value="rework">Retrabajar</option>
              <option value="scrap">Desechar</option>
            </select>
          </label>
          <label>Notas<input name="notes" /></label>
          <button className="primary" type="submit">Registrar inspección</button>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              const reason = window.prompt("Motivo para liberar sin inspección");
              if (reason) void act("/waive-qc", { reason });
            }}
          >
            Liberar sin inspección
          </button>
        </form>
      ) : null}
      {data.consumptions.length ? (
        <>
          <h2>Consumos</h2>
          <table>
            <thead><tr><th>Cuándo</th><th>SKU</th><th>Rollo</th><th>Cantidad</th><th>Valor</th><th>Origen</th></tr></thead>
            <tbody>
              {data.consumptions.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleString("es-MX")}</td>
                  <td>{row.sku}</td>
                  <td>{row.spoolNumber ?? "—"}</td>
                  <td>{row.quantity}</td>
                  <td>{money(row.value)}</td>
                  <td>{row.source === "spool" ? "Rollo" : "Backflush"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {data.inspections.length ? (
        <>
          <h2>Inspecciones</h2>
          <table>
            <thead><tr><th>Cuándo</th><th>Resultado</th><th>Aprobadas</th><th>Rechazadas</th><th>Defecto</th><th>Destino</th></tr></thead>
            <tbody>
              {data.inspections.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleString("es-MX")}</td>
                  <td>{row.result === "pass" ? "Aprobada" : "Rechazada"}</td>
                  <td>{row.qtyPassed}</td>
                  <td>{row.qtyFailed}</td>
                  <td>{row.defect ?? "—"}</td>
                  <td>{row.disposition ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

export function QualityPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const queue = useQuery({ queryKey: ["quality-queue"], queryFn: () => api<{ data: ProductionOrder[] }>("/quality/queue") });
  const inspections = useQuery({
    queryKey: ["inspections"],
    queryFn: () => api<{ data: InspectionRow[]; stats: { total: number; failed: number; passRate: number | null } }>("/quality/inspections"),
  });
  const defects = useQuery({ queryKey: ["defect-types"], queryFn: () => api<{ data: Array<{ id: string; code: string; name: string }> }>("/quality/defect-types") });
  const settings = useQuery({ queryKey: ["quality-settings"], queryFn: () => api<{ qcGate: string }>("/quality/settings") });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Calidad</h1>
      <div className="card" style={grid}>
        <label>
          Si una inspección falla
          <select
            value={settings.data?.qcGate ?? "warn"}
            onChange={(event) =>
              void run(async () => {
                await api("/quality/settings", { method: "PATCH", body: JSON.stringify({ qcGate: event.target.value }) });
                await client.invalidateQueries({ queryKey: ["quality-settings"] });
              })
            }
          >
            <option value="off">No inspeccionar</option>
            <option value="warn">Registrar y dejar terminar</option>
            <option value="block">Bloquear hasta retrabajar o desechar</option>
          </select>
        </label>
        <p style={{ margin: 0 }}>
          {inspections.data?.stats.total ?? 0} inspecciones · {inspections.data?.stats.failed ?? 0} rechazadas
          {inspections.data?.stats.passRate !== null && inspections.data?.stats.passRate !== undefined ? ` · ${inspections.data.stats.passRate}% aprobadas` : ""}
        </p>
        {error ? <p className="error">{error}</p> : null}
      </div>
      <h2>Por inspeccionar</h2>
      {!queue.data?.data.length ? <p>No hay órdenes esperando inspección.</p> : (
        <ul>
          {queue.data.data.map((order) => (
            <li key={order.id}><Link to={`/app/produccion/${order.id}`}>{order.folio}</Link> · {order.sku} · {order.quantityCompleted} piezas</li>
          ))}
        </ul>
      )}
      <h2>Historial</h2>
      <table>
        <thead><tr><th>Cuándo</th><th>Orden</th><th>Producto</th><th>Resultado</th><th>Rechazadas</th><th>Defecto</th></tr></thead>
        <tbody>
          {(inspections.data?.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.createdAt).toLocaleString("es-MX")}</td>
              <td><Link to={`/app/produccion/${row.productionOrderId}`}>{row.folio}</Link></td>
              <td>{row.sku}</td>
              <td>{row.result === "pass" ? "Aprobada" : "Rechazada"}</td>
              <td>{row.qtyFailed}</td>
              <td>{row.defect ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Catálogo de defectos</h2>
      <form
        className="card"
        style={grid}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void run(async () => {
            await postJson("/quality/defect-types", { code: data.get("code"), name: data.get("name") });
            form.reset();
            await client.invalidateQueries({ queryKey: ["defect-types"] });
          });
        }}
      >
        <label>Clave<input name="code" required placeholder="BLOB" /></label>
        <label>Nombre<input name="name" required placeholder="Gotas / zits" /></label>
        <button className="primary" type="submit">Agregar defecto</button>
      </form>
      <ul>{(defects.data?.data ?? []).map((defect) => <li key={defect.id}>{defect.code} · {defect.name}</li>)}</ul>
    </section>
  );
}

export function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="ghost" type="button" onClick={onClick}>{label}</button>;
}

export interface ProductOption {
  id: string;
  sku: string;
  name: string;
  productType: string;
  stockUom: string;
  purchaseUom: string;
  cost: string | null;
}

interface Spool {
  id: string;
  spoolNumber: string;
  productId: string;
  sku: string;
  name: string;
  color: string | null;
  lotNumber: string | null;
  currentGrams: string;
  percentRemaining: number;
  status: string;
}

interface CountSummary {
  id: string;
  folio: string;
  reference: string;
  locationName: string;
  adjustments: number;
  varianceValue: string;
  createdAt: string;
}

interface CountResult {
  folio: string | null;
  adjustments: number;
  varianceValue: string;
  lines: Array<{ productId: string; sku: string; stockUom: string; systemQty: string; countedQty: string; variance: string; value: string }>;
}

interface WorkCenter {
  id: string;
  code: string;
  name: string;
  kind: string;
  hourlyRate: string;
  capacityHours: string;
}

interface BomSummary {
  bomId: string;
  productId: string;
  sku: string;
  name: string;
  version: number;
  lines: number;
  materialCost: string;
}

interface BomDetail {
  lines: Array<{ componentProductId: string; sku: string; name: string; stockUom: string; quantity: string; scrapPct: string; requiredPerUnit: string; extendedCost: string }>;
  materialCost: string;
  laborCost: string;
  unitCost: string;
  currentCost: string | null;
}

interface RoutingDetail {
  operations: Array<{ sequence: number; code: string; name: string; workCenterId: string; workCenterName: string; setupMinutes: string; runMinutes: string }>;
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
  materials: Array<{ id: string; componentProductId: string; sku: string; name: string; stockUom: string; required: string; allocated: string; consumed: string; available: string; shortage: string }>;
  operations: Array<{ id: string; sequence: number; name: string; workCenterName: string; plannedMinutes: string; actualMinutes: string | null; status: string }>;
  consumptions: Array<{ id: string; sku: string; spoolNumber: string | null; quantity: string; value: string; source: string; createdAt: string }>;
  inspections: Array<{ id: string; result: string; qtyPassed: string; qtyFailed: string; disposition: string | null; defect: string | null; createdAt: string }>;
}

interface InspectionRow {
  id: string;
  productionOrderId: string;
  folio: string;
  sku: string;
  result: string;
  qtyFailed: string;
  defect: string | null;
  createdAt: string;
}
