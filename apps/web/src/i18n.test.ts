import { describe, expect, it } from "vitest";
import { en, esMX } from "./i18n";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, nested]) =>
    keys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

describe("i18n", () => {
  it("mantiene las mismas claves en es-MX y en", () => {
    expect(keys(en).sort()).toEqual(keys(esMX).sort());
  });
});
