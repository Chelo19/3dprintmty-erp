import { afterEach, expect, it, vi } from "vitest";
import { collectionDateLabel, paymentToday } from "./collection-ui";
afterEach(() => vi.useRealTimers());
it("muestra la fecha civil del pago sin desplazarla al día anterior", () => {
  expect(collectionDateLabel("2026-10-27")).toBe("27/10/26");
  expect(collectionDateLabel(undefined)).toBe("—");
  expect(collectionDateLabel(null)).toBe("—");
});
it("el día predeterminado corresponde a México al cruzar medianoche UTC", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T02:00:00Z"));
  expect(paymentToday()).toBe("2026-10-27");
});
