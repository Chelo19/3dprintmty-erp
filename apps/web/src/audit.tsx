import { Pagination } from "./pager";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { roleLabel } from "@3dprintmty/domain";
import { api } from "./api";
import { Notice } from "./notice";
import { TableSkeleton } from "./skeleton";

const ENTITIES: Record<string, string> = {
  tenants: "Taller", company_profiles: "Empresa", locations: "Sucursales", tax_rates: "Impuestos",
  payment_method_settings: "Métodos de pago", number_sequences: "Folios", tenant_memberships: "Equipo", invitations: "Invitaciones",
  products: "Productos e insumos", filaments: "Filamentos", service_offerings: "Servicios", customers: "Clientes", customer_addresses: "Domicilios",
  quotes: "Cotizaciones", quote_prints: "Impresiones cotizadas", quote_lines: "Partidas cotizadas",
  sales_orders: "Pedidos", sales_order_prints: "Impresiones de pedidos", sales_order_lines: "Partidas de pedidos", sales_order_events: "Seguimiento de pedidos",
  payments: "Cobros", stock_ledgers: "Movimientos de inventario", stock_balances: "Existencias",
  spools: "Rollos", spool_events: "Movimientos de rollos", material_lots: "Lotes", boms: "Recetas", bom_lines: "Materiales de recetas", bom_service_lines: "Servicios de recetas",
  work_centers: "Centros de trabajo", routings: "Rutas", routing_operations: "Operaciones de rutas",
  production_orders: "Órdenes de producción", production_order_materials: "Materiales de producción", production_order_operations: "Operaciones de producción", production_consumptions: "Consumos", inspections: "Calidad", defect_types: "Defectos",
  vendors: "Proveedores", purchase_orders: "OC históricas", purchase_order_lines: "Partidas de OC históricas", receipts: "Recepciones", receipt_lines: "Partidas recibidas", expenses: "Gastos", expense_payments: "Abonos de gastos", commercial_documents: "Documentos comerciales", commercial_document_lines: "Partidas comerciales",
};
const ENTITY_ALIASES: Record<string, string> = { company: "Empresa", bom: "Recetas", product: "Productos e insumos", expense: "Gastos", payment: "Cobros", membership: "Equipo", invitation: "Invitaciones", sales_order: "Pedidos", receipt: "Recepciones", production_order: "Producción" };
const FIELDS: Record<string, string> = { name: "Nombre", description: "Descripción", status: "Estado", role: "Rol", quantity: "Cantidad", on_hand: "Existencia", allocated: "Apartado", reason: "Motivo", note: "Nota", notes: "Notas", total_minor: "Total (centavos)", vat_minor: "IVA (centavos)", isr_withheld_minor: "ISR (centavos)", unit_price_minor: "Precio (centavos)", sale_price_minor: "Precio de venta (centavos)", cost_minor: "Costo (centavos)", amount_minor: "Importe (centavos)", default_isr_rate: "ISR predeterminado", rate: "Tasa", enabled: "Habilitado", resolution: "Resolución", legal_name: "Razón social", email: "Correo", phone: "Teléfono", rfc: "RFC" };
type Cursor = { before: string; beforeId: string };
type AuditEvent = { id: string; createdAt: string; actorUserId: string | null; actorEmail: string | null; actorRole: string | null; impersonator: string | null; action: string; entityType: string; entityId: string | null; metadata: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; changedFields?: string[]; origin?: string; transactionId?: string; [key: string]: unknown } };
function valueText(value: unknown): string { return value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value); }
function actionLabel(action: string) { return ({ "record.insert": "Alta", "record.update": "Cambio", "record.delete": "Baja", "company.fiscal_updated": "Configuración actualizada", "bom.saved": "Receta guardada", "payment.recorded": "Cobro registrado", "payment.completed": "Cobro confirmado", "payment.voided": "Cobro cancelado", "expense.payment_recorded": "Abono registrado", "expense.created": "Gasto registrado", "team.role_changed": "Rol actualizado", "team.member_removed": "Usuario retirado", "team.joined": "Usuario incorporado", "credit.override": "Crédito autorizado" } as Record<string, string>)[action] ?? "Acción registrada"; }

