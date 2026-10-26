import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Money, formatQty, parseQty } from "@3dprintmty/domain";
import { api, ApiError } from "./api";
import { EntityAutocomplete } from "./entity-autocomplete";
import { useIdempotencyAttempt } from "./idempotency";
import { Notice } from "./notice";
import { EmptyState } from "./empty-state";
import { money } from "./operations";
import { Pagination } from "./pager";
import { BackLink } from "./back-control";
import { TableSkeleton } from "./skeleton";
import { posKey, posTotals, type PosCartLine, type PosItem } from "./pos-cart";

interface Catalog {
  locationId: string; locations: Array<{ id: string; name: string }>;
  vatRate: string; isrRate: string; methods: string[]; items: PosItem[];
}
interface Receipt {
  id: string; folio: string; createdAt: string; customerName: string; customerRfc: string | null;
  issuer: string; issuerRfc: string; locationName: string; subtotal: string; discount: string;
  vat: string; isrWithheld: string; total: string; method: string; reference: string | null;
  cashTendered: string | null; change: string;
  lines: Array<{ id: string; description: string; quantity: string; unitPrice: string; discount: string; net: string }>;
}
const TYPES: Record<string, string> = { service: "Servicio", finished: "Producto terminado", product: "Producto", supply: "Insumo", mixed: "Fabricación y reventa" };
const METHODS: Record<string, string> = { efectivo: "Efectivo", tarjeta: "Tarjeta", spei: "Transferencia" };
const date = (value: string) => new Date(value).toLocaleString("es-MX");

