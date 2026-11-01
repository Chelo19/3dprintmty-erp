import { describe, expect, it } from "vitest";
import { canAccessPath, TENANT_ROLES } from "@3dprintmty/domain";
import { HELP_TOPICS, helpTopic, pageHelpTopic, searchHelpTopics, visibleHelpTopics } from "./help-content";

describe("guía de uso y ayudas contextuales", () => {
  it("todos los roles pueden consultar la guía sin abrir rutas administrativas ni rutas desconocidas", () => {
    for (const role of TENANT_ROLES) {
      expect(canAccessPath(role, "/app/ayuda")).toBe(true);
      expect(canAccessPath(role, "/app/ayuda/")).toBe(true);
      expect(canAccessPath(role, "/app/ayuda/administracion")).toBe(false);
    }
    expect(canAccessPath(null, "/app/ayuda")).toBe(false);
    expect(canAccessPath("operator", "/app/configuracion")).toBe(false);
    expect(canAccessPath("production", "/app/compras")).toBe(false);
    expect(canAccessPath("viewer", "/app/equipo")).toBe(false);
  });
  it("solo ofrece temas y accesos autorizados para el rol", () => {
    for (const role of TENANT_ROLES) {
      for (const topic of visibleHelpTopics(role)) {
        if (topic.path) expect(canAccessPath(role, topic.path)).toBe(true);
      }
    }
    expect(visibleHelpTopics(null)).toEqual([]);
    const operator = visibleHelpTopics("operator").map(topic => topic.id);
    expect(operator).toContain("produccion");
    expect(operator).toContain("ajuste-filamento");
    expect(operator).not.toContain("compras");
    expect(operator).not.toContain("calculadora");
    expect(operator).not.toContain("configuracion");
  });
  it("encuentra tareas por varias palabras aunque se omitan acentos", () => {
    expect(searchHelpTopics(HELP_TOPICS, "RETENCION isr").map(topic => topic.id)).toContain("impuestos-descuentos");
    expect(searchHelpTopics(HELP_TOPICS, "cancelar gasto").map(topic => topic.id)).toContain("cancelar-gasto");
    expect(searchHelpTopics(HELP_TOPICS, "kg gramos").map(topic => topic.id)).toContain("filamentos");
    expect(searchHelpTopics(HELP_TOPICS, "tema inexistente 99999")).toEqual([]);
    expect(searchHelpTopics(HELP_TOPICS, " ")).toHaveLength(HELP_TOPICS.length);
  });
  it("resuelve ayudas de listas, formularios y detalles sin confundir los prefijos", () => {
    for (const [path,id] of [["/app/cotizaciones/nueva","cotizaciones"],["/app/cotizaciones/123/editar","cotizaciones"],["/app/compras/gastos/123","compras"],["/app/productos/reventa","reventa"],["/app/productos/fabricados","fabricados"],["/app/inventario/filamentos/123/ajustar","inventario"],["/app/produccion/123","produccion"],["/app/punto-de-venta/ticket/123","punto-venta"]]) {
      expect(pageHelpTopic(path!)?.id).toBe(id);
    }
    expect(pageHelpTopic("/app")).toEqual(helpTopic("dashboard"));
    expect(pageHelpTopic("/app/ayuda")).toBeUndefined();
    expect(pageHelpTopic("/app/plataforma")).toBeUndefined();
    expect(pageHelpTopic("/app/clientes-extra")).toBeUndefined();
  });
  it("todos los enlaces entre temas existen y ningún tema enlaza a módulos desactivados", () => {
    const ids = HELP_TOPICS.map(topic => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const topic of HELP_TOPICS) {
      expect(topic.steps.length).toBeGreaterThan(0);
      for (const id of topic.related ?? []) expect(() => helpTopic(id)).not.toThrow();
      if (topic.path) expect(canAccessPath("owner", topic.path)).toBe(true);
      expect(topic.path ?? "").not.toMatch(/prefacturas|bitacora|purchase-orders/);
    }
  });
});
