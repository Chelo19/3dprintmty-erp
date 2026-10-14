import { describe, expect, it } from "vitest";
import { canAccessPath, TENANT_ROLES } from "@3dprintmty/domain";
import { canWritePath } from "./roles";

describe("rutas de escritura", () => {
  it("prefacturas desactivadas para todos los roles, también por URL directa", () => {
    for (const role of TENANT_ROLES) {
      expect(canAccessPath(role, "/app/prefacturas")).toBe(false);
      expect(canAccessPath(role, "/app/prefacturas/123")).toBe(false);
      expect(canWritePath(role, "/app/prefacturas")).toBe(false);
    }
  });
  it("operador crea, pero no edita", () => {
    for (const section of ["clientes", "pedidos", "cobranza"]) {
      expect(canWritePath("operator", `/app/${section}/nuevo`)).toBe(true);
      expect(canWritePath("operator", `/app/${section}/123/editar`)).toBe(false);
    }
    expect(canWritePath("operator", "/app/cotizaciones/nueva")).toBe(true);
    expect(canWritePath("operator", "/app/productos/nuevo")).toBe(false);
    expect(canWritePath("operator", "/app/inventario/filamentos/123/ajustar")).toBe(true);
    expect(canWritePath("operator", "/app/produccion")).toBe(true);
    expect(canWritePath("operator", "/app/prefacturas")).toBe(false);
    expect(canWritePath("operator", "/app/recetas")).toBe(false);
  });
  it("consulta no puede abrir formularios de ningún módulo", () => {
    for (const path of ["productos", "clientes", "inventario", "compras", "prefacturas", "produccion", "recetas", "sucursales"]) {
      expect(canWritePath("viewer", `/app/${path}/nuevo`)).toBe(false);
    }
  });
  it("autoriza únicamente formularios del área del usuario", () => {
    expect(canWritePath("warehouse", "/app/inventario/filamentos/123/ajustar")).toBe(true);
    expect(canWritePath("sales", "/app/inventario/filamentos/123/ajustar")).toBe(false);
    expect(canWritePath("sales", "/app/clientes/nuevo")).toBe(true);
    expect(canWritePath("production", "/app/clientes/nuevo")).toBe(false);
    expect(canWritePath("production", "/app/recetas/nuevo")).toBe(true);
    expect(canWritePath("owner", "/app/desconocido/nuevo")).toBe(false);
  });
});
