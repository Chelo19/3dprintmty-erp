export const COLLECTION_METHODS: Record<string, string> = {
  efectivo: "Efectivo", spei: "SPEI", tarjeta: "Tarjeta", cod: "Contra entrega",
  credito: "Crédito", mercadopago: "Mercado Pago", conekta: "Conekta", stripe: "Stripe",
};
export const COLLECTION_STATES: Record<string, string> = {
  pending: "Pendiente", completed: "Completado", failed: "Fallido", voided: "Anulado",
};
export function collectionMethodLabel(method: string) { return COLLECTION_METHODS[method] ?? method; }
export function collectionDateLabel(value?: string | null): string {
  if (!value) return "—";
  const civilDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(civilDate ? `${value}T12:00:00-06:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return civilDate ? date.toLocaleDateString("es-MX", { timeZone: "America/Monterrey", dateStyle: "short" }) : date.toLocaleString("es-MX", { timeZone: "America/Monterrey", dateStyle: "short", timeStyle: "short" });
}
export function CollectionStatusBadge({ status }: { status: string }) {
  return <span className={`res res-badge collection-status-${status}`}>{COLLECTION_STATES[status] ?? status}</span>;
}

export const paymentToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
