import { Modal } from "./modal";
import { Notice } from "./notice";
import { BackButton, BackLink } from "./back-control";
import { matchesText } from "./filters";
import { addPurchaseItem, purchaseCartSummary, type PurchaseCartLine, type PurchaseCatalogItem } from "./purchase-cart";
import { uomShort } from "@3dprintmty/domain";
import { EmptyState } from "./empty-state";
import { PURCHASE_TYPES, expenseTypeLabel, matchesPurchaseType } from "./purchase-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, download, postJson } from "./api";
import { useIdempotencyAttempt } from "./idempotency";
import { useFilaments, type ProductOption } from "./factory";
import { BanIcon, DownloadIcon, FormActions, NewLink, PayIcon, PlusIcon, QuoteButton, SaveButton, TrashIcon, IconAction, ViewLink, money, useError } from "./operations";
import { DetailSkeleton, TableSkeleton } from "./skeleton";
import { useRole, useCanWrite } from "./roles";
import { Paged } from "./pager";

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 } as const;

const EXPENSE_PAYMENT: Record<string, string> = {
  pending: "Por pagar",
  partial: "Parcial",
  paid: "Pagado",
  canceled: "Cancelado",
};

function todayInMexico() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

function ExpensePaymentBadge({ status }: { status: string }) {
  return <span className={`res res-badge pay-${status}`}>{EXPENSE_PAYMENT[status] ?? status}</span>;
}

