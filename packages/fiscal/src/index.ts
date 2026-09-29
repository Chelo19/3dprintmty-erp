import { AppError } from "@3dprintmty/shared";
import { mxCountryPolicy } from "./mx-policy";
import { usCountryPolicy } from "./us-policy";
import type { CountryPolicy } from "./types";

export function countryPolicy(countryCode: string): CountryPolicy {
  if (countryCode === "MX") return mxCountryPolicy;
  if (countryCode === "US") return usCountryPolicy;
  throw new AppError("country_not_enabled", "Ese país todavía no tiene política fiscal.");
}

export { PREFACTURA_TITLE, mxCountryPolicy } from "./mx-policy";
export { usCountryPolicy } from "./us-policy";
export { calculateMxTax } from "./tax";
export type {
  AccountantPackage,
  CommercialDraft,
  CountryPolicy,
  IssuedDocument,
  TaxBreakdown,
  TaxLineInput,
  ValidationResult,
} from "./types";
