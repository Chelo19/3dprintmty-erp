import { AppError } from "@3dprintmty/shared";

const RFC_PATTERN = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

export const GENERIC_RFC = {
  domestic: "XAXX010101000",
  foreign: "XEXX010101000",
} as const;

export function normalizeRfc(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidRfc(input: string): boolean {
  return RFC_PATTERN.test(normalizeRfc(input));
}

export function assertRfc(input: string): string {
  const rfc = normalizeRfc(input);
  if (!isValidRfc(rfc)) {
    throw new AppError(
      "invalid_rfc",
      "El RFC no tiene el formato esperado (12 o 13 caracteres).",
    );
  }
  return rfc;
}

export function assertPostalCode(input: string): string {
  const cp = input.trim();
  if (!/^\d{5}$/.test(cp)) {
    throw new AppError(
      "invalid_postal_code",
      "El código postal de México tiene 5 dígitos.",
    );
  }
  return cp;
}

export function normalizeMxPhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  const local = digits.startsWith("52") && digits.length === 12 ? digits.slice(2) : digits;
  if (!/^\d{10}$/.test(local)) {
    throw new AppError(
      "invalid_phone",
      "El teléfono debe tener 10 dígitos (México).",
    );
  }
  return `+52${local}`;
}

export const MX_STATES = [
  "Aguascalientes",
  "Baja California",
  "Baja California Sur",
  "Campeche",
  "Chiapas",
  "Chihuahua",
  "Ciudad de México",
  "Coahuila",
  "Colima",
  "Durango",
  "Estado de México",
  "Guanajuato",
  "Guerrero",
  "Hidalgo",
  "Jalisco",
  "Michoacán",
  "Morelos",
  "Nayarit",
  "Nuevo León",
  "Oaxaca",
  "Puebla",
  "Querétaro",
  "Quintana Roo",
  "San Luis Potosí",
  "Sinaloa",
  "Sonora",
  "Tabasco",
  "Tamaulipas",
  "Tlaxcala",
  "Veracruz",
  "Yucatán",
  "Zacatecas",
] as const;

export type MxState = (typeof MX_STATES)[number];

export function assertMxState(input: string): MxState {
  const found = MX_STATES.find((state) => state === input.trim());
  if (!found) {
    throw new AppError("invalid_state", "Elige un estado de México.");
  }
  return found;
}

export const MX_TAX_REGIMES = [
  { code: "601", label: "General de Ley Personas Morales" },
  { code: "603", label: "Personas Morales con Fines no Lucrativos" },
  { code: "605", label: "Sueldos y Salarios e Ingresos Asimilados a Salarios" },
  { code: "606", label: "Arrendamiento" },
  { code: "612", label: "Personas Físicas con Actividades Empresariales y Profesionales" },
  { code: "616", label: "Sin obligaciones fiscales" },
  { code: "626", label: "Régimen Simplificado de Confianza" },
] as const;

export function assertTaxRegime(code: string): string {
  const found = MX_TAX_REGIMES.find((item) => item.code === code);
  if (!found) {
    throw new AppError("invalid_tax_regime", "El régimen fiscal no está en el catálogo.");
  }
  return found.code;
}

export const FILAMENT_MATERIALS = ["PLA", "PETG", "ABS", "ASA", "TPU", "NYLON", "PC"] as const;
export const FILAMENT_DIAMETERS = ["1.75", "2.85"] as const;
