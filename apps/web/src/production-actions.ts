import { api, postJson } from "./api";

interface ProductionSnapshot {
  status: string;
  quantityCompleted: string;
}

/** Las mutaciones devuelven el detalle vigente; no hace falta leerlo otra vez entre pasos. */
export async function finishProduction<T extends ProductionSnapshot>(id: string, status: string, quantity: string): Promise<T> {
  let detail: T | undefined;
  if (status === "draft") detail = await postJson<T>(`/production-orders/${id}/release`, {});
  if (status === "on_hold") detail = await postJson<T>(`/production-orders/${id}/transition`, { to: "in_progress" });
  if (!["qc_hold", "completed", "closed"].includes(status)) {
    detail = await postJson<T>(`/production-orders/${id}/complete`, { quantityGood: quantity, quantityScrapped: "0" });
  }
  detail ??= await api<T>(`/production-orders/${id}`);
  if (detail.status === "qc_hold") {
    detail = await postJson<T>(`/production-orders/${id}/inspections`, { result: "pass", qtyPassed: detail.quantityCompleted, qtyFailed: "0" });
  }
  if (detail.status === "completed") detail = await postJson<T>(`/production-orders/${id}/close`, {});
  return detail;
}
