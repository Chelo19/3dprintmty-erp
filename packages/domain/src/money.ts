import { AppError } from "@3dprintmty/shared";

const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: string,
  ) {}

  static fromMajor(input: string, currency = "MXN"): Money {
    const trimmed = input.trim();
    if (!MONEY_PATTERN.test(trimmed)) {
      throw new AppError(
        "invalid_money",
        "El importe debe tener como máximo dos decimales.",
      );
    }
    const negative = trimmed.startsWith("-");
    const unsigned = negative ? trimmed.slice(1) : trimmed;
    const [whole, frac = ""] = unsigned.split(".");
    const padded = `${frac}00`.slice(0, 2);
    const minor =
      BigInt(whole ?? "0") * 100n + BigInt(padded);
    return new Money(negative ? -minor : minor, currency);
  }

  static fromMinor(minor: bigint, currency = "MXN"): Money {
    return new Money(minor, currency);
  }

  static zero(currency = "MXN"): Money {
    return new Money(0n, currency);
  }

  assertSame(other: Money): void {
    if (this.currency !== other.currency) {
      throw new AppError(
        "currency_mismatch",
        "No se pueden mezclar monedas en el mismo documento.",
      );
    }
  }

  add(other: Money): Money {
    this.assertSame(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  sub(other: Money): Money {
    this.assertSame(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  timesQuantity(quantity: string): Money {
    if (!/^\d+(\.\d{1,6})?$/.test(quantity)) {
      throw new AppError("invalid_quantity", "La cantidad no es válida.");
    }
    const [whole, frac = ""] = quantity.split(".");
    const scale = 10n ** BigInt(frac.length);
    const qty = BigInt(whole ?? "0") * scale + BigInt(frac || "0");
    const product = this.minor * qty;
    const half = scale / 2n;
    const abs = product < 0n ? -product : product;
    const rounded = (abs + half) / scale;
    const signed = product < 0n ? -rounded : rounded;
    return new Money(signed, this.currency);
  }

  toMajor(): string {
    const negative = this.minor < 0n;
    const abs = negative ? -this.minor : this.minor;
    const whole = abs / 100n;
    const frac = (abs % 100n).toString().padStart(2, "0");
    return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
  }

  format(locale = "es-MX"): string {
    const [whole, frac] = this.toMajor().split(".");
    const amount = Number(`${whole}.${frac}`);
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: this.currency,
    }).format(amount);
  }
}