export function PosPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [locationId, setLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState("all");
  const [includeOutOfStock, setIncludeOutOfStock] = useState(false);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [general, setGeneral] = useState(true);
  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState("");
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryPayload, setRetryPayload] = useState<object | null>(null);
  const submitting = useRef(false);
  const attempt = useIdempotencyAttempt();
  const locked = pending || retryPayload !== null;
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const catalog = useQuery({ queryKey: ["pos-catalog", locationId, query, itemType, includeOutOfStock], queryFn: () => api<Catalog>(`/pos/catalog?${new URLSearchParams({ ...(locationId ? { locationId } : {}), q: query, type: itemType, includeOutOfStock: String(includeOutOfStock) })}`) });
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<{ data: Array<{ id: string; legalName: string; rfc: string | null; phone: string | null; status: string }> }>("/customers") });
  const data = catalog.data;
  const activeMethod = method || data?.methods[0] || "";
  let totals: ReturnType<typeof posTotals> | null = null;
  let cartError: string | null = null;
  if (cart.length) try { totals = posTotals(cart); } catch (cause) { cartError = cause instanceof Error ? cause.message : "Revisa las partidas."; }
  let change: string | null = null;
  if (totals && activeMethod === "efectivo") try {
    const difference = Money.fromMajor(received || "0").minor - Money.fromMajor(totals.total).minor;
    if (difference >= 0n) change = Money.fromMinor(difference).toMajor();
  } catch { /* Captura incompleta. */ }

  function add(item: PosItem) {
    if (locked || !data) return;
    setCart((current) => {
      const found = current.find((line) => posKey(line) === posKey(item));
      if (!found) return [...current, { ...item, quantity: "1", discount: "0", vatRate: data.vatRate, isrRate: data.isrRate }];
      return current.map((line) => {
        if (posKey(line) !== posKey(item)) return line;
        let quantity = 0n;
        try { quantity = parseQty(line.quantity || "0"); } catch { /* Reemplazar una captura incompleta. */ }
        return { ...line, quantity: formatQty(quantity + parseQty("1")) };
      });
    });
  }
  function patch(key: string, value: Partial<PosCartLine>) { setCart((current) => current.map((line) => posKey(line) === key ? { ...line, ...value } : line)); }

  async function checkout(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!retryPayload && (!totals || !data || (!general && !customerId))) { setError("Selecciona el cliente y agrega artículos válidos al carrito."); return; }
    const payload = retryPayload ?? {
      locationId: locationId || data!.locationId, customerId: general ? undefined : customerId,
      method: activeMethod, cashTendered: activeMethod === "efectivo" ? received : undefined, reference,
      expectedTotal: totals!.total,
      lines: cart.map(({ id, kind, quantity, unitPrice, discount, vatRate, isrRate }) => ({ id, kind, quantity, unitPrice, discount, vatRate, isrRate })),
    };
    submitting.current = true; setPending(true); setError(null); setRetryPayload(payload);
    try {
      const sale = await api<Receipt>("/pos/sales", { method: "POST", headers: attempt.headers(payload), body: JSON.stringify(payload) });
      attempt.complete();
      // La venta ya terminó: una recarga de las listas no debe ofrecer cobrarla otra vez.
      for (const key of ["orders", "payments", "dashboard", "pos-catalog", "pos-sales", "customers", "inventory", "balances", "products"]) void client.invalidateQueries({ queryKey: [key] });
      client.setQueryData(["pos-receipt", sale.id], sale);
      setCart([]); setRetryPayload(null);
      navigate(`/app/punto-de-venta/ticket/${sale.id}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code !== "internal_error") setRetryPayload(null);
      setError(cause instanceof Error ? cause.message : "No se pudo completar la venta.");
    } finally { submitting.current = false; setPending(false); }
  }

  return <section className="pos-page">
    <header className="no-print"><h1>Punto de venta</h1><p className="muted-note">Venta de mostrador con cobro y entrega inmediata.</p></header>
    <div className="pos-layout">
      <section className="card pos-catalog" aria-label="Catálogo de venta">
        <div className="pos-catalog-tools">
          <label>Sucursal<select value={locationId || data?.locationId || ""} disabled={locked} onChange={(event) => { setLocationId(event.target.value); setCart([]); setReceived(""); setError(null); }}>
            {data?.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select><span className="costing-hint">Cambiar de sucursal vacía el carrito.</span></label>
          <label>Buscar artículos<input type="search" value={search} disabled={locked} placeholder="Nombre o SKU" onChange={(event) => setSearch(event.target.value)} /></label>
          <label>Tipo<select value={itemType} disabled={locked} onChange={(event) => setItemType(event.target.value)}>
            <option value="all">Todos los tipos</option><option value="service">Servicios</option><option value="finished">Productos terminados</option><option value="product">Productos</option>
          </select></label>
          <label className="pos-checkbox"><input type="checkbox" checked={includeOutOfStock} disabled={locked} onChange={(event) => setIncludeOutOfStock(event.target.checked)} />Mostrar sin inventario</label>
        </div>
        {catalog.isPending ? <TableSkeleton columns={3} /> : catalog.isError ? <Notice title="No se pudo cargar el catálogo" tone="error" action={<button type="button" className="ghost" onClick={() => void catalog.refetch()}>Reintentar</button>}>Revisa la conexión y vuelve a intentar.</Notice> : !data?.items.length ?
          <EmptyState title={query || itemType !== "all" ? "Sin coincidencias" : "Sin artículos para vender"} to="/app/productos/nuevo" actionLabel="Agregar producto">{query || itemType !== "all" ? "Prueba con otro nombre, SKU o tipo de artículo. También puedes mostrar los productos sin inventario." : "Agrega productos con precio de venta y existencias, o servicios con precio. Los productos sin existencias disponibles están ocultos por defecto."}</EmptyState> : <>
            <p className="costing-hint">Precios unitarios antes de impuestos. Busca por nombre o SKU para encontrar más artículos.</p>
            <div className="pos-items" aria-busy={catalog.isFetching}>{data.items.map((item) => <button type="button" className="pos-item" key={posKey(item)} disabled={locked || catalog.isFetching || (item.available !== null && Number(item.available) <= 0)} onClick={() => add(item)}>
              <span className="pos-item-code">{item.sku} · {TYPES[item.category ?? item.kind]}</span>
              <strong>{item.name}</strong><span>{money(item.unitPrice)}</span>
              <small>{item.available === null ? "Atención inmediata" : `${item.available} ${item.uom} disponibles`}</small>
            </button>)}</div>
          </>}
      </section>
      <form className="card pos-checkout" onSubmit={(event) => void checkout(event)}>
        <h2>Venta actual <span className="costing-hint">{cart.length} partidas</span></h2>
        <fieldset disabled={locked}>
          <label className="pos-checkbox"><input type="checkbox" checked={general} onChange={(event) => setGeneral(event.target.checked)} />Público en general</label>
          {!general ? <EntityAutocomplete label="Cliente" value={customerId} disabled={locked || customers.isPending || customers.isError}
            options={(customers.data?.data ?? []).filter((customer) => customer.status === "active").map((customer) => ({ id: customer.id, label: [customer.legalName, customer.rfc, customer.phone].filter(Boolean).join(" · ") }))}
            placeholder="Buscar por nombre, RFC o teléfono" onChange={setCustomerId} /> : null}
          {!general && customers.isError ? <Notice title="No se pudieron cargar los clientes" tone="error" action={<button type="button" className="ghost" onClick={() => void customers.refetch()}>Reintentar</button>}>Vuelve a intentar para seleccionar un cliente.</Notice> : null}
          <div className="pos-cart">{!cart.length ? <Notice title="Carrito vacío">Selecciona un producto o servicio para empezar.</Notice> : cart.map((line) => <article key={posKey(line)} className="pos-cart-line">
            <div className="pos-cart-heading"><strong>{line.name}</strong><button type="button" className="ghost" aria-label={`Quitar ${line.name}`} onClick={() => setCart((current) => current.filter((item) => posKey(item) !== posKey(line)))}>Quitar</button></div>
            <div className="pos-line-inputs">
              <label>Cantidad<input aria-label={`Cantidad de ${line.name}`} type="number" min="0.0001" step="0.0001" required value={line.quantity} onChange={(event) => patch(posKey(line), { quantity: event.target.value })} /></label>
              <label>Precio unitario<input aria-label={`Precio de ${line.name}`} type="number" min="0" step="0.01" required value={line.unitPrice} onChange={(event) => patch(posKey(line), { unitPrice: event.target.value })} /></label>
              <label>Descuento MXN<input aria-label={`Descuento de ${line.name}`} type="number" min="0" step="0.01" required value={line.discount} onChange={(event) => patch(posKey(line), { discount: event.target.value })} /></label>
              {Number(data?.vatRate) > 0 ? <label>IVA %<input type="number" min="0" max="100" step="0.0001" required value={Number(line.vatRate) * 100} onChange={(event) => patch(posKey(line), { vatRate: String(Number(event.target.value) / 100) })} /></label> : null}
              {Number(data?.isrRate) > 0 ? <label>Retención ISR %<input type="number" min="0" max="100" step="0.0001" required value={Number(line.isrRate) * 100} onChange={(event) => patch(posKey(line), { isrRate: String(Number(event.target.value) / 100) })} /></label> : null}
            </div>
          </article>)}</div>
          {cart.length ? <button type="button" className="ghost" onClick={() => { setCart([]); setReceived(""); }}>Vaciar carrito</button> : null}
          <dl className="pos-totals"><div><dt>Subtotal después de descuentos</dt><dd>{money(totals?.subtotal)}</dd></div><div><dt>Descuentos</dt><dd>{money(totals?.discount)}</dd></div><div><dt>IVA</dt><dd>{money(totals?.tax)}</dd></div>{Number(totals?.isrWithheld) > 0 ? <div><dt>Retención ISR</dt><dd>−{money(totals?.isrWithheld)}</dd></div> : null}<div className="pos-total"><dt>Total MXN</dt><dd>{money(totals?.total)}</dd></div></dl>
          <label>Método de pago<select required value={activeMethod} onChange={(event) => { setMethod(event.target.value); setReceived(""); }}><option value="" disabled>Selecciona un método</option>{data?.methods.map((value) => <option value={value} key={value}>{METHODS[value]}</option>)}</select></label>
          {activeMethod === "efectivo" ? <><label>Efectivo recibido<input type="number" min={totals?.total ?? "0"} step="0.01" required value={received} onChange={(event) => setReceived(event.target.value)} /></label><div className="pos-change">Cambio <strong>{money(change)}</strong></div></> : <><label>Referencia del cobro<input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></label><p className="costing-hint">Registra aquí el cobro realizado en tu terminal o banco.</p></>}
        </fieldset>
        {data && !data.methods.length ? <Notice title="Sin métodos de cobro activos" action={<Link className="ghost" to="/app/configuracion">Ver configuración</Link>}>Activa efectivo, tarjeta o transferencia en la configuración del taller.</Notice> : null}
        {cartError ? <Notice title="Revisa el carrito" tone="error">{cartError}</Notice> : null}
        {error ? <Notice title="No se pudo confirmar el cobro" tone="error">{error}{retryPayload ? <p>Reintenta esta misma operación para comprobar el resultado sin duplicar la venta.</p> : null}</Notice> : null}
        <button className="primary" type="submit" disabled={pending || (!retryPayload && (!totals || !activeMethod || catalog.isPending || catalog.isError || (!general && !customerId) || (activeMethod === "efectivo" && change === null)))}>{pending ? "Registrando venta…" : retryPayload ? "Reintentar el mismo cobro" : `Cobrar ${money(totals?.total)}`}</button>
      </form>
    </div>
    <PosHistory />
  </section>;
}

function PosHistory() {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const sales = useQuery({ queryKey: ["pos-sales", page, size], queryFn: () => api<{ data: Array<Pick<Receipt, "id" | "folio" | "createdAt" | "customerName" | "total">>; total: number }>(`/pos/sales?page=${page}&limit=${size}`) });
  const total = sales.data?.total ?? 0;
  return <section className="card no-print"><h2>Ventas de mostrador</h2>{sales.isPending ? <TableSkeleton columns={5} /> : sales.isError ? <Notice title="No se pudo cargar el historial" tone="error" action={<button className="ghost" onClick={() => void sales.refetch()}>Reintentar</button>}>Vuelve a intentar.</Notice> : !total ? <Notice title="Todavía no hay ventas">Las ventas cobradas aparecerán aquí para consultar y reimprimir su ticket.</Notice> : <>
    <div className="scroll-x"><table><thead><tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Ticket</th></tr></thead><tbody>{sales.data?.data.map((sale) => <tr key={sale.id}><td>{sale.folio}</td><td>{date(sale.createdAt)}</td><td>{sale.customerName}</td><td>{money(sale.total)}</td><td><Link to={`/app/punto-de-venta/ticket/${sale.id}`}>Ver ticket</Link></td></tr>)}</tbody></table></div>
    <Pagination size={size} from={(page - 1) * size + 1} to={Math.min(page * size, total)} total={total} hasPrevious={page > 1} hasNext={page * size < total} busy={sales.isFetching} onSizeChange={(value) => { setSize(value); setPage(1); }} onPrevious={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />
  </>}</section>;
}

export function PosTicketPage() {
  const { id } = useParams();
  const ticket = useQuery({ queryKey: ["pos-receipt", id], queryFn: () => api<Receipt>(`/pos/sales/${id}`), enabled: Boolean(id) });
  const sale = ticket.data;
  return <section className="pos-ticket-page"><div className="no-print pos-ticket-actions"><BackLink to="/app/punto-de-venta">Punto de venta</BackLink>{sale ? <button type="button" className="primary" onClick={() => window.print()}>Imprimir ticket</button> : null}</div>
    {ticket.isPending ? <TableSkeleton columns={2} /> : ticket.isError || !sale ? <Notice title="No se pudo cargar el ticket" tone="error" action={<button className="ghost" onClick={() => void ticket.refetch()}>Reintentar</button>}>Verifica la conexión e intenta nuevamente.</Notice> : <article className="card printable pos-ticket">
      <header><h1>{sale.issuer}</h1><p>RFC {sale.issuerRfc}</p><p>{sale.locationName}</p><h2>Ticket de venta · {sale.folio}</h2><p>{date(sale.createdAt)}</p></header>
      <p>{sale.customerName}<br />{sale.customerRfc}</p>
      <table><thead><tr><th>Concepto</th><th>Importe</th></tr></thead><tbody>{sale.lines.map((line) => <tr key={line.id}><td>{line.description}<small>{line.quantity} × {money(line.unitPrice)}{Number(line.discount) > 0 ? ` · Descuento ${money(line.discount)}` : ""}</small></td><td>{money(line.net)}</td></tr>)}</tbody></table>
      <dl className="pos-totals"><div><dt>Subtotal</dt><dd>{money(sale.subtotal)}</dd></div><div><dt>Descuentos</dt><dd>{money(sale.discount)}</dd></div><div><dt>IVA</dt><dd>{money(sale.vat)}</dd></div>{Number(sale.isrWithheld) > 0 ? <div><dt>Retención ISR</dt><dd>−{money(sale.isrWithheld)}</dd></div> : null}<div className="pos-total"><dt>Total MXN</dt><dd>{money(sale.total)}</dd></div><div><dt>Pago</dt><dd>{METHODS[sale.method] ?? sale.method}</dd></div>{sale.cashTendered !== null ? <><div><dt>Efectivo recibido</dt><dd>{money(sale.cashTendered)}</dd></div><div><dt>Cambio</dt><dd>{money(sale.change)}</dd></div></> : null}</dl>
      {sale.reference ? <p>Referencia: {sale.reference}</p> : null}<p className="pos-ticket-footnote">Gracias por tu compra.<br />Comprobante de venta. No es un CFDI.</p>
      <p className="no-print"><Link to={`/app/pedidos/${sale.id}`}>Ver pedido y cobranza</Link></p>
    </article>}
  </section>;
}
