import { Modal } from "./modal";
import { Notice } from "./notice";
import { BackButton, BackLink } from "./back-control";
import { FilterAutocomplete } from "./filters";
import { EmptyState } from "./empty-state";
import { PURCHASE_TYPES, expenseKindForType, expenseTypeLabel, matchesPurchaseType } from "./purchase-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, download, postJson } from "./api";
import { useIdempotencyAttempt } from "./idempotency";
import { useFilaments, useProducts } from "./factory";
import { BanIcon, DownloadIcon, FormActions, NewLink, PayIcon, PlusIcon, QuoteButton, SaveButton, ViewLink, money, useError } from "./operations";
import { DetailSkeleton, FormSkeleton, TableSkeleton } from "./skeleton";
import { useRole, useCanWrite } from "./roles";
import { Paged } from "./pager";

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 } as const;

const EXPENSE_PAYMENT: Record<string, string> = {
  pending: "Por pagar",
  partial: "Parcial",
  paid: "Pagado",
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
                  {expense.paymentStatus !== "paid" ? <PayLink to={`/app/compras/gastos/${expense.id}#abono`} /> : null}
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

export function ExpenseNewPage() {
  const attempt = useIdempotencyAttempt();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { error, pendingKey, run } = useError();
  const [kind, setKind] = useState("filament");
  const [paid, setPaid] = useState(true);
  const [itemQuery, setItemQuery] = useState("");
  const products = useProducts();
  const filaments = useFilaments();
  const isGoods = ["product", "supply"].includes(kind);
  const goods = (products.data?.data ?? []).filter((item) => matchesPurchaseType(item, kind));
  const isCatalogItem = isGoods || kind === "filament";
  const items = kind === "filament" ? (filaments.data?.data ?? []).filter((item) => item.status !== "inactive") : goods;
  const itemLabel = kind === "filament" ? "Filamento" : kind === "supply" ? "Insumo" : "Producto";
  const selectedItem = items.find((item) => `${item.sku} · ${item.name}` === itemQuery);
  const today = todayInMexico();
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <BackLink to="/app/compras">Compras</BackLink>
      <h1>Registrar gasto</h1>
      <p>La fecha del gasto es el día en que aplica. Si ya lo pagaste, se registra el abono por el importe completo; si no, queda por pagar y lo abonas después desde el gasto.</p>
      {products.isPending || filaments.isPending ? <FormSkeleton fields={6} /> : (
      <form
        className="card form-vertical"
        onSubmit={(event) => {
          event.preventDefault();
          if (isCatalogItem && !selectedItem) return;
          const form = event.currentTarget;
          const data = new FormData(form);
          void run(async () => {
            const payload = {
              kind: expenseKindForType(String(data.get("kind"))),
              itemId: String(data.get("itemId") || "") || undefined,
              description: String(data.get("description") || "") || undefined,
              quantity: String(data.get("quantity") || "1"),
              amount: data.get("amount"),
              occurredOn: data.get("occurredOn"),
              paid,
              paidOn: paid ? data.get("paidOn") : undefined,
              note: String(data.get("note") || "") || undefined,
            };
            const created = await postJson<{ id: string }>("/expenses", payload, attempt.headers(payload));
            attempt.complete();
            await client.invalidateQueries({ queryKey: ["expenses"] });
            await client.invalidateQueries({ queryKey: ["filaments"] });
            await client.invalidateQueries({ queryKey: ["products"] });
            await client.invalidateQueries({ queryKey: ["inventory-catalog"] });
            navigate(`/app/compras/gastos/${created.id}`);
          });
        }}
      >
        <label>
          Tipo
          <select name="kind" value={kind} disabled={pendingKey !== null} onChange={(event) => { setKind(event.target.value); setItemQuery(""); }}>
            {Object.entries(PURCHASE_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {isCatalogItem ? (
          <>
            <FilterAutocomplete key={kind} label={itemLabel} value={itemQuery} onChange={setItemQuery}
              options={items.map((item) => `${item.sku} · ${item.name}`)} placeholder="Buscar por SKU o nombre"
              required disabled={pendingKey !== null} />
            <input type="hidden" name="itemId" value={selectedItem?.id ?? ""} />
            <p className="costing-hint" style={{ margin: 0 }}>Selecciona un artículo de las sugerencias para registrar el gasto.</p>
          </>
        ) : null}
        {kind === "filament" && !items.length ? (
          <EmptyState title="Sin filamentos disponibles" to="/app/filamentos/nuevo" actionLabel="Crear filamento">Agrega un filamento activo al catálogo para registrar su compra.</EmptyState>
        ) : null}
        {isGoods && !goods.length ? (
          <EmptyState title="Sin artículos disponibles para comprar" to={kind === "supply" ? "/app/insumos/nuevo" : "/app/productos/nuevo?abastecimiento=buy"} actionLabel={kind === "supply" ? "Crear insumo" : "Crear producto"}>
            No hay artículos activos de este tipo con compra habilitada. Agrega uno al catálogo.
          </EmptyState>
        ) : null}
        {kind === "service" || kind === "other" ? (
          <label>
            Descripción
            <input name="description" required placeholder={kind === "service" ? "Maquila, luz, mensajería…" : "Renta, refacciones…"} />
          </label>
        ) : null}
        {kind === "filament" ? <label>Kilogramos<input name="quantity" required placeholder="1" /></label> : null}
        {isGoods ? <label>Cantidad<input name="quantity" required placeholder="1" /></label> : null}
        <label>Fecha del gasto<input name="occurredOn" type="date" required defaultValue={today} /></label>
        <label>Importe<input name="amount" required inputMode="decimal" placeholder="250.00" /></label>
        <label className="check-field">
          <input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />
          Pagado
        </label>
        {paid ? (
          <label>Fecha del pago<input name="paidOn" type="date" required defaultValue={today} /></label>
        ) : null}
        <p className="costing-hint">
          {paid ? "Se registra un abono por el importe completo." : "Queda por pagar. Abónalo después desde el gasto."}
        </p>
        <label>Nota<input name="note" placeholder="Factura o proveedor" /></label>
        <FormActions>
          <SaveButton label="Guardar gasto" pending={pendingKey !== null} disabled={isCatalogItem && !selectedItem} />
          {error ? <p className="error">{error}</p> : null}
        </FormActions>
      </form>
      )}
    </section>
  );
}

export function ExpensePage() {
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
  const open = data.paymentStatus !== "paid";
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <BackLink to="/app/compras">Compras</BackLink>
      <h1>{data.folio}</h1>
      <p>
        {expenseTypeLabel(data)} · {data.description} · aplica el {showDay(data.occurredOn)} · <ExpensePaymentBadge status={data.paymentStatus} />
      </p>
      <div className="costing-kpis">
        <div><span>Importe</span><strong>{money(data.amount)}</strong></div>
        <div><span>Pagado</span><strong>{money(data.paid)}</strong></div>
        <div><span>Saldo</span><strong className={data.balance && Number(data.balance) > 0 ? "profit-negative" : undefined}>{money(data.balance)}</strong></div>
      </div>
      <div className="inventory-heading">
        <h2 style={{ margin: 0 }}>Abonos</h2>
        {open && canPay && (data.payments ?? []).length > 0 ? <button className="primary new-link" type="button" onClick={showAbono}><PlusIcon />Registrar abono</button> : null}
      </div>
      {!(data.payments ?? []).length ? <Notice title="Sin abonos registrados" action={open && canPay ? <button className="primary new-link" type="button" onClick={showAbono}><PlusIcon />Registrar abono</button> : undefined}>Todavía no hay pagos registrados para este gasto.</Notice> : (
      <Paged rows={data.payments ?? []}>
      {(payments) => (
      <table>
        <thead><tr><th>Fecha de pago</th><th>Cantidad</th><th>Nota</th></tr></thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td>{showDay(payment.paidOn)}</td>
              <td>{money(payment.amount)}</td>
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
      {!open ? <p className="muted-note">Este gasto ya está pagado.</p> : null}
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
  id: string;
  paidOn: string;
  amount: string | null;
  note: string | null;
}

interface ExpenseDetail extends Expense {
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
