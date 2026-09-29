import { Money, MX_STATES } from "@3dprintmty/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api, download } from "./api";

export function money(value: string | null | undefined) {
  if (!value) return "—";
  return Money.fromMajor(value).format("es-MX");
}

export function useError() {
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    async run(action: () => Promise<void>) {
      setError(null);
      try {
        await action();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "No se pudo guardar.");
      }
    },
  };
}

export function CustomersPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const query = useQuery({
    queryKey: ["customers"],
    queryFn: () => api<{ data: Customer[] }>("/customers"),
  });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Clientes</h1>
      <form
        className="card"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void run(async () => {
            await api("/customers", {
              method: "POST",
              body: JSON.stringify({
                kind: data.get("kind"),
                legalName: data.get("legalName"),
                rfc: String(data.get("rfc") || "") || undefined,
                phone: String(data.get("phone") || "") || undefined,
                paymentTerms: data.get("paymentTerms"),
                creditLimit: String(data.get("creditLimit") || "0"),
                fiscal: {
                  line1: data.get("line1"),
                  neighborhood: data.get("neighborhood"),
                  postalCode: data.get("postalCode"),
                  state: data.get("state"),
                },
              }),
            });
            form.reset();
            await client.invalidateQueries({ queryKey: ["customers"] });
          });
        }}
      >
        <label>Tipo<select name="kind" defaultValue="b2b"><option value="b2b">Empresa</option><option value="b2c">Persona</option></select></label>
        <label>Nombre o razón social<input name="legalName" required /></label>
        <label>RFC<input name="rfc" placeholder="XAXX010101000" /></label>
        <label>Teléfono<input name="phone" placeholder="8112345678" /></label>
        <label>
          Términos
          <select name="paymentTerms" defaultValue="pue">
            <option value="pue">Contado (PUE)</option>
            <option value="net_15">Crédito 15 días</option>
            <option value="net_30">Crédito 30 días</option>
          </select>
        </label>
        <label>Límite de crédito<input name="creditLimit" placeholder="0.00" /></label>
        <label>Calle<input name="line1" required /></label>
        <label>Colonia<input name="neighborhood" required /></label>
        <label>C.P.<input name="postalCode" required pattern="\d{5}" /></label>
        <label>Estado<select name="state">{MX_STATES.map((state) => <option key={state}>{state}</option>)}</select></label>
        <button className="primary" type="submit">Guardar cliente</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <table>
        <thead><tr><th>Nombre</th><th>RFC</th><th>Términos</th><th>Límite</th><th>Estado</th></tr></thead>
        <tbody>
          {(query.data?.data ?? []).map((customer) => (
            <tr key={customer.id}>
              <td>{customer.legalName}</td>
              <td>{customer.rfc ?? "—"}</td>
              <td>{customer.paymentTerms}</td>
              <td>{money(customer.creditLimit)}</td>
              <td>{customer.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ServicesPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const services = useQuery({ queryKey: ["services"], queryFn: () => api<{ data: ServiceOffering[] }>("/services") });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Servicios</h1>
      <p>Diseño, impresión, acabado o entrega. El precio y los términos se copian a la cotización.</p>
      <form
        className="card"
        style={{ display: "grid", gap: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void run(async () => {
            await api("/services", {
              method: "POST",
              body: JSON.stringify({
                code: data.get("code"),
                name: data.get("name"),
                unit: data.get("unit"),
                salePrice: data.get("salePrice"),
                terms: String(data.get("terms") || ""),
              }),
            });
            form.reset();
            await client.invalidateQueries({ queryKey: ["services"] });
          });
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <label>Clave<input name="code" required placeholder="DIS-01" /></label>
          <label>Nombre<input name="name" required placeholder="Diseño de pieza" /></label>
          <label>
            Unidad
            <select name="unit" defaultValue="servicio">
              <option value="servicio">Servicio</option>
              <option value="hora">Hora</option>
              <option value="pieza">Pieza</option>
            </select>
          </label>
          <label>Precio<input name="salePrice" required placeholder="800.00" /></label>
        </div>
        <label>Términos<textarea name="terms" rows={3} placeholder="Incluye dos revisiones. El archivo final se entrega en STL." /></label>
        <button className="primary" type="submit">Agregar servicio</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <table>
        <thead><tr><th>Clave</th><th>Nombre</th><th>Unidad</th><th>Precio</th><th>Términos</th><th>Estado</th></tr></thead>
        <tbody>
          {(services.data?.data ?? []).map((service) => (
            <tr key={service.id}>
              <td>{service.code}</td>
              <td>{service.name}</td>
              <td>{service.unit}</td>
              <td>{money(service.salePrice)}</td>
              <td>{service.terms || "—"}</td>
              <td>{service.status === "active" ? "Activo" : "Inactivo"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function QuotesPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: () => api<{ data: Quote[] }>("/quotes") });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Cotizaciones</h1>
        <Link className="primary" to="/app/cotizaciones/nueva">Nueva cotización</Link>
      </div>
      <p>Una cotización es de impresiones o de productos. Cada impresión lleva sus servicios y sus filamentos, en gramos. Vigencia de 30 días. Aceptada, se convierte en pedido.</p>
      <table>
        <thead><tr><th>Folio</th><th>Cliente</th><th>Estado</th><th>Total</th><th></th></tr></thead>
        <tbody>
          {(quotes.data?.data ?? []).map((quote) => (
            <tr key={quote.id}>
              <td>{quote.folio}</td>
              <td>{quote.customerName}</td>
              <td>{QUOTE_STATUS[quote.status] ?? quote.status}</td>
              <td>{money(quote.total)}</td>
              <td style={{ display: "flex", gap: 8 }}>
                <Link to={`/app/cotizaciones/${quote.id}`}>Ver</Link>
                {quote.status === "draft" ? <Action label="Enviar" onClick={() => run(() => transitionQuote(client, quote.id, "sent"))} /> : null}
                {quote.status === "sent" ? <Action label="Aceptar" onClick={() => run(() => transitionQuote(client, quote.id, "accepted"))} /> : null}
                {quote.status === "accepted" ? <Action label="A pedido" onClick={() => run(() => convertQuote(client, quote.id))} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function OrdersPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const [openId, setOpenId] = useState<string | null>(null);
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<{ data: Order[] }>("/orders") });
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<{ data: Customer[] }>("/customers") });
  const products = useQuery({
    queryKey: ["products", "goods"],
    queryFn: () => api<{ data: CatalogItem[] }>("/products?limit=100"),
  });
  const services = useQuery({ queryKey: ["services"], queryFn: () => api<{ data: ServiceOffering[] }>("/services") });
  const detail = useQuery({
    queryKey: ["order", openId],
    queryFn: () => api<OrderDetail>(`/orders/${openId}`),
    enabled: Boolean(openId),
  });
  const filaments = (products.data?.data ?? []).filter((product) => product.productType === "raw_material");
  const goods = (products.data?.data ?? []).filter((product) => product.productType === "component" || product.productType === "finished_good");
  const offerings = (services.data?.data ?? []).filter((service) => service.status === "active");
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Pedidos</h1>
      <p>El pedido nace de una cotización o se captura directo. Primero se satisface el trabajo, y el cobro y la entrega avanzan por separado.</p>
      <DocumentForm
        customers={customers.data?.data ?? []}
        products={goods}
        filaments={filaments}
        services={offerings}
        error={error}
        submitLabel="Capturar pedido"
        shipping
        onSubmit={(body) =>
          run(async () => {
            await api("/orders", { method: "POST", body: JSON.stringify(body) });
            await client.invalidateQueries({ queryKey: ["orders"] });
            await client.invalidateQueries({ queryKey: ["dashboard"] });
          })
        }
      />
      <table>
        <thead><tr><th>Folio</th><th>Cliente</th><th>Estado</th><th>Pago</th><th>Saldo</th><th></th></tr></thead>
        <tbody>
          {(orders.data?.data ?? []).map((order) => (
            <tr key={order.id}>
              <td>{order.folio}</td>
              <td>{order.customerName}</td>
              <td>{order.status}</td>
              <td>{order.paymentStatus}</td>
              <td>{money(order.amountDue)}</td>
              <td style={{ display: "flex", gap: 8 }}>
                <Action label={openId === order.id ? "Cerrar" : "Ver"} onClick={() => setOpenId(openId === order.id ? null : order.id)} />
                {nextOrderAction(order.status) ? <Action label={nextOrderAction(order.status)!.label} onClick={() => run(() => transitionOrder(client, order.id, nextOrderAction(order.status)!.to))} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {openId && detail.data ? <OrderPanel order={detail.data} error={error} run={run} onChange={() => client.invalidateQueries({ queryKey: ["order", openId] })} /> : null}
    </section>
  );
}

const RESOLUTION_LABEL: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En proceso",
  delivered: "Prestado",
  accepted: "Aceptado",
  rework: "Retrabajo",
  waived: "Condonado",
};

const RESOLUTION_NEXT: Record<string, Array<{ to: string; label: string }>> = {
  pending: [{ to: "in_progress", label: "Empezar" }, { to: "waived", label: "Condonar" }],
  in_progress: [{ to: "delivered", label: "Prestado" }, { to: "rework", label: "Retrabajo" }, { to: "waived", label: "Condonar" }],
  rework: [{ to: "in_progress", label: "Reanudar" }, { to: "waived", label: "Condonar" }],
  delivered: [{ to: "accepted", label: "Cliente acepta" }, { to: "rework", label: "Retrabajo" }],
};

function OrderPanel({
  order,
  error,
  run,
  onChange,
}: {
  order: OrderDetail;
  error: string | null;
  run: (action: () => Promise<void>) => Promise<void>;
  onChange: () => Promise<void>;
}) {
  const client = useQueryClient();
  const satisfied = ["ready_to_ship", "shipped", "delivered", "completed"].includes(order.status);
  const delivered = ["delivered", "completed"].includes(order.status);
  const stages = [
    { label: "Creado", done: true },
    { label: "Satisfecho", done: satisfied },
    { label: "Cobrado", done: order.paymentStatus === "paid" },
    { label: "Entregado", done: delivered },
  ];
  return (
    <article className="card" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>{order.folio}</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {stages.map((stage) => (
          <span key={stage.label} style={{ padding: "4px 10px", borderRadius: 999, background: stage.done ? "var(--color-accent, #1f6b4a)" : "transparent", color: stage.done ? "#fff" : "inherit", border: "1px solid var(--color-line, #ccc)" }}>
            {stage.label}
          </span>
        ))}
      </div>
      {order.serviceTerms ? <p>Términos: {order.serviceTerms}</p> : null}
      <table>
        <thead><tr><th>Partida</th><th>Tipo</th><th>Cantidad</th><th>Resolución</th><th></th></tr></thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.description}
                {line.terms ? <div style={{ color: "var(--color-muted)" }}>{line.terms}</div> : null}
              </td>
              <td>{line.lineKind === "service" ? "Servicio" : line.lineKind === "filament" ? "Filamento" : "Producto"}</td>
              <td>{line.quantity}</td>
              <td>{line.lineKind === "service" ? (RESOLUTION_LABEL[line.resolution] ?? line.resolution) : "—"}</td>
              <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {line.lineKind === "service"
                  ? (RESOLUTION_NEXT[line.resolution] ?? []).map((step) => (
                    <Action
                      key={step.to}
                      label={step.label}
                      onClick={() => run(async () => {
                        await api(`/orders/${order.id}/lines/${line.id}/resolution`, {
                          method: "POST",
                          body: JSON.stringify({ resolution: step.to }),
                        });
                        await onChange();
                        await client.invalidateQueries({ queryKey: ["orders"] });
                      })}
                    />
                  ))
                  : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? <p className="error">{error}</p> : null}
    </article>
  );
}

export function CollectionsPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<{ data: Order[] }>("/orders") });
  const payments = useQuery({ queryKey: ["payments"], queryFn: () => api<{ data: Payment[] }>("/payments") });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Cobranza</h1>
      <p>Efectivo, SPEI, tarjeta o contra entrega. El saldo sale del libro de pagos, no de una casilla.</p>
      <form
        className="card"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void run(async () => {
            await api("/payments", {
              method: "POST",
              body: JSON.stringify({
                orderId: data.get("orderId"),
                method: data.get("method"),
                amount: data.get("amount"),
                reference: String(data.get("reference") || "") || undefined,
                note: String(data.get("note") || "") || undefined,
              }),
            });
            form.reset();
            await client.invalidateQueries({ queryKey: ["payments"] });
            await client.invalidateQueries({ queryKey: ["orders"] });
            await client.invalidateQueries({ queryKey: ["dashboard"] });
          });
        }}
      >
        <label>
          Pedido
          <select name="orderId" required>
            {(orders.data?.data ?? []).filter((order) => order.status !== "draft" && order.status !== "cancelled").map((order) => (
              <option key={order.id} value={order.id}>{order.folio} · saldo {money(order.amountDue)}</option>
            ))}
          </select>
        </label>
        <label>
          Método
          <select name="method" defaultValue="efectivo">
            <option value="efectivo">Efectivo</option>
            <option value="spei">SPEI</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="cod">Contra entrega</option>
          </select>
        </label>
        <label>Importe<input name="amount" required placeholder="100.00" /></label>
        <label>Referencia<input name="reference" placeholder="Folio bancario" /></label>
        <label>Nota<input name="note" /></label>
        <button className="primary" type="submit">Registrar cobro</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <table>
        <thead><tr><th>Pedido</th><th>Método</th><th>Estado</th><th>Importe</th><th>Referencia</th></tr></thead>
        <tbody>
          {(payments.data?.data ?? []).map((payment) => (
            <tr key={payment.id}>
              <td>{payment.folio}</td>
              <td>{payment.method}</td>
              <td>{payment.status}</td>
              <td>{money(payment.amount)}</td>
              <td>{payment.reference ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function QuoteNewPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { error, run } = useError();
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<{ data: Customer[] }>("/customers") });
  const products = useQuery({
    queryKey: ["products", "goods"],
    queryFn: () => api<{ data: CatalogItem[] }>("/products?limit=100"),
  });
  const services = useQuery({ queryKey: ["services"], queryFn: () => api<{ data: ServiceOffering[] }>("/services") });
  const filaments = (products.data?.data ?? []).filter((product) => product.productType === "raw_material");
  const goods = (products.data?.data ?? []).filter((product) => product.productType === "component" || product.productType === "finished_good");
  const offerings = (services.data?.data ?? []).filter((service) => service.status === "active");
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/cotizaciones">Cotizaciones</Link></p>
      <h1>Nueva cotización</h1>
      <QuoteBuilder
        customers={customers.data?.data ?? []}
        products={goods}
        filaments={filaments}
        services={offerings}
        error={error}
        onSubmit={(body) =>
          run(async () => {
            const created = await api<{ id: string }>("/quotes", { method: "POST", body: JSON.stringify(body) });
            await client.invalidateQueries({ queryKey: ["quotes"] });
            navigate(`/app/cotizaciones/${created.id}`);
          })
        }
      />
    </section>
  );
}

export function QuoteDetailPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const { error, run } = useError();
  const quote = useQuery({
    queryKey: ["quote", id],
    queryFn: () => api<QuoteDetail>(`/quotes/${id}`),
    enabled: Boolean(id),
  });
  const data = quote.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/cotizaciones">Cotizaciones</Link></p>
      {!data ? <p>Cargando…</p> : (
        <>
          <article className="card" style={{ display: "grid", gap: 12 }}>
            <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16 }}>
              <div>
                <h1 style={{ margin: 0 }}>{data.folio}</h1>
                <p style={{ margin: 0 }}>
                  {new Date(data.createdAt).toLocaleDateString("es-MX")} · Vigente hasta {new Date(data.validUntil).toLocaleDateString("es-MX")} · {QUOTE_STATUS[data.status] ?? data.status}
                </p>
                <p style={{ margin: 0 }}>{data.mode === "prints" ? "Impresiones" : "Productos"} · {data.currency} · {paymentTermsLabel(data.paymentTerms)} · {vatRateLabel(data.vatRate)}</p>
              </div>
              {data.issuer ? (
                <div style={{ textAlign: "right" }}>
                  <strong>{data.issuer.tradeName || data.issuer.legalName}</strong>
                  <p style={{ margin: 0 }}>RFC {data.issuer.rfc} · Régimen {data.issuer.taxRegime} · C.P. {data.issuer.postalCode}</p>
                </div>
              ) : null}
            </header>
            <div>
              <strong>Cliente</strong>
              <p style={{ margin: 0 }}>{data.customerName}{data.customerRfc ? ` · RFC ${data.customerRfc}` : ""}</p>
            </div>
            {data.mode === "prints" ? <PrintBreakdown prints={data.prints} /> : <QuoteLinesTable lines={data.lines} />}
            <div style={{ justifySelf: "end", textAlign: "right" }}>
              <p style={{ margin: 0 }}>Subtotal {money(data.subtotal)}</p>
              <p style={{ margin: 0 }}>Descuento {money(data.discount)}</p>
              <p style={{ margin: 0 }}>IVA {money(data.vat)}</p>
              <p style={{ margin: 0, fontSize: 20 }}><strong>Total {money(data.total)} {data.currency}</strong></p>
            </div>
            {data.serviceTerms ? <p style={{ margin: 0 }}>Términos: {data.serviceTerms}</p> : null}
            <p style={{ margin: 0, fontWeight: 600 }}>Documento comercial. No es un CFDI.</p>
          </article>
          <div style={{ display: "flex", gap: 8 }}>
            <Action label="PDF" onClick={() => run(() => download(`/quotes/${data.id}/pdf`, `${data.folio}.pdf`))} />
            {data.status === "draft" ? <Action label="Enviar" onClick={() => run(() => transitionQuote(client, data.id, "sent"))} /> : null}
            {data.status === "sent" ? <Action label="Aceptar" onClick={() => run(() => transitionQuote(client, data.id, "accepted"))} /> : null}
            {data.status === "accepted" ? <Action label="A pedido" onClick={() => run(() => convertQuote(client, data.id))} /> : null}
          </div>
          {error ? <p className="error">{error}</p> : null}
        </>
      )}
    </section>
  );
}