function PayLink({ to }: { to: string }) {
  if (!useCanWrite("/app/compras")) return null;
  return (
    <Link className="icon-btn pay" to={to} aria-label="Abonar" title="Abonar">
      <PayIcon />
    </Link>
  );
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function showDay(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function PurchasingPage() {
  const expenses = useQuery({ queryKey: ["expenses"], queryFn: () => api<{ data: Expense[] }>("/expenses") });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Compras</h1>
        <NewLink to="/app/compras/nuevo">Registrar gasto</NewLink>
      </div>
      <p>La fecha del gasto es el día en que aplica. El pago puede ser parcial o en otra fecha. Un filamento, insumo o producto entra a existencia; un servicio pagado solo se describe y no usa el catálogo de lo que vendes.</p>
      {expenses.isPending ? <TableSkeleton columns={8} /> : expenses.isError ? (
        <Notice tone="error" title="No se pudieron cargar las compras" action={<button className="ghost" type="button" onClick={() => void expenses.refetch()}>Reintentar</button>}>
          Intenta nuevamente para consultar los gastos registrados.
        </Notice>
      ) : !expenses.data?.data.length ? (
        <EmptyState title="Sin gastos registrados" to="/app/compras/nuevo" actionLabel="Registrar gasto">
          Registra tu primera compra o gasto para llevar el control de sus importes, pagos y entradas al inventario.
        </EmptyState>
      ) : (
      <Paged rows={expenses.data?.data ?? []}>
      {(pageExpenses) => (
      <table>
        <thead><tr><th>Folio</th><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Importe</th><th>Pagado</th><th>Saldo</th><th></th></tr></thead>
        <tbody>
          {pageExpenses.map((expense) => (
            <tr key={expense.id}>
              <td><Link to={`/app/compras/gastos/${expense.id}`}>{expense.folio}</Link></td>
              <td>{showDay(expense.occurredOn)}</td>
              <td>{expenseTypeLabel(expense)}</td>
              <td>{expense.description}</td>
              <td>{money(expense.amount)}</td>
              <td>{money(expense.paid)} <ExpensePaymentBadge status={expense.paymentStatus} /></td>
              <td>{money(expense.balance)}</td>
              <td>
                <div className="record-actions">
                  <ViewLink to={`/app/compras/gastos/${expense.id}`} />
                  {expense.paymentStatus !== "paid" && !expense.canceledAt ? <PayLink to={`/app/compras/gastos/${expense.id}#abono`} /> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      </Paged>
      )}

    </section>
  );
}

async function purchaseProducts() {
  const first = await api<{ data: ProductOption[]; total: number }>("/products?limit=100");
  const data = [...first.data];
  for (let page = 2; data.length < first.total; page++) {
    const next = await api<{ data: ProductOption[] }>(`/products?limit=100&page=${page}`);
    if (!next.data.length) break;
    data.push(...next.data);
  }
  return { data };
}

export function ExpenseNewPage() {
  const attempt = useIdempotencyAttempt();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { error, pendingKey, run } = useError();
  const [lines, setLines] = useState<PurchaseCartLine[]>([]);
  const [paid, setPaid] = useState(true);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const products = useQuery({ queryKey: ["products", "purchase-options"], queryFn: purchaseProducts });
  const filaments = useFilaments();
  const today = todayInMexico();
  const pending = pendingKey !== null;
  const catalog: PurchaseCatalogItem[] = [
    ...(filaments.data?.data ?? []).filter((item) => item.status !== "inactive").map((item) => ({ id: item.id, sku: item.sku, name: item.name, type: "filament" as const, cost: item.cost, purchaseUom: "KG" })),
    ...(products.data?.data ?? []).flatMap<PurchaseCatalogItem>((item) => {
      const itemType = matchesPurchaseType(item, "product") ? "product" : matchesPurchaseType(item, "supply") ? "supply" : null;
      return itemType ? [{ id: item.id, sku: item.sku, name: item.name, type: itemType, cost: item.cost, purchaseUom: item.purchaseUom }] : [];
    }),
  ];
  const visible = catalog.filter((item) => (type === "all" || item.type === type) && matchesText(search, item.sku, item.name));
  let summary: ReturnType<typeof purchaseCartSummary> | null = null;
  let captureError: string | null = null;
  try { summary = purchaseCartSummary(lines); } catch (cause) { captureError = cause instanceof Error ? cause.message : "Revisa cantidades y costos."; }
  function patch(key: string, value: Partial<PurchaseCartLine>) { setLines((current) => current.map((line) => line.key === key ? { ...line, ...value } : line)); }
  function addManual(kind: "service" | "other") {
    setLines((current) => [...current, { key: crypto.randomUUID(), type: kind, name: "", sku: "", purchaseUom: "PZA", quantity: "1", unitCost: "" }]);
  }
  return <section className="pos-page purchase-page">
    <BackLink to="/app/compras">Compras</BackLink>
    <header><h1>Registrar compra o gasto</h1><p className="muted-note">Selecciona artículos, ajusta cantidades y guarda. El costo del catálogo se carga automáticamente.</p></header>
    <div className="pos-layout">
      <section className="card pos-catalog" aria-label="Artículos para comprar">
        <h2>Artículos</h2>
        <div className="pos-catalog-tools">
          <label>Buscar artículos<input type="search" placeholder="Nombre o SKU" value={search} disabled={pending} onChange={(event) => setSearch(event.target.value)} /></label>
          <label>Tipo<select value={type} disabled={pending} onChange={(event) => setType(event.target.value)}><option value="all">Todos los artículos</option>{Object.entries(PURCHASE_TYPES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        </div>
        {products.isPending || filaments.isPending ? <TableSkeleton columns={3} /> : products.isError || filaments.isError ? <Notice title="No se pudieron cargar los artículos" tone="error" action={<button type="button" className="ghost" onClick={() => { void products.refetch(); void filaments.refetch(); }}>Reintentar</button>}>Vuelve a intentar para seleccionar artículos del catálogo.</Notice> : type === "service" || type === "other" ?
          <Notice title={type === "service" ? "Servicio comprado" : "Otro gasto"} action={<button className="ghost new-link" type="button" disabled={pending || lines.length >= 100} onClick={() => addManual(type as "service" | "other")}><PlusIcon />Agregar {type === "service" ? "servicio" : "gasto"}</button>}>Captura la descripción y el costo en la compra actual.</Notice> : !visible.length ?
          <EmptyState title={search || type !== "all" ? "Sin coincidencias" : "Sin artículos para comprar"} to={type === "filament" ? "/app/filamentos/nuevo" : type === "supply" ? "/app/insumos/nuevo" : "/app/productos/nuevo?abastecimiento=buy"} actionLabel="Crear artículo">{search || type !== "all" ? "Busca otro nombre, SKU o tipo de artículo." : "Agrega filamentos, productos de reventa o insumos al catálogo."}</EmptyState> : <>
            <p className="costing-hint">Costo por unidad de compra. Puedes ajustarlo antes de guardar.</p>
            <Paged rows={visible}>{(items) => <div className="pos-items">{items.map((item) => <button type="button" className="pos-item" key={`${item.type}:${item.id}`} disabled={pending || lines.length >= 100} onClick={() => setLines((current) => addPurchaseItem(current, item))}>
              <span className="pos-item-code">{item.sku} · {PURCHASE_TYPES[item.type]}</span><strong>{item.name}</strong>
              <span>{item.cost === null ? "Capturar costo" : money(item.cost)}</span><small>Por {uomShort(item.purchaseUom)}</small>
            </button>)}</div>}</Paged>
          </>}
        <div className="purchase-manual-actions"><button type="button" className="ghost new-link" disabled={pending || lines.length >= 100} onClick={() => addManual("service")}><PlusIcon />Agregar servicio</button><button type="button" className="ghost new-link" disabled={pending || lines.length >= 100} onClick={() => addManual("other")}><PlusIcon />Otro gasto</button></div>
      </section>
      <form className="card pos-checkout" onSubmit={(event) => {
        event.preventDefault();
        if (!summary || !lines.length) return;
        const data = new FormData(event.currentTarget);
        void run(async () => {
          const payload = { lines: summary.lines, occurredOn: data.get("occurredOn"), paid, paidOn: paid ? data.get("paidOn") : undefined, note: String(data.get("note") || "") || undefined };
          const created = await postJson<{ id: string }>("/expenses", payload, attempt.headers(payload));
          attempt.complete();
          for (const key of ["expenses", "filaments", "products", "product", "inventory-catalog", "inventory", "balances", "lots", "pos-catalog", "dashboard"]) void client.invalidateQueries({ queryKey: [key] });
          navigate(`/app/compras/gastos/${created.id}`);
        });
      }}>
        <h2>Compra actual <span className="costing-hint">{lines.length} partidas</span></h2>
        <fieldset disabled={pending}>
          <div className="pos-cart">{!lines.length ? <Notice title="Compra vacía">Selecciona un artículo o agrega un servicio u otro gasto para empezar.</Notice> : lines.map((line) => {
            let amount: string | null = null;
            try { amount = purchaseCartSummary([line]).total; } catch { /* Captura incompleta. */ }
            return <article className="pos-cart-line" key={line.key}>
              <div className="pos-cart-heading"><strong>{line.itemId ? line.name : line.type === "service" ? "Servicio comprado" : "Otro gasto"}</strong><IconAction label={`Quitar ${line.name || "partida"}`} tone="delete" disabled={pending} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><TrashIcon /></IconAction></div>
              {line.itemId ? <p className="costing-hint">{line.sku} · {PURCHASE_TYPES[line.type]}</p> : <label>Descripción<input required maxLength={180} value={line.name} placeholder={line.type === "service" ? "Maquila, mensajería…" : "Renta, refacciones…"} onChange={(event) => patch(line.key, { name: event.target.value })} /></label>}
              <div className="pos-line-inputs">
                <label>{line.type === "filament" ? "Kilogramos" : `Cantidad (${uomShort(line.purchaseUom)})`}<input type="number" min="0.0001" step="0.0001" required value={line.quantity} onChange={(event) => patch(line.key, { quantity: event.target.value })} /></label>
                <label>Costo unitario MXN<input type="number" min="0" step="0.01" inputMode="decimal" required placeholder="0.00" value={line.unitCost} onChange={(event) => patch(line.key, { unitCost: event.target.value })} /></label>
                <div className="purchase-line-amount"><span>Importe</span><strong>{money(amount)}</strong></div>
              </div>
            </article>;
          })}</div>
          {lines.length ? <button type="button" className="ghost" onClick={() => setLines([])}>Vaciar compra</button> : null}
          <dl className="pos-totals"><div className="pos-total"><dt>Total MXN</dt><dd>{money(summary?.total)}</dd></div></dl>
          <label className="pos-checkbox"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />Compra pagada</label>
          <p className="costing-hint">{paid ? "Se registra el pago completo al guardar." : "Queda por pagar; puedes registrar abonos después."}</p>
          {paid ? <label>Fecha del pago<input name="paidOn" type="date" required defaultValue={today} /></label> : null}
          <details className="purchase-extra"><summary>Fecha de compra y nota</summary><div>
            <label>Fecha de la compra<input name="occurredOn" type="date" required defaultValue={today} /></label>
            <label>Nota<input name="note" maxLength={240} placeholder="Factura o proveedor" /></label>
          </div></details>
          <p className="costing-hint">Los artículos entran al inventario al guardar. El filamento se captura en kg y se recibe en gramos.</p>
        </fieldset>
        {captureError ? <Notice title="Completa la compra">{captureError}</Notice> : null}
        <FormActions><SaveButton label={`Guardar compra ${money(summary?.total)}`} pending={pending} disabled={!lines.length || summary === null} />{error ? <Notice title="No se pudo guardar la compra" tone="error">{error}</Notice> : null}</FormActions>
      </form>
    </div>
  </section>;
}

export function ExpensePage() {
  const attempt = useIdempotencyAttempt();
  const [cancelOpen, setCancelOpen] = useState(false);
  const canPay = useCanWrite("/app/compras");
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const abonoOpen = location.hash === "#abono";
  const showAbono = () => navigate({ pathname: location.pathname, search: location.search, hash: "#abono" }, { replace: true });
  const closeAbono = () => navigate({ pathname: location.pathname, search: location.search, hash: "" }, { replace: true });
  const client = useQueryClient();
  const { error, pendingKey, run } = useError();
  const expense = useQuery({ queryKey: ["expense", id], queryFn: () => api<ExpenseDetail>(`/expenses/${id}`) });
  const today = todayInMexico();
  if (expense.isPending) return <DetailSkeleton />;
  if (!expense.data) return <p className="error">No se pudo cargar el gasto.</p>;
  const data = expense.data;
  const open = !data.canceledAt && data.paymentStatus !== "paid";
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <BackLink to="/app/compras">Compras</BackLink>
      <div className="inventory-heading"><h1 style={{ margin: 0 }}>{data.folio}</h1>
        {canPay && !data.canceledAt ? <button className="quote-btn danger" type="button" onClick={() => setCancelOpen(true)}><BanIcon />Cancelar gasto y pagos</button> : null}
      </div>
      {data.canceledAt ? <Notice title="Gasto cancelado">{data.cancellationReason} · {new Date(data.canceledAt).toLocaleString("es-MX")} · Los pagos quedaron cancelados y el saldo es cero.</Notice> : null}
      <p>
        {expenseTypeLabel(data)} · {data.description} · aplica el {showDay(data.occurredOn)} · <ExpensePaymentBadge status={data.paymentStatus} />
      </p>
      <div className="costing-kpis">
        <div><span>Importe</span><strong>{money(data.amount)}</strong></div>
        <div><span>Pagado</span><strong>{money(data.paid)}</strong></div>
        <div><span>Saldo</span><strong className={data.balance && Number(data.balance) > 0 ? "profit-negative" : undefined}>{money(data.balance)}</strong></div>
      </div>
      {data.lines?.length ? <section>
        <h2>Partidas de la compra</h2>
        <Paged rows={data.lines}>{(pageLines) => <div className="scroll-x"><table>
          <thead><tr><th>Tipo</th><th>Descripción</th><th>Cantidad</th><th>Unidad de compra</th><th>Importe</th></tr></thead>
          <tbody>{pageLines.map((line) => <tr key={line.id}><td>{expenseTypeLabel(line)}</td><td>{line.description}</td><td>{line.quantity}</td><td>{line.purchaseUom}</td><td>{money(line.amount)}</td></tr>)}</tbody>
        </table></div>}</Paged>
      </section> : null}
      <div className="inventory-heading">
        <h2 style={{ margin: 0 }}>Abonos</h2>
        {open && canPay && (data.payments ?? []).length > 0 ? <button className="primary new-link" type="button" onClick={showAbono}><PlusIcon />Registrar abono</button> : null}
      </div>
      {!(data.payments ?? []).length ? <Notice title="Sin abonos registrados" action={open && canPay ? <button className="primary new-link" type="button" onClick={showAbono}><PlusIcon />Registrar abono</button> : undefined}>Todavía no hay pagos registrados para este gasto.</Notice> : (
      <Paged rows={data.payments ?? []}>
      {(payments) => (
      <table>
        <thead><tr><th>Fecha de pago</th><th>Cantidad</th><th>Estado</th><th>Nota</th></tr></thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td>{showDay(payment.paidOn)}</td>
              <td>{money(payment.amount)}</td>
              <td><ExpensePaymentBadge status={payment.canceledAt ? "canceled" : "paid"} /></td>
              <td>{payment.note ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      </Paged>
      )}
      {open && canPay && abonoOpen ? (
        <Modal title="Registrar abono" onClose={closeAbono} closeDisabled={pendingKey !== null}>
          <p style={{ margin: 0 }}>{data.folio} · {data.description} · Saldo pendiente: <strong>{money(data.balance)}</strong></p>
        <form
          className="form-vertical"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const body = new FormData(form);
            void run(async () => {
              await postJson(`/expenses/${id}/payments`, {
                amount: body.get("amount"),
                paidOn: body.get("paidOn"),
                note: String(body.get("note") || "") || undefined,
              });
              form.reset();
              await client.invalidateQueries({ queryKey: ["expense", id] });
              await client.invalidateQueries({ queryKey: ["expenses"] });
              closeAbono();
            });
          }}
        >
          <label>Fecha de pago<input name="paidOn" type="date" disabled={pendingKey !== null} required defaultValue={today} /></label>
          <label>Cantidad<input key={data.balance ?? ""} name="amount" disabled={pendingKey !== null} required inputMode="decimal" defaultValue={data.balance ?? ""} /></label>
          <p className="costing-hint">Por defecto se liquida el saldo. Cambia la cantidad para un abono parcial.</p>
          <label>Nota<input name="note" disabled={pendingKey !== null} /></label>
          <FormActions>
            <SaveButton label="Registrar abono" pending={pendingKey !== null} />
            <BackButton onClick={closeAbono} disabled={pendingKey !== null} />
          </FormActions>
          {error ? <Notice tone="error" title="No se pudo registrar el abono">{error}</Notice> : null}
        </form>
        </Modal>
      ) : null}
      {cancelOpen && !data.canceledAt ? <Modal title="Cancelar gasto y pagos" onClose={() => setCancelOpen(false)} closeDisabled={pendingKey !== null}>
        <p>Se cancelarán {data.folio} y todos sus abonos. Si la compra generó inventario, sus entradas se revertirán. El historial se conservará. Esta acción no realiza devoluciones bancarias.</p>
        <form className="form-vertical" onSubmit={(event) => {
          event.preventDefault();
          const payload = { reason: String(new FormData(event.currentTarget).get("reason") || "").trim() };
          void run(async () => {
            await postJson(`/expenses/${id}/cancel`, payload, attempt.headers(payload));
            attempt.complete();
            setCancelOpen(false);
            const affected = new Set(["expense", "expenses", "dashboard", "products", "product", "filaments", "inventory-catalog", "inventory", "inventory-ledger", "balances", "lots", "pos-catalog", "boms", "bom"]);
            await client.invalidateQueries({ predicate: query => affected.has(String(query.queryKey[0])) });
          });
        }}>
          <label>Motivo de cancelación<textarea name="reason" required minLength={3} maxLength={240} disabled={pendingKey !== null} /></label>
          <FormActions><SaveButton label="Cancelar gasto y pagos" pending={pendingKey !== null} /><BackButton onClick={() => setCancelOpen(false)} disabled={pendingKey !== null} /></FormActions>
          {error ? <Notice tone="error" title="No se pudo cancelar el gasto">{error}</Notice> : null}
        </form>
      </Modal> : null}
      {!open && !data.canceledAt ? <p className="muted-note">Este gasto ya está pagado.</p> : null}
    </section>
  );
}

export function PrefacturasPage() {
  const attempt = useIdempotencyAttempt();
  const operator = useRole() === "operator";
  const client = useQueryClient();
  const { error, pendingKey, run } = useError();
  const documents = useQuery({ queryKey: ["prefacturas"], queryFn: () => api<{ data: Prefactura[] }>("/prefacturas") });
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<{ data: Array<{ id: string; folio: string; customerName: string; status: string }> }>("/orders"),
  });
  const today = new Date().toLocaleDateString("en-CA");
  const monthStart = `${today.slice(0, 8)}01`;
  const [period, setPeriod] = useState({ from: monthStart, to: today });
  const billable = (orders.data?.data ?? []).filter((order) =>
    ["confirmed", "in_production", "ready_to_ship", "shipped", "delivered", "completed"].includes(order.status),
  );
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Prefacturas</h1>
      <p className="banner">Prefactura / Nota de venta — no es un CFDI. Tu contador timbra la factura con estos datos.</p>
      <form
        className="card"
        style={grid}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(async () => {
            const payload = { salesOrderId: data.get("salesOrderId") };
            await postJson("/prefacturas", payload, attempt.headers(payload));
            attempt.complete();
            await client.invalidateQueries({ queryKey: ["prefacturas"] });
          }, "issue");
        }}
      >
        <label>
          Pedido
          <select name="salesOrderId" required>
            {billable.map((order) => <option key={order.id} value={order.id}>{order.folio} · {order.customerName}</option>)}
          </select>
        </label>
        <button className="primary new-link form-inline-submit" type="submit" disabled={pendingKey !== null} aria-busy={pendingKey === "issue"}>
          <PlusIcon />
          Emitir prefactura
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      {operator ? null : <div className="card" style={grid}>
        <strong style={{ gridColumn: "1 / -1" }}>Paquete para el contador</strong>
        <label>Desde<input type="date" value={period.from} onChange={(event) => setPeriod({ ...period, from: event.target.value })} /></label>
        <label>Hasta<input type="date" value={period.to} onChange={(event) => setPeriod({ ...period, to: event.target.value })} /></label>
        <div className="quote-actions-row" style={{ gridColumn: "1 / -1" }}>
          <QuoteButton label="Descargar ZIP" tone="doc" icon={<DownloadIcon />} pending={pendingKey === "zip"} disabled={pendingKey !== null} onClick={() => void run(() => download(`/exports/accountant?from=${period.from}&to=${period.to}&format=zip`, `paquete_contador_${period.from}_${period.to}.zip`), "zip")} />
          <QuoteButton label="Solo CSV" tone="neutral" icon={<DownloadIcon />} pending={pendingKey === "csv"} disabled={pendingKey !== null} onClick={() => void run(() => download(`/exports/accountant?from=${period.from}&to=${period.to}&format=csv`, `prefacturas_${period.from}_${period.to}.csv`), "csv")} />
        </div>
      </div>
      }
      {documents.isPending ? <TableSkeleton columns={6} /> : (
      <Paged rows={documents.data?.data ?? []}>
      {(pageDocuments) => (
      <table>
        <thead><tr><th>Folio</th><th>Cliente</th><th>RFC</th><th>Método</th><th>Total</th><th>Estado</th></tr></thead>
        <tbody>
          {pageDocuments.map((document) => (
            <tr key={document.id}>
              <td><Link to={`/app/prefacturas/${document.id}`}>{document.number}</Link></td>
              <td>{document.receiverName}</td>
              <td>{document.receiverRfc}</td>
              <td>{document.intendedPayment}</td>
              <td>{money(document.total)}</td>
              <td>{document.status === "issued" ? (document.incomplete ? "Vigente · datos incompletos" : "Vigente") : "Cancelada"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      </Paged>
      )}
    </section>
  );
}

export function PrefacturaPage() {
  const operator = useRole() === "operator";
  const { id } = useParams();
  const client = useQueryClient();
  const { error, pendingKey, run } = useError();
  const document = useQuery({ queryKey: ["prefactura", id], queryFn: () => api<PrefacturaDetail>(`/prefacturas/${id}`) });
  if (document.isPending) return <DetailSkeleton />;
  if (!document.data) return <p className="error">No se pudo cargar la prefactura.</p>;
  const data = document.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div className="no-print"><BackLink to="/app/prefacturas">Prefacturas</BackLink></div>
      <article className="card printable" style={{ display: "grid", gap: 12 }}>
        <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={{ margin: 0 }}>{data.title}</h1>
            <p style={{ margin: 0 }}>Serie {data.series} · Folio {data.folio} · {new Date(data.issuedAt).toLocaleDateString("es-MX")}</p>
            {data.status === "void" ? <p className="error">CANCELADA: {data.voidReason}</p> : null}
          </div>
          <div style={{ textAlign: "right" }}>
            <strong>{data.emitter.legalName}</strong>
            <p style={{ margin: 0 }}>RFC {data.emitter.rfc} · Régimen {data.emitter.taxRegime} · CP {data.emitter.postalCode}</p>
          </div>
        </header>
        <div>
          <strong>Receptor</strong>
          <p style={{ margin: 0 }}>
            {data.receiver.legalName} · RFC {data.receiver.rfc} · CP {data.receiver.postalCode}
            {data.receiver.cfdiUse ? ` · Uso CFDI ${data.receiver.cfdiUse}` : ""}
            {data.receiver.taxRegime ? ` · Régimen ${data.receiver.taxRegime}` : ""}
          </p>
        </div>
        <Paged rows={data.lines}>
        {(lines) => (
        <table>
          <thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio</th><th>Descuento</th><th>Importe</th><th>IVA</th></tr></thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td>{line.quantity}</td>
                <td>{money(line.unitPrice)}</td>
                <td>{money(line.discount)}</td>
                <td>{money(line.net)}</td>
                <td>{money(line.vat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        </Paged>
        <div style={{ justifySelf: "end", textAlign: "right" }}>
          <p style={{ margin: 0 }}>Subtotal {money(data.subtotal)}</p>
          {data.discount !== "0.00" ? <p style={{ margin: 0 }}>Descuento {money(data.discount)}</p> : null}
          {data.shipping !== "0.00" ? <p style={{ margin: 0 }}>Envío {money(data.shipping)}</p> : null}
          <p style={{ margin: 0 }}>IVA {money(data.vat)}</p>
          <p style={{ margin: 0, fontSize: 20 }}><strong>Total {money(data.total)} {data.currency}</strong></p>
        </div>
        <p style={{ margin: 0 }}>
          Método de pago previsto {data.intendedPayment} · Forma de pago {data.satPaymentForm} · Método según cobros {data.satPaymentTiming} · Saldo {money(data.amountDue)}
          {data.orderFolio ? ` · Pedido ${data.orderFolio}` : ""}
        </p>
        {Array.isArray(data.warnings) && data.warnings.length ? (
          <ul>{data.warnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}</ul>
        ) : null}
        <p style={{ margin: 0, fontWeight: 600 }}>{data.notice}</p>
      </article>
      <div className="card quote-actions no-print">
        <div className="quote-actions-group">
          <span className="quote-actions-label">Documento</span>
          <div className="quote-actions-row">
            <QuoteButton label="Imprimir" tone="doc" icon={<PrintIcon />} onClick={() => window.print()} />
            {!operator && data.status === "issued" ? (
              <QuoteButton
                label="Cancelar prefactura"
                tone="danger"
                icon={<BanIcon />}
                pending={pendingKey === "void"}
                disabled={pendingKey !== null}
                onClick={() => {
                  const reason = window.prompt("Motivo de cancelación");
                  if (!reason) return;
                  void run(async () => {
                    await postJson(`/prefacturas/${id}/void`, { reason });
                    await client.invalidateQueries({ queryKey: ["prefactura", id] });
                    await client.invalidateQueries({ queryKey: ["prefacturas"] });
                  }, "void");
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
      {error ? <p className="error no-print">{error}</p> : null}
    </section>
  );
}

interface Expense {
  canceledAt: string | null;
  cancellationReason: string | null;
  id: string;
  folio: string;
  kind: string;
  itemClass?: string | null;
  supplyMode?: string | null;
  description: string;
  quantity: string;
  occurredOn: string;
  amount: string | null;
  paid: string | null;
  balance: string | null;
  paymentStatus: string;
}

interface ExpensePayment {
  canceledAt: string | null;
  id: string;
  paidOn: string;
  amount: string | null;
  note: string | null;
}

interface ExpenseDetail extends Expense {
  lines: Array<{ id: string; kind: string; description: string; quantity: string; purchaseUom: string; amount: string | null; itemClass: string | null; supplyMode: string | null }>;
  payments: ExpensePayment[];
}

interface Vendor {
  id: string;
  name: string;
  active: boolean;
}

interface Prefactura {
  id: string;
  number: string;
  receiverName: string;
  receiverRfc: string;
  intendedPayment: string;
  total: string;
  status: string;
  incomplete: boolean;
}

interface Party {
  legalName: string;
  rfc: string;
  postalCode: string;
  taxRegime?: string;
  cfdiUse?: string;
}

interface PrefacturaDetail extends Prefactura {
  title: string;
  series: string;
  folio: number;
  issuedAt: string;
  voidReason: string | null;
  emitter: Party;
  receiver: Party;
  lines: Array<{ id: string; description: string; quantity: string; unitPrice: string; discount: string; net: string; vat: string }>;
  subtotal: string;
  discount: string;
  shipping: string;
  vat: string;
  currency: string;
  satPaymentForm: string;
  satPaymentTiming: string;
  amountDue: string;
  orderFolio: string | null;
  warnings: Array<{ code: string; message: string }>;
  notice: string;
}
