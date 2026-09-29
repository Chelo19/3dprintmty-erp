import { Money, MX_STATES } from "@3dprintmty/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api, download } from "./api";
import { CustomerSkeleton, DetailSkeleton, FormSkeleton, TableSkeleton } from "./skeleton";

export function money(value: string | null | undefined) {
  if (!value) return "—";
  return Money.fromMajor(value).format("es-MX");
}

export function ViewLink({ to }: { to: string }) {
  return (
    <Link className="icon-btn view" to={to} aria-label="Ver detalle" title="Ver detalle">
      <EyeIcon />
    </Link>
  );
}

export function EditLink({ to }: { to: string }) {
  return (
    <Link className="icon-btn edit" to={to} aria-label="Editar" title="Editar">
      <PencilIcon />
    </Link>
  );
}

export function RecordActions({ detailTo, editTo }: { detailTo: string; editTo: string }) {
  return (
    <div className="record-actions">
      <Link className="icon-btn view" to={detailTo} aria-label="Ver detalle" title="Ver detalle">
        <EyeIcon />
      </Link>
      <Link className="icon-btn edit" to={editTo} aria-label="Editar" title="Editar">
        <PencilIcon />
      </Link>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" />
    </svg>
  );
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
  const query = useQuery({
    queryKey: ["customers"],
    queryFn: () => api<{ data: Customer[] }>("/customers"),
  });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Clientes</h1>
        <Link className="primary" to="/app/clientes/nuevo">Nuevo cliente</Link>
      </div>
      {query.isPending ? <TableSkeleton columns={6} /> : (
      <table>
        <thead><tr><th>Nombre</th><th>RFC</th><th>Términos</th><th>Límite</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {(query.data?.data ?? []).map((customer) => (
            <tr key={customer.id}>
              <td>{customer.legalName}</td>
              <td>{customer.rfc ?? "—"}</td>
              <td>{paymentTermsLabel(customer.paymentTerms)}</td>
              <td>{money(customer.creditLimit)}</td>
              <td>{customer.status === "active" ? "Activo" : "Inactivo"}</td>
              <td><RecordActions detailTo={`/app/clientes/${customer.id}`} editTo={`/app/clientes/${customer.id}/editar`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}

export function CustomerNewPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { error, run } = useError();
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/clientes">Clientes</Link></p>
      <h1>Nuevo cliente</h1>
      <form
        className="card"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
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
            await client.invalidateQueries({ queryKey: ["customers"] });
            navigate("/app/clientes");
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
    </section>
  );
}

export function ServicesPage() {
  const services = useQuery({ queryKey: ["services"], queryFn: () => api<{ data: ServiceOffering[] }>("/services") });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Servicios</h1>
        <Link className="primary" to="/app/servicios/nuevo">Nuevo servicio</Link>
      </div>
      <p>Diseño, impresión, acabado o entrega. El precio, la unidad y los términos se copian a la cotización.</p>
      {services.isPending ? <TableSkeleton columns={7} /> : (
      <table>
        <thead><tr><th>Clave</th><th>Nombre</th><th>Unidad</th><th>Precio</th><th>Términos</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {(services.data?.data ?? []).map((service) => (
            <tr key={service.id}>
              <td>{service.code}</td>
              <td>{service.name}</td>
              <td>{service.unit}</td>
              <td>{money(service.salePrice)}</td>
              <td>{service.terms || "—"}</td>
              <td>{service.status === "active" ? "Activo" : "Inactivo"}</td>
              <td><RecordActions detailTo={`/app/servicios/${service.id}`} editTo={`/app/servicios/${service.id}/editar`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}

export function ServiceNewPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { error, run } = useError();
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/servicios">Servicios</Link></p>
      <h1>Nuevo servicio</h1>
      <form
        className="card"
        style={{ display: "grid", gap: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
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
            await client.invalidateQueries({ queryKey: ["services"] });
            navigate("/app/servicios");
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
        <button className="primary" type="submit">Guardar servicio</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </section>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const customer = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api<CustomerDetail>(`/customers/${id}`),
  });
  if (customer.isPending) return <CustomerSkeleton />;
  if (!customer.data) return <p className="error">No se pudo cargar el cliente.</p>;
  const data = customer.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/clientes">Clientes</Link></p>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>{data.legalName}</h1>
        <EditLink to={`/app/clientes/${data.id}/editar`} />
      </div>
      <div className="grid-cards">
        <article className="card">
          <p style={{ margin: 0, color: "var(--color-muted)" }}>Balance</p>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: 36, margin: "8px 0 0" }}>{money(data.balance)}</p>
          <p style={{ margin: "8px 0 0", color: "var(--color-muted)" }}>Saldo por cobrar en pedidos confirmados.</p>
        </article>
        <article className="card">
          <p style={{ margin: 0 }}>{data.kind === "b2b" ? "Empresa" : "Persona"} · {data.status === "active" ? "Activo" : "Inactivo"}</p>
          <p>RFC {data.rfc ?? "—"} · {data.phone ?? "Sin teléfono"}</p>
          <p>Términos {paymentTermsLabel(data.paymentTerms)} · límite {money(data.creditLimit)}</p>
          <p style={{ margin: 0 }}>
            {data.fiscal ? `${data.fiscal.line1}, ${data.fiscal.neighborhood}, ${data.fiscal.postalCode} ${data.fiscal.state}` : "Sin domicilio fiscal"}
          </p>
        </article>
      </div>
      <div className="activity-columns">
        <ActivityColumn title="Pagos" empty="Sin pagos.">
          {data.payments.map((payment) => (
            <ActivityRow
              key={payment.id}
              title={payment.folio || "Pago"}
              detail={money(payment.amount)}
              to={payment.orderId ? `/app/pedidos/${payment.orderId}` : "/app/cobranza"}
            />
          ))}
        </ActivityColumn>
        <ActivityColumn title="Pedidos" empty="Sin pedidos.">
          {data.orders.map((order) => (
            <ActivityRow
              key={order.id}
              title={order.folio}
              detail={ORDER_STATUS[order.status] ?? order.status}
              to={`/app/pedidos/${order.id}`}
            />
          ))}
        </ActivityColumn>
        <ActivityColumn title="Cotizaciones" empty="Sin cotizaciones.">
          {data.quotes.map((quote) => (
            <ActivityRow
              key={quote.id}
              title={quote.folio}
              detail={money(quote.total)}
              to={`/app/cotizaciones/${quote.id}`}
            />
          ))}
        </ActivityColumn>
      </div>
    </section>
  );
}

export function CustomerEditPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { error, run } = useError();
  const customer = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api<CustomerDetail>(`/customers/${id}`),
  });
  if (customer.isPending) return <FormSkeleton fields={8} />;
  if (!customer.data) return <p className="error">No se pudo cargar el cliente.</p>;
  const data = customer.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to={`/app/clientes/${id}`}>Cliente</Link></p>
      <h1>Editar cliente</h1>
      <form
        className="card"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void run(async () => {
            await api(`/customers/${id}`, {
              method: "PATCH",
              body: JSON.stringify({
                legalName: form.get("legalName"),
                rfc: String(form.get("rfc") || ""),
                phone: String(form.get("phone") || ""),
                paymentTerms: form.get("paymentTerms"),
                creditLimit: String(form.get("creditLimit") || "0"),
                status: form.get("status"),
                fiscal: {
                  line1: form.get("line1"),
                  neighborhood: form.get("neighborhood"),
                  postalCode: form.get("postalCode"),
                  state: form.get("state"),
                },
              }),
            });
            await client.invalidateQueries({ queryKey: ["customers"] });
            await client.invalidateQueries({ queryKey: ["customer", id] });
            navigate(`/app/clientes/${id}`);
          });
        }}
      >
        <label>Nombre o razón social<input name="legalName" required defaultValue={data.legalName} /></label>
        <label>RFC<input name="rfc" defaultValue={data.rfc ?? ""} /></label>
        <label>Teléfono<input name="phone" defaultValue={data.phone ?? ""} /></label>
        <label>
          Términos
          <select name="paymentTerms" defaultValue={data.paymentTerms}>
            <option value="pue">Contado (PUE)</option>
            <option value="net_15">Crédito 15 días</option>
            <option value="net_30">Crédito 30 días</option>
          </select>
        </label>
        <label>Límite de crédito<input name="creditLimit" defaultValue={data.creditLimit ?? "0.00"} /></label>
        <label>
          Estado
          <select name="status" defaultValue={data.status}>
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
          </select>
        </label>
        <label>Calle<input name="line1" required defaultValue={data.fiscal?.line1 ?? ""} /></label>
        <label>Colonia<input name="neighborhood" required defaultValue={data.fiscal?.neighborhood ?? ""} /></label>
        <label>C.P.<input name="postalCode" required pattern="\d{5}" defaultValue={data.fiscal?.postalCode ?? ""} /></label>
        <label>Estado<select name="state" defaultValue={data.fiscal?.state ?? MX_STATES[0]}>{MX_STATES.map((state) => <option key={state}>{state}</option>)}</select></label>
        <button className="primary" type="submit">Guardar cambios</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </section>
  );
}