export function AuditPage() {
  const [entityType, setEntityType] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [size, setSize] = useState(10);
  const [cursors, setCursors] = useState<Array<Cursor | null>>([null]);
  const cursor = cursors.at(-1);
  const query = new URLSearchParams({ limit: String(size), ...(entityType ? { entityType } : {}), ...(actor ? { actor } : {}), ...(action ? { action } : {}), ...(cursor ?? {}) });
  const history = useQuery({ queryKey: ["audit-events", query.toString()], queryFn: () => api<{ data: AuditEvent[]; total: number; entityTypes: string[]; next: Cursor | null }>(`/audit-events?${query}`) });
  const moduleOptions = (history.data?.entityTypes ?? []).map((key) => ({ key, label: ENTITIES[key] ?? ENTITY_ALIASES[key] ?? key }))
    .sort((a, b) => a.label.localeCompare(b.label, "es-MX"));
  useEffect(() => {
    if (history.data && entityType && !history.data.entityTypes.includes(entityType)) {
      setEntityType("");
      setCursors([null]);
    }
  }, [history.data, entityType]);
  return <section style={{ display: "grid", gap: 16 }}>
    <header><h1>Bitácora de actividad</h1><p>Consulta quién realizó cada acción, cuándo ocurrió y qué cambió en el taller. Los registros se conservan y no se pueden editar desde la aplicación.</p></header>
    <div className="filters">
      <label>Módulo<select value={entityType} onChange={(event) => { setEntityType(event.target.value); setCursors([null]); }}><option value="">Todos</option>{moduleOptions.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Usuario<input value={actor} placeholder="Buscar por correo" maxLength={120} onChange={(event) => { setActor(event.target.value); setCursors([null]); }} /></label>
      <label>Movimiento<select value={action} onChange={(event) => { setAction(event.target.value); setCursors([null]); }}><option value="">Todos</option><option value="record.insert">Altas</option><option value="record.update">Cambios</option><option value="record.delete">Bajas</option></select></label>
    </div>
    {history.isPending ? <TableSkeleton columns={5} /> : history.isError ? <Notice tone="error" title="No se pudo cargar la bitácora" action={<button className="ghost" onClick={() => void history.refetch()}>Reintentar</button>}>Intenta nuevamente para consultar la actividad.</Notice> : !history.data?.data.length ? <Notice title="Sin actividad que coincida">No hay registros con los filtros seleccionados.</Notice> : <div className="card scroll-x"><table>
      <thead><tr><th>Fecha</th><th>Usuario</th><th>Módulo</th><th>Acción</th><th>Detalle</th></tr></thead>
      <tbody>{history.data.data.map((event) => {
        const snapshot = event.metadata.after ?? event.metadata.before;
        const name = snapshot?.folio ?? snapshot?.name ?? snapshot?.legal_name ?? snapshot?.description;
        return <tr key={event.id}>
          <td style={{ whiteSpace: "nowrap" }}>{new Date(event.createdAt).toLocaleString("es-MX")}</td>
          <td>{event.actorEmail ?? event.actorUserId ?? "Sistema / autor no registrado"}{event.actorRole ? <div className="costing-hint">{roleLabel(event.actorRole)}</div> : null}{event.impersonator ? <div className="costing-hint">Sesión de soporte</div> : null}</td>
          <td>{ENTITIES[event.entityType] ?? ENTITY_ALIASES[event.entityType] ?? event.entityType}</td><td>{actionLabel(event.action)}</td>
          <td>{name ? <strong>{valueText(name)}</strong> : null}<details><summary>Ver detalle</summary>
            <p className="costing-hint">Registro: {event.entityId ?? "—"}<br />Evento: {event.id}<br />Operación: {event.metadata.transactionId ?? "No registrada"}</p>
            {event.metadata.changedFields?.length ? <dl>{event.metadata.changedFields.filter((key) => !["id", "tenant_id", "created_at", "updated_at"].includes(key)).map((key) => <div key={key}><dt>{FIELDS[key] ?? key.replaceAll("_", " ")}</dt><dd style={{ overflowWrap: "anywhere" }}>{valueText(event.metadata.before?.[key])} → {valueText(event.metadata.after?.[key])}</dd></div>)}</dl> : <dl>{Object.entries(event.metadata).filter(([key]) => !["actorEmail", "actorRole", "impersonator", "transactionId", "origin", "source", "before", "after", "changedFields"].includes(key)).map(([key, value]) => <div key={key}><dt>{FIELDS[key] ?? key.replaceAll("_", " ")}</dt><dd style={{ overflowWrap: "anywhere" }}>{valueText(value)}</dd></div>)}</dl>}
          </details></td>
        </tr>;
      })}</tbody></table></div>}
    <Pagination label="Paginación de la bitácora" size={size}
      from={history.data?.data.length ? (cursors.length - 1) * size + 1 : 0}
      to={history.data?.data.length ? (cursors.length - 1) * size + history.data.data.length : 0}
      total={history.data?.total ?? 0} hasPrevious={cursors.length > 1} hasNext={Boolean(history.data?.next)} busy={history.isFetching}
      onSizeChange={(next) => { setSize(next); setCursors([null]); }}
      onPrevious={() => setCursors((previous) => previous.slice(0, -1))}
      onNext={() => { const next = history.data?.next; if (next) setCursors((previous) => [...previous, next]); }} />
  </section>;
}
