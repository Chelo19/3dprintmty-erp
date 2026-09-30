import { useState } from "react";

/** Margen sobre el precio: (precio − costo) / precio. En filamento el costo está por kg y el precio por gramo. */
export function marginPercent(cost: string | null | undefined, price: string | null | undefined, costDivisor = 1): number | null {
  const costAmount = Number(cost);
  const priceAmount = Number(price);
  if (!cost || !price || !Number.isFinite(costAmount) || !Number.isFinite(priceAmount) || priceAmount <= 0) return null;
  return ((priceAmount - costAmount / costDivisor) / priceAmount) * 100;
}

function marginLabel(percent: number | null): string {
  if (percent === null) return "—";
  return `${percent.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function marginColor(percent: number | null): string | undefined {
  if (percent === null || percent === 0) return undefined;
  return percent > 0 ? "var(--color-pine)" : "var(--color-danger)";
}

export function MarginValue({ cost, price, divisor = 1 }: { cost: string | null | undefined; price: string | null | undefined; divisor?: number }) {
  const percent = marginPercent(cost, price, divisor);
  return <span style={{ color: marginColor(percent), fontWeight: percent === null ? undefined : 600 }}>{marginLabel(percent)}</span>;
}

export function CostPriceFields({
  costLabel,
  priceLabel,
  costPlaceholder,
  pricePlaceholder,
  initialCost = "",
  initialPrice = "",
  costRequired = false,
  priceRequired = false,
  divisor = 1,
}: {
  costLabel: string;
  priceLabel: string;
  costPlaceholder?: string;
  pricePlaceholder?: string;
  initialCost?: string;
  initialPrice?: string;
  costRequired?: boolean;
  priceRequired?: boolean;
  divisor?: number;
}) {
  const [cost, setCost] = useState(initialCost);
  const [price, setPrice] = useState(initialPrice);
  const percent = marginPercent(cost, price, divisor);
  return (
    <>
      <label>
        {costLabel}
        <input name="cost" required={costRequired} placeholder={costPlaceholder} value={cost} onChange={(event) => setCost(event.target.value)} />
      </label>
      <label>
        {priceLabel}
        <input name="salePrice" required={priceRequired} placeholder={pricePlaceholder} value={price} onChange={(event) => setPrice(event.target.value)} />
      </label>
      <label>
        Margen de utilidad
        <input value={marginLabel(percent)} readOnly style={{ color: marginColor(percent), fontWeight: 600 }} />
      </label>
    </>
  );
}
