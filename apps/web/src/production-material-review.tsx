import { useQuery } from "@tanstack/react-query";
import { postJson } from "./api";
import { Modal } from "./modal";
import { Notice } from "./notice";
import { CostOnly } from "./margin";
import { money } from "./operations";
import { uomShort } from "@3dprintmty/domain";
import { Paged } from "./pager";
import { TableSkeleton } from "./skeleton";

interface MaterialReview {
  orders: Array<{ id: string; folio: string; name: string; quantity: string }>;
  totalPieces: string;
  lines: Array<{ kind: string; id: string; code: string; name: string; unit: string; quantity: string; unitCost: string | null; totalCost: string | null }>;
  materialCost: string | null; serviceCost: string | null; totalCost: string | null; missingCosts: boolean;
}
const kinds: Record<string,string> = { filament: "Filamento", supply: "Insumo", product: "Producto", service: "Servicio" };

export function ProductionMaterialReview({ orderIds, onClose }: { orderIds: string[]; onClose: () => void }) {
  const review = useQuery({ queryKey: ["production-material-review", [...orderIds].sort()],
    queryFn: () => postJson<MaterialReview>("/production-orders/material-review", { orderIds }), retry: false });
  const data = review.data;
  return <Modal title="Revisar gasto de material" onClose={onClose}>
    <p>Estimación para la cantidad completa de piezas seleccionadas, con recetas y costos de catálogo vigentes. Incluye la merma de las recetas. No descuenta lo ya consumido ni modifica el inventario o las órdenes.</p>
    {review.isPending ? <TableSkeleton columns={5} /> : review.isError ? <Notice tone="error" title="No se pudo calcular el desglose" action={<button type="button" className="ghost" onClick={() => void review.refetch()}>Reintentar</button>}>{review.error.message}</Notice> : data ? <>
      <p><strong>{data.orders.length} órdenes · {data.totalPieces} piezas</strong></p>
      <details><summary>Ver piezas seleccionadas</summary><ul>{data.orders.map(order => <li key={order.id}>{order.folio} · {order.name} · {order.quantity} piezas</li>)}</ul></details>
      {data.missingCosts ? <Notice title="Faltan costos en el catálogo">Las cantidades están completas. Los importes que dependen de costos sin configurar aparecen sin calcular.</Notice> : null}
      <Paged rows={data.lines}>{lines => <div className="scroll-x"><table>
        <thead><tr><th>Tipo</th><th>Material o servicio</th><th>Cantidad requerida</th><th>Unidad</th><CostOnly><th>Costo unitario</th><th>Importe</th></CostOnly></tr></thead>
        <tbody>{lines.map(line => <tr key={`${line.kind}:${line.id}`}><td>{kinds[line.kind]}</td><td>{line.code} · {line.name}</td><td>{line.quantity}</td><td>{uomShort(line.unit) || line.unit}</td><CostOnly><td>{line.unitCost === null ? "Sin costo" : `$${Number(line.unitCost).toLocaleString("es-MX", { maximumFractionDigits: 6 })}`}</td><td>{money(line.totalCost)}</td></CostOnly></tr>)}</tbody>
      </table></div>}</Paged>
      <CostOnly><div className="costing-kpis"><div><span>Materiales e insumos</span><strong>{money(data.materialCost)}</strong></div><div><span>Servicios</span><strong>{money(data.serviceCost)}</strong></div><div><span>Total estimado</span><strong>{money(data.totalCost)}</strong></div></div></CostOnly>
    </> : null}
  </Modal>;
}