export function ServiceDetailPage() {
  const { id } = useParams();
  const service = useQuery({
    queryKey: ["service", id],
    queryFn: () => api<ServiceOffering>(`/services/${id}`),
  });
  if (service.isPending) return <DetailSkeleton />;
  if (!service.data) return <p className="error">No se pudo cargar el servicio.</p>;
  const data = service.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/servicios">Servicios</Link></p>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>{data.name}</h1>
        <EditLink to={`/app/servicios/${data.id}/editar`} />
      </div>
      <article className="card">
        <p>Clave {data.code} · unidad {data.unit} · {data.status === "active" ? "Activo" : "Inactivo"}</p>
        <p>Precio {money(data.salePrice)}</p>
        <p style={{ margin: 0 }}>{data.terms || "Sin términos."}</p>
      </article>
    </section>
  );
}

export function ServiceEditPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { error, run } = useError();
  const service = useQuery({
    queryKey: ["service", id],
    queryFn: () => api<ServiceOffering>(`/services/${id}`),
  });
  if (service.isPending) return <FormSkeleton fields={5} />;
  if (!service.data) return <p className="error">No se pudo cargar el servicio.</p>;
  const data = service.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to={`/app/servicios/${id}`}>Servicio</Link></p>
      <h1>Editar servicio</h1>
      <form
        className="card"
        style={{ display: "grid", gap: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void run(async () => {
            await api(`/services/${id}`, {
              method: "PATCH",
              body: JSON.stringify({
                name: form.get("name"),
                unit: form.get("unit"),
                salePrice: form.get("salePrice"),
                terms: String(form.get("terms") || ""),
                status: form.get("status"),
              }),
            });
            await client.invalidateQueries({ queryKey: ["services"] });
            await client.invalidateQueries({ queryKey: ["service", id] });
            navigate(`/app/servicios/${id}`);
          });
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <label>Clave<input value={data.code} readOnly /></label>
          <label>Nombre<input name="name" required defaultValue={data.name} /></label>
          <label>
            Unidad
            <select name="unit" defaultValue={data.unit}>
              <option value="servicio">Servicio</option>
              <option value="hora">Hora</option>
              <option value="pieza">Pieza</option>
            </select>
          </label>
          <label>Precio<input name="salePrice" required defaultValue={data.salePrice ?? ""} /></label>
          <label>
            Estado
            <select name="status" defaultValue={data.status}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
        </div>
        <label>Términos<textarea name="terms" rows={3} defaultValue={data.terms} /></label>
        <button className="primary" type="submit">Guardar cambios</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </section>
  );
}