const QUOTE_STATUS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviada",
  accepted: "Aceptada",
  converted: "Convertida",
  expired: "Vencida",
  void: "Cancelada",
};

function paymentTermsLabel(value: string) {
  if (value === "net_15") return "Crédito 15 días";
  if (value === "net_30") return "Crédito 30 días";
  return "Contado (PUE)";
}

function vatRateLabel(rate: string) {
  const pct = Math.round(Number(rate) * 100);
  return Number.isFinite(pct) ? `IVA ${pct}%` : "IVA";
}

function PrintBreakdown({ prints }: { prints: QuoteDetail["prints"] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="scroll-x">
    <table>
      <thead>
        <tr>
          <th></th>
          <th>Impresión</th>
          <th>Piezas</th>
          <th>Partidas</th>
          <th>Importe por pieza</th>
          <th>Subtotal</th>
          <th>IVA</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {prints.map((print) => {
          const open = openId === print.id;
          return (
            <Fragment key={print.id}>
              <tr>
                <td>
                  <button className="ghost" type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : print.id)}>
                    {open ? "Cerrar" : "Abrir"}
                  </button>
                </td>
                <td>{print.name}</td>
                <td>{print.quantity}</td>
                <td>{print.lines.length}</td>
                <td>{money(print.unitTotal)}</td>
                <td>{money(print.subtotal)}</td>
                <td>{money(print.vat)}</td>
                <td>{money(print.total)}</td>
              </tr>
              {open ? (
                <tr>
                  <td colSpan={8}>
                    <QuoteLinesTable lines={print.lines} />
                    <p style={{ margin: "8px 0 0", textAlign: "right" }}>Descuento {money(print.discount)}</p>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function QuoteLinesTable({ lines }: { lines: QuoteLine[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Descripción</th>
          <th>Cantidad</th>
          <th>UM</th>
          <th>Precio unitario</th>
          <th>Descuento</th>
          <th>Importe</th>
          <th>IVA</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id}>
            <td>{line.description}{line.terms ? <div>{line.terms}</div> : null}</td>
            <td>{line.quantity}</td>
            <td>{line.uom}</td>
            <td>{money(line.unitPrice)}</td>
            <td>{money(line.discount)}</td>
            <td>{money(line.net)}</td>
            <td>{money(line.vat)}</td>
            <td>{money(line.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function blankPrint(filaments: CatalogItem[], services: CatalogItem[]): PrintDraft {
  return {
    key: crypto.randomUUID(),
    name: "",
    quantity: "1",
    filaments: filaments[0] ? [freshPart(filaments)] : [],
    services: services[0] ? [freshPart(services)] : [],
  };
}

function freshPart(items: CatalogItem[]): PartDraft {
  const first = items[0];
  return { key: crypto.randomUUID(), catalogId: first?.id ?? "", quantity: "1", unitPrice: first?.salePrice ?? "", discount: "0", terms: first?.terms ?? "" };
}

function QuoteBuilder({
  customers,
  products,
  filaments,
  services,
  error,
  onSubmit,
}: {
  customers: Customer[];
  products: CatalogItem[];
  filaments: CatalogItem[];
  services: CatalogItem[];
  error: string | null;
  onSubmit: (body: unknown) => void;
}) {
  const [mode, setMode] = useState<"prints" | "products">("prints");
  const starter = useRef(blankPrint(filaments, services));
  const [prints, setPrints] = useState<PrintDraft[]>([starter.current]);
  const [openKey, setOpenKey] = useState<string | null>(starter.current.key);
  const [productLines, setProductLines] = useState<PartDraft[]>(products[0] ? [freshPart(products)] : []);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    if (!filaments[0] && !services[0] && !products[0]) return;
    seeded.current = true;
    const created = blankPrint(filaments, services);
    setPrints([created]);
    setOpenKey(created.key);
    if (products[0]) setProductLines([freshPart(products)]);
  }, [filaments, services, products]);

  function patchPart(list: PartDraft[], key: string, patch: Partial<PartDraft>, catalog: CatalogItem[]) {
    return list.map((line) => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      const item = catalog.find((entry) => entry.id === next.catalogId);
      if (patch.catalogId && item) {
        next.unitPrice = item.salePrice ?? next.unitPrice;
        next.terms = item.terms ?? "";
      }
      return next;
    });
  }

  return (
    <form
      className="card"
      style={{ display: "grid", gap: 12 }}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const serviceTerms = String(data.get("serviceTerms") || "") || undefined;
        const customerId = data.get("customerId");
        if (mode === "products") {
          onSubmit({
            mode,
            customerId,
            serviceTerms,
            lines: productLines.map((line) => ({
              productId: line.catalogId,
              description: products.find((item) => item.id === line.catalogId)?.name ?? "Producto",
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount || "0",
            })),
          });
          return;
        }
        onSubmit({
          mode,
          customerId,
          serviceTerms,
          prints: prints.map((print) => ({
            name: print.name || "Impresión",
            quantity: print.quantity,
            filaments: print.filaments.map((line) => ({
              productId: line.catalogId,
              description: filaments.find((item) => item.id === line.catalogId)?.name ?? "Filamento",
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount || "0",
            })),
            services: print.services.map((line) => ({
              serviceId: line.catalogId,
              description: services.find((item) => item.id === line.catalogId)?.name ?? "Servicio",
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount || "0",
              terms: line.terms || undefined,
            })),
          })),
        });
      }}
    >
      <label>
        Cliente
        <select name="customerId" required>
          {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.legalName}</option>)}
        </select>
      </label>
      <label>
        Tipo
        <select value={mode} onChange={(event) => setMode(event.target.value as "prints" | "products")}>
          <option value="prints">Impresiones</option>
          <option value="products">Productos</option>
        </select>
      </label>
      {mode === "prints" ? (
        <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Impresión</th>
              <th>Piezas</th>
              <th>Filamentos</th>
              <th>Servicios</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {prints.map((print) => {
              const open = openKey === print.key;
              return (
                <Fragment key={print.key}>
                  <tr>
                    <td>
                      <button className="ghost" type="button" aria-expanded={open} onClick={() => setOpenKey(open ? null : print.key)}>
                        {open ? "Cerrar" : "Abrir"}
                      </button>
                    </td>
                    <td>{print.name || "Sin nombre"}</td>
                    <td>{print.quantity}</td>
                    <td>{print.filaments.length}</td>
                    <td>{print.services.length}</td>
                    <td>
                      <button className="ghost" type="button" onClick={() => setPrints((current) => current.filter((item) => item.key !== print.key))}>Quitar</button>
                    </td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={6}>
                        <div style={{ display: "grid", gap: 10 }}>
                          <label>Nombre<input value={print.name} onChange={(event) => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, name: event.target.value } : item))} required placeholder="Llavero" /></label>
                          <label>Piezas<input value={print.quantity} onChange={(event) => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, quantity: event.target.value } : item))} required /></label>
                          <p style={{ margin: 0 }}>Los gramos y los servicios son por pieza. El importe se multiplica por esta cantidad.</p>
                          <strong>Filamentos</strong>
                          {print.filaments.length === 0 ? <p style={{ margin: 0 }}>Esta impresión no lleva filamento.</p> : null}
                          {print.filaments.map((line) => (
                            <div key={line.key} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, alignItems: "end" }}>
                              <label>Filamento
                                <select value={line.catalogId} onChange={(event) => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, filaments: patchPart(item.filaments, line.key, { catalogId: event.target.value }, filaments) } : item))}>
                                  {filaments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                                </select>
                              </label>
                              <label>Gramos por pieza<input value={line.quantity} onChange={(event) => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, filaments: patchPart(item.filaments, line.key, { quantity: event.target.value }, filaments) } : item))} required /></label>
                              <label>Precio por gramo<input value={line.unitPrice} onChange={(event) => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, filaments: patchPart(item.filaments, line.key, { unitPrice: event.target.value }, filaments) } : item))} required /></label>
                              <button className="ghost" type="button" onClick={() => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, filaments: item.filaments.filter((part) => part.key !== line.key) } : item))}>Quitar</button>
                            </div>
                          ))}
                          <strong>Servicios</strong>
                          {print.services.length === 0 ? <p style={{ margin: 0 }}>Esta impresión no lleva servicios.</p> : null}
                          {print.services.map((line) => (
                            <div key={line.key} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, alignItems: "end" }}>
                              <label>Servicio
                                <select value={line.catalogId} onChange={(event) => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, services: patchPart(item.services, line.key, { catalogId: event.target.value }, services) } : item))}>
                                  {services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                                </select>
                              </label>
                              <label>Cantidad por pieza<input value={line.quantity} onChange={(event) => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, services: patchPart(item.services, line.key, { quantity: event.target.value }, services) } : item))} required /></label>
                              <label>Precio<input value={line.unitPrice} onChange={(event) => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, services: patchPart(item.services, line.key, { unitPrice: event.target.value }, services) } : item))} required /></label>
                              <label>UM<input value={services.find((item) => item.id === line.catalogId)?.unit ?? ""} readOnly /></label>
                              <label>Términos<input value={line.terms} onChange={(event) => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, services: patchPart(item.services, line.key, { terms: event.target.value }, services) } : item))} /></label>
                              <button className="ghost" type="button" onClick={() => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, services: item.services.filter((part) => part.key !== line.key) } : item))}>Quitar</button>
                            </div>
                          ))}
                          <div style={{ display: "flex", gap: 8 }}>
                            <button className="ghost" type="button" disabled={!filaments.length} onClick={() => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, filaments: [...item.filaments, freshPart(filaments)] } : item))}>Agregar filamento</button>
                            <button className="ghost" type="button" disabled={!services.length} onClick={() => setPrints((current) => current.map((item) => item.key === print.key ? { ...item, services: [...item.services, freshPart(services)] } : item))}>Agregar servicio</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      ) : productLines.map((line) => (
        <div key={line.key} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          <label>Producto
            <select value={line.catalogId} onChange={(event) => setProductLines((current) => patchPart(current, line.key, { catalogId: event.target.value }, products))}>
              {products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Cantidad<input value={line.quantity} onChange={(event) => setProductLines((current) => patchPart(current, line.key, { quantity: event.target.value }, products))} required /></label>
          <label>Precio<input value={line.unitPrice} onChange={(event) => setProductLines((current) => patchPart(current, line.key, { unitPrice: event.target.value }, products))} required /></label>
          <button className="ghost" type="button" onClick={() => setProductLines((current) => current.filter((item) => item.key !== line.key))}>Quitar</button>
        </div>
      ))}
      {mode === "prints" ? (
        <button className="ghost" type="button" onClick={() => {
          const created = blankPrint(filaments, services);
          created.services = [];
          setPrints((current) => [...current, created]);
          setOpenKey(created.key);
        }}>Agregar impresión</button>
      ) : (
        <button className="ghost" type="button" disabled={!products.length} onClick={() => setProductLines((current) => [...current, freshPart(products)])}>Agregar producto</button>
      )}
      <label>Términos del documento<textarea name="serviceTerms" rows={3} placeholder="Plazo, revisiones y qué queda fuera." /></label>
      <button className="primary" type="submit">Guardar cotización</button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function blankLine(kind: DraftLine["kind"], items: CatalogItem[]): DraftLine {
  const first = items[0];
  return {
    key: crypto.randomUUID(),
    kind,
    catalogId: first?.id ?? "",
    quantity: "1",
    unitPrice: first?.salePrice ?? "",
    discount: "0",
    terms: first?.terms ?? "",
  };
}

