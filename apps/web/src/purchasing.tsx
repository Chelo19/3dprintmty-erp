import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, download, idempotencyHeader, postJson } from "./api";
import { Action, useFilaments, useProducts } from "./factory";
import { money, useError } from "./operations";
import { DetailSkeleton, TableSkeleton } from "./skeleton";

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 } as const;

const PO_STATUS: Record<string, string> = {
  draft: "Borrador",
  ordered: "Colocada",
  partially_received: "Recibida parcial",
  received: "Recibida",
  closed: "Cerrada",
  cancelled: "Cancelada",
};

function useVendors() {
  return useQuery({ queryKey: ["vendors"], queryFn: () => api<{ data: Vendor[] }>("/vendors") });
}

export function PurchasingPage() {
  const client = useQueryClient();
  const { error, run } = useError();
  const vendors = useVendors();
  const products = useProducts();
  const filaments = useFilaments();
  const orders = useQuery({ queryKey: ["purchase-orders"], queryFn: () => api<{ data: PurchaseOrder[] }>("/purchase-orders") });
  const buyable = [
    ...(filaments.data?.data ?? []),
    ...(products.data?.data ?? []).filter((product) => product.productType === "component"),
  ];
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Compras</h1>
      <p>El filamento se compra en kilogramos y entra al inventario en gramos, con lote.</p>
      <form
        className="card"
        style={grid}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void run(async () => {
            await postJson("/vendors", {
              name: data.get("name"),
              rfc: String(data.get("rfc") || "") || undefined,
              email: String(data.get("email") || "") || undefined,
              paymentTerms: data.get("paymentTerms"),
              leadTimeDays: Number(data.get("leadTimeDays") || 0),
            });
            form.reset();
            await client.invalidateQueries({ queryKey: ["vendors"] });
          });
        }}
      >
        <label>Proveedor<input name="name" required /></label>
        <label>RFC<input name="rfc" /></label>
        <label>Correo<input name="email" type="email" /></label>
        <label>
          Pago
          <select name="paymentTerms" defaultValue="contado">
            <option value="contado">Contado</option>
            <option value="net_15">15 días</option>
            <option value="net_30">30 días</option>
            <option value="net_60">60 días</option>
          </select>
        </label>
        <label>Días de entrega<input name="leadTimeDays" type="number" min={0} defaultValue={3} /></label>
        <button className="ghost" type="submit">Agregar proveedor</button>
      </form>
      <form
        className="card"
        style={grid}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void run(async () => {
            await postJson("/purchase-orders", {
              vendorId: data.get("vendorId"),
              expectedDate: String(data.get("expectedDate") || "") || undefined,
              lines: [{ productId: data.get("productId"), quantity: data.get("quantity"), unitCost: String(data.get("unitCost") || "") || undefined }],
            });
            form.reset();
            await client.invalidateQueries({ queryKey: ["purchase-orders"] });
          });
        }}
      >
        <label>
          Proveedor
          <select name="vendorId" required>
            {(vendors.data?.data ?? []).filter((vendor) => vendor.active).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
          </select>
        </label>
        <label>
          Producto
          <select name="productId" required>
            {buyable.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name} (por {product.purchaseUom})</option>)}
          </select>
        </label>
        <label>Cantidad<input name="quantity" required placeholder="10" /></label>
        <label>Costo unitario<input name="unitCost" placeholder="Costo del catálogo" /></label>
        <label>Llega<input name="expectedDate" type="date" /></label>
        <button className="primary" type="submit">Crear orden de compra</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      {orders.isPending ? <TableSkeleton columns={5} /> : (
      <table>
        <thead><tr><th>Folio</th><th>Proveedor</th><th>Estado</th><th>Llega</th><th>Total</th></tr></thead>
        <tbody>
          {(orders.data?.data ?? []).map((order) => (
            <tr key={order.id}>
              <td><Link to={`/app/compras/${order.id}`}>{order.folio}</Link></td>
              <td>{order.vendorName}</td>
              <td>{PO_STATUS[order.status] ?? order.status}</td>
              <td>{order.expectedDate ?? "—"}</td>
              <td>{money(order.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}

export function PurchaseOrderPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const { error, run } = useError();
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
    });
  const receivable = data.status === "ordered" || data.status === "partially_received";
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <header>
        <Link to="/app/compras">← Compras</Link>
        <h1>{data.folio} · {data.vendorName}</h1>
        <p>{PO_STATUS[data.status] ?? data.status} · subtotal {money(data.subtotal)} · IVA {money(data.vat)} · total {money(data.total)}</p>
      </header>
      <div style={{ display: "flex", gap: 8 }}>
        {data.status === "draft" ? <button className="primary" type="button" onClick={() => void move("ordered")}>Colocar con el proveedor</button> : null}
        {data.status === "partially_received" || data.status === "received" ? <Action label="Cerrar" onClick={() => void move("closed")} /> : null}
        {data.status === "draft" || data.status === "ordered" ? (
          <Action
            label="Cancelar"
            onClick={() => {
              const reason = window.prompt("¿Por qué se cancela?");
              if (reason) void move("cancelled", reason);
            }}
          />
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {result ? <p className="banner">{result}</p> : null}
      <table>
        <thead><tr><th>Producto</th><th>Pedido</th><th>Recibido</th><th>Pendiente</th><th>Costo</th><th>Importe</th></tr></thead>
        <tbody>
          {data.lines.map((line) => (
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
      {receivable ? (
        <form
          className="card"
          style={grid}
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
            });
          }}
        >
          <strong style={{ gridColumn: "1 / -1" }}>Recibir</strong>
          <label>
            Línea
            <select name="lineId" required>
              {data.lines.filter((line) => line.pendingQty !== "0").map((line) => <option key={line.id} value={line.id}>{line.sku} · faltan {line.pendingQty} {line.purchaseUom}</option>)}
            </select>
          </label>
          <label>Cantidad (unidad de compra)<input name="quantity" required placeholder="1" /></label>
          <label>Lote interno<input name="lotNumber" placeholder="Automático" /></label>
          <label>Lote del proveedor<input name="vendorLot" /></label>
          <button className="primary" type="submit">Registrar recepción</button>
          <p style={{ margin: 0, gridColumn: "1 / -1" }}>El filamento entra al inventario en gramos. El costo del catálogo se actualiza con promedio ponderado.</p>
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
  const { error, run } = useError();
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
          });
        }}
      >
        <label>
          Pedido
          <select name="salesOrderId" required>
            {billable.map((order) => <option key={order.id} value={order.id}>{order.folio} · {order.customerName}</option>)}
          </select>
        </label>
        <button className="primary" type="submit">Emitir prefactura</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <div className="card" style={grid}>
        <strong style={{ gridColumn: "1 / -1" }}>Paquete para el contador</strong>
        <label>Desde<input type="date" value={period.from} onChange={(event) => setPeriod({ ...period, from: event.target.value })} /></label>
        <label>Hasta<input type="date" value={period.to} onChange={(event) => setPeriod({ ...period, to: event.target.value })} /></label>
        <button className="primary" type="button" onClick={() => void run(() => download(`/exports/accountant?from=${period.from}&to=${period.to}&format=zip`, `paquete_contador_${period.from}_${period.to}.zip`))}>
          Descargar ZIP
        </button>
        <button className="ghost" type="button" onClick={() => void run(() => download(`/exports/accountant?from=${period.from}&to=${period.to}&format=csv`, `prefacturas_${period.from}_${period.to}.csv`))}>
          Solo CSV
        </button>
      </div>
      {documents.isPending ? <TableSkeleton columns={6} /> : (
      <table>
        <thead><tr><th>Folio</th><th>Cliente</th><th>RFC</th><th>Método</th><th>Total</th><th>Estado</th></tr></thead>
        <tbody>
          {(documents.data?.data ?? []).map((document) => (
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
    </section>
  );
}

export function PrefacturaPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const { error, run } = useError();
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
            onClick={() => {
              const reason = window.prompt("Motivo de cancelación");
              if (!reason) return;
              void run(async () => {
                await postJson(`/prefacturas/${id}/void`, { reason });
                await client.invalidateQueries({ queryKey: ["prefactura", id] });
                await client.invalidateQueries({ queryKey: ["prefacturas"] });
              });
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
        <table>
          <thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio</th><th>Descuento</th><th>Importe</th><th>IVA</th></tr></thead>
          <tbody>
            {data.lines.map((line) => (
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
