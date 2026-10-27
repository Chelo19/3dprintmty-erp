import { z } from "zod";

/** Fecha civil del pago, independiente de la hora y fecha de captura. */
export const paymentDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !value.startsWith("0000-") && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "La fecha del pago no es válida.");
