export interface TaxLineInput {
  description: string;
  quantity: string;
  unitPrice: string;
  discount?: string;
  taxable?: boolean;
  vatRate?: string;
  vatExempt?: boolean;
  isrRate?: string;
}

export interface TaxLineResult {
  vatExempt: boolean;
  isrRate: string;
  isrWithheld: string;
  description: string;
  net: string;
  tax: string;
  /** Gross line amount including VAT; deduct isrWithheld for the amount payable. */
  total: string;
  rate: string;
}

export interface TaxBreakdown {
  currency: "MXN";
  subtotal: string;
  discount: string;
  taxableBase: string;
  tax: string;
  isrWithheld: string;
  isrRate: string;
  total: string;
  rate: string;
  lines: TaxLineResult[];
}

export interface Party {
  legalName: string;
  rfc: string;
  taxRegime?: string;
  postalCode: string;
  cfdiUse?: string;
}

export interface CommercialDraft {
  emitter: Party;
  receiver: Party & { kind: "persona_fisica" | "persona_moral" | "publico_general" };
  lines: TaxLineInput[];
  globalDiscount?: string;
  taxRate: string;
  isrRate?: string;
  intendedPayment: "PUE" | "PPD";
  satPaymentForm: string;
  series: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
}

export interface IssuedDocument {
  kind: "prefactura";
  title: string;
  series: string;
  incomplete: boolean;
  warnings: { code: string; message: string }[];
  emitter: Party;
  receiver: CommercialDraft["receiver"];
  tax: TaxBreakdown;
  intendedPayment: "PUE" | "PPD";
  satPaymentForm: string;
}

export interface AccountantPackage {
  version: "accountant_package_v1";
  countryCode: "MX";
  note: string;
}

export interface CountryPolicy {
  countryCode: string;
  currency: string;
  taxEngine: {
    calculate(input: {
      lines: TaxLineInput[];
      globalDiscount?: string;
      rate: string;
      isrRate?: string;
    }): TaxBreakdown;
  };
  invoiceEngine: {
    validate(draft: CommercialDraft): ValidationResult;
    issue(draft: CommercialDraft): IssuedDocument;
    exportPackage(ids: string[]): AccountantPackage;
  };
}
