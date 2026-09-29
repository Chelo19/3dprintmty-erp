import { AppError } from "@3dprintmty/shared";
import type { CountryPolicy } from "./types";

function unsupported(): never {
  throw new AppError(
    "country_not_enabled",
    "Estados Unidos queda como puerto. El país activo es México.",
    501,
  );
}

export const usCountryPolicy: CountryPolicy = {
  countryCode: "US",
  currency: "USD",
  taxEngine: { calculate: unsupported },
  invoiceEngine: {
    validate: unsupported,
    issue: unsupported,
    exportPackage: unsupported,
  },
};
