import Decimal from "decimal.js";
import { Money } from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import type { TaxBreakdown, TaxLineInput, TaxLineResult } from "./types";

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

function lineNet(line: TaxLineInput): bigint {
  const gross = Money.fromMajor(line.unitPrice).timesQuantity(line.quantity);
  const discount = Money.fromMajor(line.discount ?? "0");
  if (discount.minor < 0n) {
    throw new AppError("invalid_discount", "El descuento no puede ser negativo.");
  }
  if (discount.minor > gross.minor) {
    throw new AppError("invalid_discount", "El descuento de la línea supera el importe.");
  }
  return gross.sub(discount).minor;
}

function allocate(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0n);
  if (total === 0n || sum === 0n) return weights.map(() => 0n);
  const raw = weights.map((weight) => ({
    share: (total * weight) / sum,
    remainder: (total * weight) % sum,
  }));
  let assigned = raw.reduce((acc, item) => acc + item.share, 0n);
  const order = raw
    .map((item, index) => ({ index, remainder: item.remainder }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  const shares = raw.map((item) => item.share);
  let cursor = 0;
  while (assigned < total) {
    const target = order[cursor % order.length];
    if (!target) break;
    shares[target.index] = (shares[target.index] ?? 0n) + 1n;
    assigned += 1n;
    cursor += 1;
  }
  return shares;
}

export function calculateMxTax(input: {
  lines: TaxLineInput[];
  globalDiscount?: string;
  rate: string;
}): TaxBreakdown {
  if (input.lines.length === 0) {
    throw new AppError("empty_lines", "Agrega al menos una línea.");
  }
  const rate = new Decimal(input.rate);
  if (rate.lt(0) || rate.gt(1)) {
    throw new AppError("invalid_tax_rate", "La tasa de impuesto no es válida.");
  }

  const nets = input.lines.map(lineNet);
  const taxableIndexes = input.lines
    .map((line, index) => ({ index, taxable: line.taxable !== false }))
    .filter((line) => line.taxable)
    .map((line) => line.index);
  const taxableWeights = taxableIndexes.map((index) => nets[index] ?? 0n);
  const taxableSum = taxableWeights.reduce((acc, value) => acc + value, 0n);
  const globalDiscount = Money.fromMajor(input.globalDiscount ?? "0").minor;
  if (globalDiscount < 0n) {
    throw new AppError("invalid_discount", "El descuento global no puede ser negativo.");
  }
  if (globalDiscount > taxableSum) {
    throw new AppError(
      "invalid_discount",
      "El descuento global supera la base gravable.",
    );
  }
  const allocated = allocate(globalDiscount, taxableWeights);
  const discountByIndex = new Map<number, bigint>();
  taxableIndexes.forEach((lineIndex, position) => {
    discountByIndex.set(lineIndex, allocated[position] ?? 0n);
  });

  const lines: TaxLineResult[] = input.lines.map((line, index) => {
    const net = (nets[index] ?? 0n) - (discountByIndex.get(index) ?? 0n);
    const taxable = line.taxable !== false;
    const tax = taxable
      ? Money.fromMajor(
          new Decimal(Money.fromMinor(net).toMajor())
            .mul(rate)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            .toFixed(2),
        ).minor
      : 0n;
    return {
      description: line.description,
      net: Money.fromMinor(net).toMajor(),
      tax: Money.fromMinor(tax).toMajor(),
      total: Money.fromMinor(net + tax).toMajor(),
      rate: taxable ? rate.toFixed(4) : "0.0000",
    };
  });

  const subtotal = nets.reduce((acc, value) => acc + value, 0n);
  const lineDiscount = input.lines.reduce(
    (acc, line) => acc + Money.fromMajor(line.discount ?? "0").minor,
    0n,
  );
  const tax = lines.reduce((acc, line) => acc + Money.fromMajor(line.tax).minor, 0n);
  const taxableBase = taxableSum - globalDiscount;
  const total = lines.reduce((acc, line) => acc + Money.fromMajor(line.total).minor, 0n);

  return {
    currency: "MXN",
    subtotal: Money.fromMinor(subtotal).toMajor(),
    discount: Money.fromMinor(lineDiscount + globalDiscount).toMajor(),
    taxableBase: Money.fromMinor(taxableBase).toMajor(),
    tax: Money.fromMinor(tax).toMajor(),
    total: Money.fromMinor(total).toMajor(),
    rate: rate.toFixed(4),
    lines,
  };
}
