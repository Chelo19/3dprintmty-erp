import { z } from "zod";
/** Fracción: 0.0125 equivale a 1.25 %. Hasta seis decimales, sin NaN ni infinitos. */
export const taxRateSchema = z.string().trim().regex(/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/, "La tasa debe estar entre 0 y 100 %.");