export function QuotesPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: () => api<{ data: Quote[] }>("/quotes") });
  async function act(id: string, action: () => Promise<void>) {
    if (pendingId) return;
    setPendingId(id);
    try {
      await run(action);
    } finally {
      setPendingId(null);
    }
  }
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Cotizaciones</h1>
        <Link className="primary" to="/app/cotizaciones/nueva">Nueva cotización</Link>
      </div>
      <p>Una cotización es de impresiones o de productos. Cada impresión lleva sus servicios y sus filamentos, en gramos. Vigencia de 30 días. Aceptada, se convierte en pedido.</p>
      {quotes.isPending ? <TableSkeleton columns={5} /> : (
      <table>
        <thead><tr><th>Folio</th><th>Cliente</th><th>Estado</th><th>Total</th><th></th></tr></thead>
        <tbody>
          {(quotes.data?.data ?? []).map((quote) => (
            <tr key={quote.id}>
              <td>{quote.folio}</td>
              <td>{quote.customerName}</td>
              <td>{QUOTE_STATUS[quote.status] ?? quote.status}</td>
              <td>{money(quote.total)}</td>
              <td>
                <div className="record-actions">
                  <ViewLink to={`/app/cotizaciones/${quote.id}`} />
                  {quote.status === "draft" ? (
                    <IconAction label="Enviar" tone="send" pending={pendingId === quote.id} disabled={pendingId !== null} onClick={() => act(quote.id, () => transitionQuote(client, quote.id, "sent"))}>
                      <SendIcon />
                    </IconAction>
                  ) : null}
                  {quote.status === "sent" ? (
                    <IconAction label="Aceptar" tone="accept" pending={pendingId === quote.id} disabled={pendingId !== null} onClick={() => act(quote.id, () => transitionQuote(client, quote.id, "accepted"))}>
                      <CheckIcon />
                    </IconAction>
                  ) : null}
                  {quote.status === "accepted" ? (
                    <IconAction label="A pedido" tone="convert" pending={pendingId === quote.id} disabled={pendingId !== null} onClick={() => act(quote.id, () => convertQuote(client, quote.id))}>
                      <OrderIcon />
                    </IconAction>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function IconAction({ label, tone, pending = false, disabled = false, onClick, children }: { label: string; tone: string; pending?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`icon-btn ${tone}`} type="button" aria-label={pending ? `${label}, en proceso` : label} title={label} disabled={pending || disabled} aria-busy={pending} onClick={onClick}>
      {pending ? <Spinner /> : children}
    </button>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function OrderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 7h11v10H3z" />
      <path d="M14 10h4l3 3v4h-7" />
      <circle cx="7" cy="18" r="1.5" />
      <circle cx="18" cy="18" r="1.5" />
    </svg>
  );
}

function PackageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m12 12 8-4.5" />
      <path d="M12 12v9" />
      <path d="m12 12-8-4.5" />
    </svg>
  );
}

function orderActionTone(to: string) {
  if (to === "pending") return "send";
  if (to === "shipped") return "convert";
  if (to === "delivered") return "view";
  return "accept";
}

function OrderActionIcon({ to }: { to: string }) {
  if (to === "pending") return <ArrowIcon />;
  if (to === "shipped") return <TruckIcon />;
  if (to === "delivered") return <PackageIcon />;
  return <CheckIcon />;
}

export function OrdersPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<{ data: Order[] }>("/orders") });
  async function act(id: string, action: () => Promise<void>) {
    if (pendingId) return;
    setPendingId(id);
    try {
      await run(action);
    } finally {
      setPendingId(null);
    }
  }
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Pedidos</h1>
        <Link className="primary" to="/app/pedidos/nuevo">Nuevo pedido</Link>
      </div>
      <p>El pedido nace de una cotización o se captura directo. Primero se satisface el trabajo, y el cobro y la entrega avanzan por separado.</p>
      {orders.isPending ? <TableSkeleton columns={6} /> : (
      <table>
        <thead><tr><th>Folio</th><th>Cliente</th><th>Estado</th><th>Pago</th><th>Saldo</th><th></th></tr></thead>
        <tbody>
          {(orders.data?.data ?? []).map((order) => {
            const step = nextOrderAction(order.status);
            return (
            <tr key={order.id}>
              <td>{order.folio}</td>
              <td>{order.customerName}</td>
              <td>{ORDER_STATUS[order.status] ?? order.status}</td>
              <td>{PAYMENT_STATUS[order.paymentStatus] ?? order.paymentStatus}</td>
              <td>{money(order.amountDue)}</td>
              <td>
                <div className="record-actions">
                  <ViewLink to={`/app/pedidos/${order.id}`} />
                  {step ? (
                    <IconAction
                      label={step.label}
                      tone={orderActionTone(step.to)}
                      pending={pendingId === order.id}
                      disabled={pendingId !== null}
                      onClick={() => act(order.id, () => transitionOrder(client, order.id, step.to))}
                    >
                      <OrderActionIcon to={step.to} />
                    </IconAction>
                  ) : null}
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      )}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

export function OrderNewPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { error, run } = useError();
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<{ data: Customer[] }>("/customers") });
  const products = useQuery({
    queryKey: ["products", "goods"],
    queryFn: () => api<{ data: CatalogItem[] }>("/products?limit=100"),
  });
  const filamentCatalog = useQuery({ queryKey: ["filaments"], queryFn: () => api<{ data: CatalogItem[] }>("/filaments") });
  const services = useQuery({ queryKey: ["services"], queryFn: () => api<{ data: ServiceOffering[] }>("/services") });
  const filaments = filamentCatalog.data?.data ?? [];
  const goods = (products.data?.data ?? []).filter((product) => product.productType === "component" || product.productType === "finished_good");
  const offerings = (services.data?.data ?? []).filter((service) => service.status === "active");
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/pedidos">Pedidos</Link></p>
      <h1>Nuevo pedido</h1>
      {customers.isPending || products.isPending || filamentCatalog.isPending || services.isPending ? <FormSkeleton fields={6} /> : (
      <DocumentForm
        customers={customers.data?.data ?? []}
        products={goods}
        filaments={filaments}
        services={offerings}
        error={error}
        submitLabel="Guardar pedido"
        shipping
        onSubmit={(body) =>
          run(async () => {
            const created = await api<{ id: string }>("/orders", { method: "POST", body: JSON.stringify(body) });
            await client.invalidateQueries({ queryKey: ["orders"] });
            await client.invalidateQueries({ queryKey: ["dashboard"] });
            navigate(`/app/pedidos/${created.id}`);
          })
        }
      />
      )}
    </section>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const { error, run } = useError();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const order = useQuery({
    queryKey: ["order", id],
    queryFn: () => api<OrderDetail>(`/orders/${id}`),
    enabled: Boolean(id),
  });
  const data = order.data;
  async function act(key: string, action: () => Promise<void>) {
    if (pendingKey) return;
    setPendingKey(key);
    try {
      await run(action);
    } finally {
      setPendingKey(null);
    }
  }
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/pedidos">Pedidos</Link></p>
      {order.isPending ? <DetailSkeleton /> : !data ? <p className="error">No se pudo cargar el pedido.</p> : (
        <>
          <OrderPanel
            order={data}
            error={error}
            pendingKey={pendingKey}
            act={act}
            onChange={async () => {
              await client.invalidateQueries({ queryKey: ["order", id] });
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <Action label="PDF" onClick={() => run(() => download(`/orders/${data.id}/pdf`, `${data.folio}.pdf`))} />
            {nextOrderAction(data.status) ? (
              <Action
                label={nextOrderAction(data.status)!.label}
                pending={pendingKey === "status"}
                disabled={pendingKey !== null}
                onClick={() => act("status", () => transitionOrder(client, data.id, nextOrderAction(data.status)!.to))}
              />
            ) : null}
          </div>
        </>
      )}
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
  pendingKey,
  act,
  onChange,
}: {
  order: OrderDetail;
  error: string | null;
  pendingKey: string | null;
  act: (key: string, action: () => Promise<void>) => Promise<void>;
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
      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>{order.folio}</h2>
          <p style={{ margin: 0 }}>{order.customerName}{order.customerRfc ? ` · RFC ${order.customerRfc}` : ""} · {ORDER_STATUS[order.status] ?? order.status}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {stages.map((stage) => (
            <span key={stage.label} style={{ padding: "4px 10px", borderRadius: 999, background: stage.done ? "var(--color-accent, #1f6b4a)" : "transparent", color: stage.done ? "#fff" : "inherit", border: "1px solid var(--color-line, #ccc)" }}>
              {stage.label}
            </span>
          ))}
        </div>
      </header>
      {order.serviceTerms ? <p style={{ margin: 0 }}>Términos: {order.serviceTerms}</p> : null}
      <div className="scroll-x">
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
              <th>Resolución</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  {line.description}
                  {line.terms ? <div>{line.terms}</div> : null}
                  {line.lineKind === "service" ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                      {(RESOLUTION_NEXT[line.resolution] ?? []).map((step) => {
                        const key = `${line.id}:${step.to}`;
                        return (
                          <Action
                            key={step.to}
                            label={step.label}
                            pending={pendingKey === key}
                            disabled={pendingKey !== null}
                            onClick={() => act(key, async () => {
                              await api(`/orders/${order.id}/lines/${line.id}/resolution`, {
                                method: "POST",
                                body: JSON.stringify({ resolution: step.to }),
                              });
                              await onChange();
                              await client.invalidateQueries({ queryKey: ["orders"] });
                            })}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </td>
                <td>{line.quantity}</td>
                <td>{lineUom(line)}</td>
                <td>{money(line.unitPrice)}</td>
                <td>{money(line.discount)}</td>
                <td>{money(line.net)}</td>
                <td>{money(line.vat)}</td>
                <td>{money(line.total)}</td>
                <td>{line.lineKind === "service" ? (RESOLUTION_LABEL[line.resolution] ?? line.resolution) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ justifySelf: "end", textAlign: "right" }}>
        <p style={{ margin: 0 }}>Subtotal {money(order.subtotal)}</p>
        <p style={{ margin: 0 }}>Descuento {money(order.discount)}</p>
        {order.shipping && order.shipping !== "0.00" ? <p style={{ margin: 0 }}>Envío {money(order.shipping)}</p> : null}
        <p style={{ margin: 0 }}>IVA {money(order.vat)}</p>
        <p style={{ margin: 0, fontSize: 20 }}><strong>Total {money(order.total)} {order.currency}</strong></p>
        <p style={{ margin: 0 }}>Saldo {money(order.amountDue)}</p>
      </div>
      <p style={{ margin: 0, fontWeight: 600 }}>Documento comercial. No es un CFDI.</p>
      {error ? <p className="error">{error}</p> : null}
    </article>
  );
}

export function CollectionsPage() {
  const payments = useQuery({ queryKey: ["payments"], queryFn: () => api<{ data: Payment[] }>("/payments") });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Cobranza</h1>
        <Link className="primary" to="/app/cobranza/nuevo">Registrar cobro</Link>
      </div>
      <p>Efectivo, SPEI, tarjeta o contra entrega. El saldo sale del libro de pagos, no de una casilla.</p>
      {payments.isPending ? <TableSkeleton columns={5} /> : (
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
      )}
    </section>
  );
}

export function PaymentNewPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { error, run } = useError();
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<{ data: Order[] }>("/orders") });
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/cobranza">Cobranza</Link></p>
      <h1>Registrar cobro</h1>
      {orders.isPending ? <FormSkeleton fields={5} /> : (
      <form
        className="card"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
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
            await client.invalidateQueries({ queryKey: ["payments"] });
            await client.invalidateQueries({ queryKey: ["orders"] });
            await client.invalidateQueries({ queryKey: ["dashboard"] });
            navigate("/app/cobranza");
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
        <button className="primary" type="submit">Guardar cobro</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      )}
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
  const filamentCatalog = useQuery({ queryKey: ["filaments"], queryFn: () => api<{ data: CatalogItem[] }>("/filaments") });
  const services = useQuery({ queryKey: ["services"], queryFn: () => api<{ data: ServiceOffering[] }>("/services") });
  const filaments = filamentCatalog.data?.data ?? [];
  const goods = (products.data?.data ?? []).filter((product) => product.productType === "component" || product.productType === "finished_good");
  const offerings = (services.data?.data ?? []).filter((service) => service.status === "active");
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/cotizaciones">Cotizaciones</Link></p>
      <h1>Nueva cotización</h1>
      {customers.isPending || products.isPending || filamentCatalog.isPending || services.isPending ? <FormSkeleton fields={6} /> : (
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
      )}
    </section>
  );
}

export function QuoteDetailPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const { error, run } = useError();
  const [pending, setPending] = useState(false);
  async function act(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    try {
      await run(action);
    } finally {
      setPending(false);
    }
  }
  const quote = useQuery({
    queryKey: ["quote", id],
    queryFn: () => api<QuoteDetail>(`/quotes/${id}`),
    enabled: Boolean(id),
  });
  const data = quote.data;
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <p><Link to="/app/cotizaciones">Cotizaciones</Link></p>
      {quote.isPending ? <DetailSkeleton /> : !data ? <p className="error">No se pudo cargar la cotización.</p> : (
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
            {data.status === "draft" ? <Action label="Enviar" pending={pending} onClick={() => act(() => transitionQuote(client, data.id, "sent"))} /> : null}
            {data.status === "sent" ? <Action label="Aceptar" pending={pending} onClick={() => act(() => transitionQuote(client, data.id, "accepted"))} /> : null}
            {data.status === "accepted" ? <Action label="A pedido" pending={pending} onClick={() => act(() => convertQuote(client, data.id))} /> : null}
          </div>
          {error ? <p className="error">{error}</p> : null}
        </>
      )}
    </section>
  );
}

const ORDER_STATUS: Record<string, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  confirmed: "Confirmado",
  in_production: "En producción",
  ready_to_ship: "Listo",
  shipped: "Embarcado",
  delivered: "Entregado",
  completed: "Completado",
  on_hold: "En espera",
  cancelled: "Cancelado",
};

