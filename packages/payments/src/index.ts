import { Money } from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";

export const PAYMENT_METHODS = [
  "efectivo",
  "spei",
  "tarjeta",
  "mercadopago",
  "conekta",
  "stripe",
  "cod",
  "credito",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface LedgerEntry {
  status: "pending" | "completed" | "failed" | "voided";
  kind: "payment" | "refund";
  amount: Money;
}

export function amountDue(total: Money, entries: LedgerEntry[]): Money {
  return entries.reduce((due, entry) => {
    if (entry.status !== "completed") return due;
    if (entry.amount.currency !== total.currency) {
      throw new AppError("currency_mismatch", "El pago usa otra moneda.");
    }
    if (entry.kind === "refund") return due.add(entry.amount);
    return due.sub(entry.amount);
  }, total);
}

export function resolveSatPaymentTiming(
  intended: "PUE" | "PPD",
  total: Money,
  entries: LedgerEntry[],
): "PUE" | "PPD" {
  const completed = entries.filter(
    (entry) => entry.status === "completed" && entry.kind === "payment",
  );
  if (intended === "PUE" && completed.length > 1) return "PPD";
  if (intended === "PUE" && completed.length === 1 && amountDue(total, entries).minor > 0n) {
    return "PPD";
  }
  return intended;
}

export interface TenantPaymentCredentials {
  tenantId: string;
  provider: "mercadopago" | "stripe" | "conekta";
  secret: string;
}

export interface CheckoutRequest {
  tenantId: string;
  amount: Money;
  description: string;
  credentials: TenantPaymentCredentials | null;
}

export interface PaymentPort {
  provider: string;
  recordManual?(input: {
    method: "efectivo" | "spei" | "cod";
    amount: Money;
    reference?: string;
  }): { status: "completed" | "pending"; method: string; amount: string };
  createCheckout?(input: CheckoutRequest): Promise<{ provider: string; status: "pending" }>;
}

export const manualPaymentPort: PaymentPort = {
  provider: "manual",
  recordManual(input) {
    if (input.amount.minor <= 0n) {
      throw new AppError("invalid_money", "El cobro debe ser mayor a cero.");
    }
    return {
      status: input.method === "cod" ? "pending" : "completed",
      method: input.method,
      amount: input.amount.toMajor(),
    };
  },
};

function assertTenantSecret(input: CheckoutRequest, provider: TenantPaymentCredentials["provider"]) {
  if (!input.credentials || input.credentials.provider !== provider || !input.credentials.secret) {
    throw new AppError(
      "tenant_payment_key_missing",
      "Este taller no tiene configurada su propia llave de cobro.",
      422,
    );
  }
  if (input.credentials.tenantId !== input.tenantId) {
    throw new AppError(
      "tenant_mismatch",
      "La llave de cobro no pertenece a este taller.",
      403,
    );
  }
}

export const mercadoPagoPort: PaymentPort = {
  provider: "mercadopago",
  async createCheckout(input) {
    assertTenantSecret(input, "mercadopago");
    return { provider: "mercadopago", status: "pending" };
  },
};

export const stripePort: PaymentPort = {
  provider: "stripe",
  async createCheckout(input) {
    assertTenantSecret(input, "stripe");
    return { provider: "stripe", status: "pending" };
  },
};

export const conektaPort: PaymentPort = {
  provider: "conekta",
  async createCheckout(input) {
    assertTenantSecret(input, "conekta");
    return { provider: "conekta", status: "pending" };
  },
};
