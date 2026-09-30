import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, download, idempotencyHeader, postJson } from "./api";
import { Action, useFilaments, useProducts } from "./factory";
import { FormActions, NewLink, SaveButton, ViewLink, money, useError } from "./operations";
import { DetailSkeleton, FormSkeleton, TableSkeleton } from "./skeleton";
import { Paged } from "./pager";

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 } as const;

const PO_STATUS: Record<string, string> = {
  draft: "Borrador",
  ordered: "Colocada",
  partially_received: "Recibida parcial",
  received: "Recibida",
  closed: "Cerrada",
  cancelled: "Cancelada",
};

const EXPENSE_KIND: Record<string, string> = {
  product: "Producto",
  filament: "Filamento",
  service: "Servicio",
  other: "Otro",
};

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
  return (
    <Link className="icon-btn pay" to={to} aria-label="Abonar" title="Abonar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="2" />
        <path d="M6 12h.01M18 12h.01" />
      </svg>
    </Link>
  );
}

function showDay(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function PurchasingPage() {
  const expenses = useQuery({ queryKey: ["expenses"], queryFn: () => api<{ data: Expense[] }>("/expenses") });
  const orders = useQuery({ queryKey: ["purchase-orders"], queryFn: () => api<{ data: PurchaseOrder[] }>("/purchase-orders") });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Compras</h1>
        <NewLink to="/app/compras/nuevo">Registrar gasto</NewLink>
      </div>
      <p>La fecha del gasto es el día en que aplica. El pago puede ser parcial o en otra fecha. Un filamento, insumo o producto entra a existencia; un servicio pagado solo se describe y no usa el catálogo de lo que vendes.</p>
      {expenses.isPending ? <TableSkeleton columns={8} /> : (
      <Paged rows={expenses.data?.data ?? []}>
      {(pageExpenses) => (
      <table>
        <thead><tr><th>Folio</th><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Importe</th><th>Pagado</th><th>Saldo</th><th></th></tr></thead>
        <tbody>
          {pageExpenses.map((expense) => (
            <tr key={expense.id}>
              <td><Link to={`/app/compras/gastos/${expense.id}`}>{expense.folio}</Link></td>
              <td>{showDay(expense.occurredOn)}</td>
              <td>{EXPENSE_KIND[expense.kind] ?? expense.kind}</td>
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
      {(orders.data?.data.length ?? 0) > 0 ? (
        <>
          <h2>Órdenes anteriores</h2>
          <Paged rows={orders.data?.data ?? []}>
          {(pageOrders) => (
          <table>
            <thead><tr><th>Folio</th><th>Proveedor</th><th>Estado</th><th>Total</th></tr></thead>
            <tbody>
              {pageOrders.map((order) => (
                <tr key={order.id}>
                  <td><Link to={`/app/compras/${order.id}`}>{order.folio}</Link></td>
                  <td>{order.vendorName}</td>
                  <td>{PO_STATUS[order.status] ?? order.status}</td>
                  <td>{money(order.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          </Paged>
        </>
      ) : null}
    </section>
  );
}

export function ExpenseNewPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { error, pendingKey, run } = useError();
  const [kind, setKind] = useState("filament");
  const [paid, setPaid] = useState(true);
  const products = useProducts();
  const filaments = useFilaments();
  const goods = (products.data?.data ?? []).filter((product) => product.productType !== "service");
  const today = todayInMexico();
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/compras">Compras</Link></p>
      <h1>Registrar gasto</h1>
      <p>La fecha del gasto es el día en que aplica. Si ya lo pagaste, se registra el abono por el importe completo; si no, queda por pagar y lo abonas después desde el gasto.</p>
      {products.isPending || filaments.isPending ? <FormSkeleton fields={6} /> : (
      <form
        className="card form-vertical"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void run(async () => {
            const created = await postJson<{ id: string }>("/expenses", {
              kind: data.get("kind"),
              itemId: String(data.get("itemId") || "") || undefined,
              description: String(data.get("description") || "") || undefined,
              quantity: String(data.get("quantity") || "1"),
              amount: data.get("amount"),
              occurredOn: data.get("occurredOn"),
              paid,
              paidOn: paid ? data.get("paidOn") : undefined,
              note: String(data.get("note") || "") || undefined,
            });
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
          <select name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="filament">Filamento</option>
            <option value="product">Producto</option>
            <option value="service">Servicio</option>
            <option value="other">Otro</option>
          </select>
        </label>
        {kind === "filament" ? (
          <label>
            Filamento
            <select name="itemId" required>
              {(filaments.data?.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
            </select>
          </label>
        ) : null}
        {kind === "product" ? (
          <label>
            Producto
            <select name="itemId" required>
              {goods.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
            </select>
          </label>
        ) : null}
        {kind === "service" || kind === "other" ? (
          <label>
            Descripción
            <input name="description" required placeholder={kind === "service" ? "Maquila, luz, mensajería…" : "Renta, refacciones…"} />
          </label>
        ) : null}
        {kind === "filament" ? <label>Kilogramos<input name="quantity" required placeholder="1" /></label> : null}
        {kind === "product" ? <label>Cantidad<input name="quantity" required placeholder="1" /></label> : null}
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
          <SaveButton label="Guardar gasto" pending={pendingKey !== null} />
          {error ? <p className="error">{error}</p> : null}
        </FormActions>
      </form>
      )}
    </section>
  );
}

export function ExpensePage() {
  const { id } = useParams();
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
      <p><Link to="/app/compras">Compras</Link></p>
      <h1>{data.folio}</h1>
      <p>
        {EXPENSE_KIND[data.kind] ?? data.kind} · {data.description} · aplica el {showDay(data.occurredOn)} · <ExpensePaymentBadge status={data.paymentStatus} />
      </p>
      <div className="costing-kpis">
        <div><span>Importe</span><strong>{money(data.amount)}</strong></div>
        <div><span>Pagado</span><strong>{money(data.paid)}</strong></div>
        <div><span>Saldo</span><strong className={data.balance && Number(data.balance) > 0 ? "profit-negative" : undefined}>{money(data.balance)}</strong></div>
      </div>
      <h2 style={{ margin: 0 }}>Abonos</h2>
      {!(data.payments ?? []).length ? <p style={{ margin: 0 }}>Todavía no hay abonos.</p> : (
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
      {open ? (
        <form
          id="abono"
          className="card form-vertical"
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
            });
          }}
        >
          <h2 style={{ margin: 0 }}>Abonar</h2>
          <label>Fecha de pago<input name="paidOn" type="date" required defaultValue={today} /></label>
          <label>Cantidad<input key={data.balance ?? ""} name="amount" required inputMode="decimal" defaultValue={data.balance ?? ""} /></label>
          <p className="costing-hint">Por defecto se liquida el saldo. Cambia la cantidad para un abono parcial.</p>
          <label>Nota<input name="note" /></label>
          <FormActions>
            <SaveButton label="Registrar abono" pending={pendingKey !== null} />
            {error ? <p className="error">{error}</p> : null}
          </FormActions>
        </form>
      ) : <p className="muted-note">Este gasto ya está pagado.</p>}
    </section>
  );
}

export function PurchaseOrderPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const { error, pendingKey, run } = useError();
  const [result, setResult] = useState<string | null>(null);
  const order = useQuery({ queryKey: ["purchase-order", id], queryFn: () => api<PurchaseOrderDetail>(`/purchase-orders/${id}`) });
  if (order.isPending) return <DetailSkeleton />;
  if (!order.data) return <p className="error">No se pudo cargar la compra.</p>;
  const data = order.data;
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["purchase-order", id] });
    await client.invalidateQueries({ queryKey: ["purchase-orders"] });
    await client.invalidateQueries({ queryKey: ["inventory"] });
  };
  const move = (to: string, reason?: string) =>
    run(async () => {
      await postJson(`/purchase-orders/${id}/transition`, { to, reason });
      await refresh();
    }, to);
  const receivable = data.status === "ordered" || data.status === "partially_received";
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/compras">Compras</Link></p>
      <h1>{data.folio} · {data.vendorName}</h1>
      <p>{PO_STATUS[data.status] ?? data.status}</p>
      <div className="costing-kpis">
        <div><span>Subtotal</span><strong>{money(data.subtotal)}</strong></div>
        <div><span>IVA</span><strong>{money(data.vat)}</strong></div>
        <div><span>Total</span><strong>{money(data.total)}</strong></div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {data.status === "draft" ? <button className="primary" type="button" disabled={pendingKey !== null} aria-busy={pendingKey === "ordered"} onClick={() => void move("ordered")}>Colocar con el proveedor</button> : null}
        {data.status === "partially_received" || data.status === "received" ? <Action label="Cerrar" pending={pendingKey === "closed"} disabled={pendingKey !== null} onClick={() => void move("closed")} /> : null}
        {data.status === "draft" || data.status === "ordered" ? (
          <Action
            label="Cancelar"
            pending={pendingKey === "cancelled"}
            disabled={pendingKey !== null}
            onClick={() => {
              const reason = window.prompt("¿Por qué se cancela?");
              if (reason) void move("cancelled", reason);
            }}
          />
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {result ? <p className="banner">{result}</p> : null}
      <Paged rows={data.lines}>
      {(lines) => (
      <table>
        <thead><tr><th>Producto</th><th>Pedido</th><th>Recibido</th><th>Pendiente</th><th>Costo</th><th>Importe</th></tr></thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td>{line.quantity} {line.purchaseUom}</td>
              <td>{line.receivedQty}</td>
              <td>{line.pendingQty}</td>
              <td>{money(line.unitCost)}</td>
              <td>{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      </Paged>
      {receivable ? (
        <form
          className="card form-vertical"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = new FormData(form);
            void run(async () => {
              const response = await postJson<{ receipt: { folio: string } }>(
                `/purchase-orders/${id}/receive`,
                {
                  lines: [
                    {
                      lineId: values.get("lineId"),
                      quantity: values.get("quantity"),
                      lotNumber: String(values.get("lotNumber") || "") || undefined,
                      vendorLot: String(values.get("vendorLot") || "") || undefined,
                    },
                  ],
                },
                idempotencyHeader(),
              );
              setResult(`Recepción ${response.receipt.folio}`);
              form.reset();
              await refresh();
            }, "receive");
          }}
        >
          <h2 style={{ margin: 0 }}>Recibir</h2>
          <label>
            Línea
            <select name="lineId" required>
              {data.lines.filter((line) => line.pendingQty !== "0").map((line) => <option key={line.id} value={line.id}>{line.sku} · faltan {line.pendingQty} {line.purchaseUom}</option>)}
            </select>
          </label>
          <label>Cantidad (unidad de compra)<input name="quantity" required placeholder="1" /></label>
          <label>Lote interno<input name="lotNumber" placeholder="Automático" /></label>
          <label>Lote del proveedor<input name="vendorLot" /></label>
          <p className="costing-hint">El filamento entra al inventario en gramos. El costo del catálogo se actualiza con promedio ponderado.</p>
          <FormActions>
            <SaveButton label="Registrar recepción" pending={pendingKey === "receive"} />
          </FormActions>
        </form>
      ) : null}
      {data.receipts.length ? (
        <>
          <h2>Recepciones</h2>
          <ul>{data.receipts.map((receipt) => <li key={receipt.id}>{receipt.folio} · {new Date(receipt.createdAt).toLocaleString("es-MX")}</li>)}</ul>
        </>
      ) : null}
    </section>
  );
}

export function PrefacturasPage() {
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
            await postJson("/prefacturas", { salesOrderId: data.get("salesOrderId") }, idempotencyHeader());
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
        <button className="primary" type="submit" disabled={pendingKey !== null} aria-busy={pendingKey === "issue"}>Emitir prefactura</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <div className="card" style={grid}>
        <strong style={{ gridColumn: "1 / -1" }}>Paquete para el contador</strong>
        <label>Desde<input type="date" value={period.from} onChange={(event) => setPeriod({ ...period, from: event.target.value })} /></label>
        <label>Hasta<input type="date" value={period.to} onChange={(event) => setPeriod({ ...period, to: event.target.value })} /></label>
        <button className="primary" type="button" disabled={pendingKey !== null} aria-busy={pendingKey === "zip"} onClick={() => void run(() => download(`/exports/accountant?from=${period.from}&to=${period.to}&format=zip`, `paquete_contador_${period.from}_${period.to}.zip`), "zip")}>
          Descargar ZIP
        </button>
        <button className="ghost" type="button" disabled={pendingKey !== null} aria-busy={pendingKey === "csv"} onClick={() => void run(() => download(`/exports/accountant?from=${period.from}&to=${period.to}&format=csv`, `prefacturas_${period.from}_${period.to}.csv`), "csv")}>
          Solo CSV
        </button>
      </div>
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
  const { id } = useParams();
  const client = useQueryClient();
  const { error, pendingKey, run } = useError();
  const document = useQuery({ queryKey: ["prefactura", id], queryFn: () => api<PrefacturaDetail>(`/prefacturas/${id}`) });
  if (document.isPending) return <DetailSkeleton />;
  if (!document.data) return <p className="error">No se pudo cargar la prefactura.</p>;
  const data = document.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div className="no-print" style={{ display: "flex", gap: 8 }}>
        <Link to="/app/prefacturas">← Prefacturas</Link>
        <button className="primary" type="button" onClick={() => window.print()}>Imprimir</button>
        {data.status === "issued" ? (
          <Action
            label="Cancelar prefactura"
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
      {error ? <p className="error">{error}</p> : null}
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
    </section>
  );
}

interface Expense {
  id: string;
  folio: string;
  kind: string;
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

interface PurchaseOrder {
  id: string;
  folio: string;
  vendorName: string;
  status: string;
  expectedDate: string | null;
  subtotal: string;
  vat: string;
  total: string;
}

interface PurchaseOrderDetail extends PurchaseOrder {
  lines: Array<{ id: string; sku: string; description: string; purchaseUom: string; quantity: string; receivedQty: string; pendingQty: string; unitCost: string; lineTotal: string }>;
  receipts: Array<{ id: string; folio: string; createdAt: string }>;
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
