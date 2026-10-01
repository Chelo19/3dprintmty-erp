import { describe, expect, it } from "vitest";
import { canAccessPath, roleHome, TENANT_ROLES } from "./roles";

describe("accesos a rutas", () => {
  it("protege detalles, rutas desconocidas y límites de prefijos", () => {
    expect(canAccessPath("sales", "/app/clientes/123/editar")).toBe(true);
    expect(canAccessPath("production", "/app/clientes/123")).toBe(false);
    expect(canAccessPath("warehouse", "/app/compras/123")).toBe(true);
    expect(canAccessPath("sales", "/app/compras/123")).toBe(false);
    expect(canAccessPath("viewer", "/app/equipo")).toBe(false);
    expect(canAccessPath("viewer", "/app/configuracion")).toBe(false);
    expect(canAccessPath("sales", "/app/clientes-extra")).toBe(false);
    expect(canAccessPath(null, "/app/productos")).toBe(false);
    expect(canAccessPath("owner", "/app/desconocido")).toBe(false);
  });
  it("elige una página inicial autorizada para cada rol", () => {
    for (const role of TENANT_ROLES) expect(canAccessPath(role, roleHome(role))).toBe(true);
  });
});