const PAYMENT_STATUS: Record<string, string> = {
  pending: "Por cobrar",
  partial: "Parcial",
  paid: "Pagado",
};

function lineUom(line: { lineKind: string; uom?: string }): string {
  if (line.uom) return line.uom;
  if (line.lineKind === "filament") return "g";
  if (line.lineKind === "service") return "servicio";
  return "pza";
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
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const allOpen = prints.length > 0 && prints.every((print) => openIds.has(print.id));
  const toggle = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <div className="scroll-x">
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
      <button className="ghost" type="button" onClick={() => setOpenIds(allOpen ? new Set() : new Set(prints.map((print) => print.id)))}>
        {allOpen ? "Cerrar todas" : "Desplegar todas"}
      </button>
    </div>
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
          const open = openIds.has(print.id);
          return (
            <Fragment key={print.id}>
              <tr>
                <td>
                  <button className="ghost" type="button" aria-expanded={open} onClick={() => toggle(print.id)}>
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

function Action({ label, onClick, pending = false, disabled = false }: { label: string; onClick: () => void; pending?: boolean; disabled?: boolean }) {
  return (
    <button className="ghost" type="button" disabled={pending || disabled} aria-busy={pending} onClick={onClick}>
      {pending ? <Spinner /> : label}
    </button>
  );
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
  await client.invalidateQueries({ queryKey: ["order", id] });
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

interface CustomerDetail extends Customer {
  kind: string;
  phone: string | null;
  balance: string | null;
  fiscal: { line1: string; neighborhood: string; postalCode: string; state: string } | null;
  orders: Array<{ id: string; folio: string; status: string; total: string | null }>;
  quotes: Array<{ id: string; folio: string; status: string; total: string | null }>;
  payments: Array<{ id: string; orderId: string; folio: string; method: string; status: string; amount: string | null; reference: string | null }>;
}

function ActivityColumn({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : children ? [children] : [];
  return (
    <article className="card" style={{ display: "grid", gap: 4, alignContent: "start" }}>
      <h2 style={{ margin: "0 0 8px" }}>{title}</h2>
      {items.length ? children : <p style={{ margin: 0, color: "var(--color-muted)" }}>{empty}</p>}
    </article>
  );
}

function ActivityRow({ title, detail, to }: { title: string; detail: string; to: string }) {
  return (
    <div className="activity-row">
      <div>
        <strong>{title}</strong>
        <p style={{ margin: 0, color: "var(--color-muted)" }}>{detail}</p>
      </div>
      <ViewLink to={to} />
    </div>
  );
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
  customerRfc?: string | null;
  status: string;
  paymentStatus: string;
  amountDue: string | null;
  subtotal?: string | null;
  discount?: string | null;
  shipping?: string | null;
  vat?: string | null;
  total?: string | null;
  currency?: string;
}

interface OrderDetail extends Order {
  serviceTerms: string | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: string;
    lineKind: string;
    uom?: string;
    terms: string | null;
    resolution: string;
    unitPrice: string | null;
    discount: string | null;
    net: string | null;
    vat: string | null;
    total: string | null;
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
