import { describe, expect, it, vi } from "vitest";
import { createRecordActions } from "./record-actions";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("acciones independientes por registro", () => {
  it("inicia varias órdenes sin esperar a que termine la primera", async () => {
    const actions = createRecordActions();
    const first = deferred();
    const second = deferred();
    const startFirst = vi.fn(() => first.promise);
    const startSecond = vi.fn(() => second.promise);
    const a = actions.run("op-1", "finish", startFirst);
    const b = actions.run("op-2", "finish", startSecond);
    expect(startFirst).toHaveBeenCalledTimes(1);
    expect(startSecond).toHaveBeenCalledTimes(1);
    expect(actions.getSnapshot()["op-1"]?.pending).toBe(true);
    expect(actions.getSnapshot()["op-2"]?.pending).toBe(true);
    second.resolve();
    expect(await b).toBe(true);
    expect(actions.getSnapshot()["op-1"]?.pending).toBe(true);
    first.resolve();
    expect(await a).toBe(true);
    expect(actions.getSnapshot()).toEqual({});
  });

  it("bloquea doble clic y cancelar la misma orden mientras se termina", async () => {
    const actions = createRecordActions();
    const pending = deferred();
    const a = actions.run("op-1", "finish", () => pending.promise);
    const duplicate = vi.fn(async () => {});
    expect(await actions.run("op-1", "finish", duplicate)).toBe(false);
    expect(await actions.run("op-1", "cancel", duplicate)).toBe(false);
    expect(duplicate).not.toHaveBeenCalled();
    pending.resolve();
    await a;
  });

  it("conserva el error de una orden sin desbloquear ni interrumpir otra, y permite reintentar", async () => {
    const actions = createRecordActions();
    const first = deferred();
    const second = deferred();
    const a = actions.run("op-1", "finish", () => first.promise);
    const b = actions.run("op-2", "cancel", () => second.promise);
    first.reject(new Error("Sin inventario"));
    expect(await a).toBe(false);
    expect(actions.getSnapshot()["op-1"]).toMatchObject({ pending: false, error: "Sin inventario" });
    expect(actions.getSnapshot()["op-2"]).toMatchObject({ pending: true, action: "cancel" });
    expect(await actions.run("op-1", "finish", async () => {})).toBe(true);
    expect(actions.getSnapshot()["op-1"]).toBeUndefined();
    second.resolve();
    await b;
  });
});
