import { assertPostalCode, assertRfc, GENERIC_RFC, isValidRfc } from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import { calculateMxTax } from "./tax";
import type {
  AccountantPackage,
  CommercialDraft,
  CountryPolicy,
  IssuedDocument,
  ValidationResult,
} from "./types";

export const PREFACTURA_TITLE = "Prefactura / Nota de venta — no es un CFDI";

const SAT_PAYMENT_FORMS = new Set(["01", "03", "04", "99"]);

function validate(draft: CommercialDraft): ValidationResult {
  const errors: ValidationResult["errors"] = [];
  const warnings: ValidationResult["warnings"] = [];
  try {
    assertRfc(draft.emitter.rfc);
    assertPostalCode(draft.emitter.postalCode);
  } catch (error) {
    errors.push({
      code: error instanceof AppError ? error.code : "invalid_emitter",
      message: error instanceof Error ? error.message : "El emisor no es válido.",
    });
  }
  if (!draft.emitter.legalName.trim() || !draft.emitter.taxRegime) {
    errors.push({
      code: "incomplete_emitter",
      message: "La empresa necesita razón social y régimen fiscal.",
    });
  }
  if (!isValidRfc(draft.receiver.rfc)) {
    warnings.push({
      code: "receiver_rfc_incomplete",
      message: "El receptor no tiene un RFC válido. Se marcará como público en general.",
    });
  }
  if (!SAT_PAYMENT_FORMS.has(draft.satPaymentForm)) {
    errors.push({
      code: "invalid_payment_form",
      message: "La forma de pago no está en el catálogo usado por el MVP.",
    });
  }
  if (draft.lines.length === 0) {
    errors.push({ code: "empty_lines", message: "Agrega al menos una línea." });
  }
  return { ok: errors.length === 0, errors, warnings };
}

function issue(draft: CommercialDraft): IssuedDocument {
  const validation = validate(draft);
  if (!validation.ok) {
    throw new AppError(
      "prefactura_invalid",
      validation.errors[0]?.message ?? "La prefactura no se puede emitir.",
      422,
      validation.errors,
    );
  }
  const incomplete = validation.warnings.length > 0;
  const receiver = incomplete
    ? {
        ...draft.receiver,
        kind: "publico_general" as const,
        rfc: GENERIC_RFC.domestic,
        legalName: draft.receiver.legalName.trim() || "Público en general",
      }
    : draft.receiver;
  return {
    kind: "prefactura",
    title: PREFACTURA_TITLE,
    series: draft.series,
    incomplete,
    warnings: validation.warnings,
    emitter: {
      ...draft.emitter,
      rfc: assertRfc(draft.emitter.rfc),
      postalCode: assertPostalCode(draft.emitter.postalCode),
    },
    receiver,
    tax: calculateMxTax({
      lines: draft.lines,
      globalDiscount: draft.globalDiscount,
      rate: draft.taxRate,
    }),
    intendedPayment: draft.intendedPayment,
    satPaymentForm: draft.satPaymentForm,
  };
}

export const mxCountryPolicy: CountryPolicy = {
  countryCode: "MX",
  currency: "MXN",
  taxEngine: { calculate: calculateMxTax },
  invoiceEngine: {
    validate,
    issue,
    exportPackage(ids: string[]): AccountantPackage {
      return {
        version: "accountant_package_v1",
        countryCode: "MX",
        note: `Paquete para el contador (${ids.length} documentos). El ZIP se arma en la fase de cobranza.`,
      };
    },
  },
};