function DocumentForm({
  customers,
  products,
  filaments,
  services,
  error,
  submitLabel,
  shipping,
  onSubmit,
}: {
  customers: Customer[];
  products: CatalogItem[];
  filaments: CatalogItem[];
  services: CatalogItem[];
  error: string | null;
  submitLabel: string;
  shipping?: boolean;
  onSubmit: (body: unknown) => void;
}) {
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const seeded = useRef({ product: false, filament: false, service: false });
  useEffect(() => {
    setLines((current) => {
      const extra: DraftLine[] = [];
      if (!seeded.current.product && products[0]) {
        seeded.current.product = true;
        extra.push(blankLine("product", products));
      }
      if (!seeded.current.filament && filaments[0]) {
        seeded.current.filament = true;
        extra.push(blankLine("filament", filaments));
      }
      if (!seeded.current.service && services[0]) {
        seeded.current.service = true;
        extra.push(blankLine("service", services));
      }
      return extra.length ? [...current, ...extra] : current;
    });
  }, [products, filaments, services]);
  const catalog = (kind: DraftLine["kind"]) => (kind === "product" ? products : kind === "filament" ? filaments : services);

  function update(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      if (patch.catalogId || patch.kind) {
        const item = catalog(next.kind).find((entry) => entry.id === next.catalogId);
        if (item) {
          next.unitPrice = item.salePrice ?? next.unitPrice;
          next.terms = item.terms ?? "";
        }
      }
      return next;
    }));
  }

  return (
    <form
      className="card"
      style={{ display: "grid", gap: 12 }}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (!lines.length) {
          setLocalError("Agrega al menos un filamento, un producto o un servicio.");
          return;
        }
        setLocalError(null);
        onSubmit({
          customerId: data.get("customerId"),
          shipping: shipping ? String(data.get("shipping") || "0") : undefined,
          serviceTerms: String(data.get("serviceTerms") || "") || undefined,
          lines: lines.map((line) => {
            const item = catalog(line.kind).find((entry) => entry.id === line.catalogId);
            return {
              ...(line.kind === "service" ? { serviceId: line.catalogId } : { productId: line.catalogId }),
              description: item?.name ?? "Partida",
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount || "0",
              terms: line.kind === "service" ? line.terms : undefined,
            };
          }),
        });
      }}
    >
      <label>
        Cliente
        <select name="customerId" required>
          {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.legalName}</option>)}
        </select>
      </label>
      {lines.map((line, index) => (
        <div key={line.key} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <label>
            Tipo
            <select
              value={line.kind}
              onChange={(event) => {
                const kind = event.target.value as DraftLine["kind"];
                const items = kind === "product" ? products : kind === "filament" ? filaments : services;
                update(line.key, { kind, catalogId: items[0]?.id ?? "" });
              }}
            >
              <option value="filament">Filamento</option>
              <option value="product">Producto</option>
              <option value="service">Servicio</option>
            </select>
          </label>
          <label>
            {line.kind === "filament" ? "Filamento" : line.kind === "product" ? "Producto" : "Servicio"}
            <select value={line.catalogId} onChange={(event) => update(line.key, { catalogId: event.target.value })}>
              {catalog(line.kind).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>{line.kind === "filament" ? "Gramos" : "Cantidad"}<input value={line.quantity} onChange={(event) => update(line.key, { quantity: event.target.value })} required /></label>
          <label>{line.kind === "filament" ? "Precio por gramo" : "Precio"}<input value={line.unitPrice} onChange={(event) => update(line.key, { unitPrice: event.target.value })} required /></label>
          <label>Descuento<input value={line.discount} onChange={(event) => update(line.key, { discount: event.target.value })} /></label>
          {line.kind === "service" ? (
            <label>Términos de la partida<input value={line.terms} onChange={(event) => update(line.key, { terms: event.target.value })} /></label>
          ) : null}
          <button className="ghost" type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>
            Quitar {index + 1}
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ghost" type="button" disabled={!filaments.length} onClick={() => setLines((current) => [...current, blankLine("filament", filaments)])}>Agregar filamento</button>
        <button className="ghost" type="button" disabled={!products.length} onClick={() => setLines((current) => [...current, blankLine("product", products)])}>Agregar producto</button>
        <button className="ghost" type="button" disabled={!services.length} onClick={() => setLines((current) => [...current, blankLine("service", services)])}>Agregar servicio</button>
      </div>
      <label>Términos del documento<textarea name="serviceTerms" rows={3} placeholder="Plazo de entrega, revisiones incluidas y qué queda fuera." /></label>
      {shipping ? <label>Envío<input name="shipping" placeholder="0.00" /></label> : null}
      <button className="primary" type="submit">{submitLabel}</button>
      {localError || error ? <p className="error">{localError || error}</p> : null}
    </form>
  );
}

function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="ghost" type="button" onClick={onClick}>{label}</button>;
}

async function transitionQuote(client: ReturnType<typeof useQueryClient>, id: string, to: string) {
  await api(`/quotes/${id}/transition`, { method: "POST", body: JSON.stringify({ to }) });
  await client.invalidateQueries({ queryKey: ["quotes"] });
  await client.invalidateQueries({ queryKey: ["quote", id] });
}

async function convertQuote(client: ReturnType<typeof useQueryClient>, id: string) {
  await api(`/quotes/${id}/convert`, { method: "POST" });
  await client.invalidateQueries({ queryKey: ["quotes"] });
  await client.invalidateQueries({ queryKey: ["quote", id] });
  await client.invalidateQueries({ queryKey: ["orders"] });
}

async function transitionOrder(client: ReturnType<typeof useQueryClient>, id: string, to: string) {
  if (to === "pending") await api(`/orders/${id}/submit`, { method: "POST" });
  else if (to === "confirmed") await api(`/orders/${id}/confirm`, { method: "POST", body: "{}" });
  else if (to === "shipped") {
    await api(`/orders/${id}/ship`, {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ carrier: "Local" }),
    });
  } else if (to === "delivered") await api(`/orders/${id}/deliver`, { method: "POST" });
  else if (to === "completed") await api(`/orders/${id}/complete`, { method: "POST" });
  await client.invalidateQueries({ queryKey: ["orders"] });
  await client.invalidateQueries({ queryKey: ["dashboard"] });
}

