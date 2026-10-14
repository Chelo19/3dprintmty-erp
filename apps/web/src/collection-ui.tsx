export const COLLECTION_METHODS: Record<string, string> = {
  efectivo: "Efectivo", spei: "SPEI", tarjeta: "Tarjeta", cod: "Contra entrega",
  credito: "Crédito", mercadopago: "Mercado Pago", conekta: "Conekta", stripe: "Stripe",
};
export const COLLECTION_STATES: Record<string, string> = {
  pending: "Pendiente", completed: "Completado", failed: "Fallido", voided: "Anulado",
};
export function collectionMethodLabel(method: string) { return COLLECTION_METHODS[method] ?? method; }
export function collectionDateLabel(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-MX", { timeZone: "America/Monterrey", dateStyle: "short", timeStyle: "short" });
}
export function CollectionStatusBadge({ status }: { status: string }) {
  return <span className={`res res-badge collection-status-${status}`}>{COLLECTION_STATES[status] ?? status}</span>;
}