function nextOrderAction(status: string): { label: string; to: string } | null {
  const steps: Record<string, { label: string; to: string }> = {
    draft: { label: "A pendiente", to: "pending" },
    pending: { label: "Confirmar", to: "confirmed" },
    ready_to_ship: { label: "Embarcar", to: "shipped" },
    shipped: { label: "Entregado", to: "delivered" },
    delivered: { label: "Completar", to: "completed" },
  };
  return steps[status] ?? null;
}

interface Customer {
  id: string;
  legalName: string;
  rfc: string | null;
  paymentTerms: string;
  creditLimit: string | null;
  status: string;
}

interface PartDraft {
  key: string;
  catalogId: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  terms: string;
}

interface PrintDraft {
  key: string;
  name: string;
  quantity: string;
  filaments: PartDraft[];
  services: PartDraft[];
}

interface QuoteDetail {
  id: string;
  folio: string;
  customerName: string;
  customerRfc: string | null;
  status: string;
  mode: "prints" | "products";
  serviceTerms: string | null;
  createdAt: string;
  validUntil: string;
  currency: string;
  paymentTerms: string;
  vatRate: string;
  subtotal: string | null;
  discount: string | null;
  vat: string | null;
  total: string | null;
  issuer: { legalName: string; tradeName: string | null; rfc: string; taxRegime: string; postalCode: string } | null;
  prints: Array<{
    id: string;
    name: string;
    quantity: string;
    unitTotal: string | null;
    subtotal: string | null;
    discount: string | null;
    vat: string | null;
    total: string | null;
    lines: QuoteLine[];
  }>;
  lines: QuoteLine[];
}

interface QuoteLine {
  id: string;
  description: string;
  quantity: string;
  uom: string;
  unitPrice: string | null;
  discount: string | null;
  net: string | null;
  vat: string | null;
  total: string | null;
  lineKind: string;
  terms: string | null;
}

interface CatalogItem {
  id: string;
  name: string;
  salePrice: string | null;
  productType?: string;
  terms?: string;
  unit?: string;
  status?: string;
}

interface DraftLine {
  key: string;
  kind: "product" | "filament" | "service";
  catalogId: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  terms: string;
}

interface ServiceOffering extends CatalogItem {
  code: string;
  unit: string;
  terms: string;
  status: string;
}

interface Quote {
  id: string;
  folio: string;
  customerName: string;
  status: string;
  total: string | null;
}

interface Order {
  id: string;
  folio: string;
  customerName: string;
  status: string;
  paymentStatus: string;
  amountDue: string | null;
}

interface OrderDetail extends Order {
  serviceTerms: string | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: string;
    lineKind: string;
    terms: string | null;
    resolution: string;
  }>;
}

interface Payment {
  id: string;
  folio: string;
  method: string;
  status: string;
  amount: string | null;
  reference: string | null;
}
