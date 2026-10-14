import { describe, expect, it, vi } from "vitest";
import { closeSession } from "./session";

describe("closeSession", () => {
  it("limpia las credenciales locales sin borrar otras preferencias", async () => {
    const storage = { removeItem: vi.fn() };
    await closeSession(undefined, storage);
    expect(storage.removeItem.mock.calls).toEqual([["printmty.token"], ["printmty.user"]]);
  });

  it("cierra únicamente la sesión actual y espera antes de limpiar", async () => {
    let finish!: (value: { error: null }) => void;
    const auth = { signOut: vi.fn(() => new Promise<{ error: null }>((resolve) => { finish = resolve; })) };
    const storage = { removeItem: vi.fn() };
    const pending = closeSession(auth, storage);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(storage.removeItem).not.toHaveBeenCalled();
    finish({ error: null });
    await pending;
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
  });

  it("conserva la sesión para permitir reintentar si Supabase rechaza la salida", async () => {
    const error = new Error("Sin conexión");
    const storage = { removeItem: vi.fn() };
    await expect(closeSession({ signOut: vi.fn().mockResolvedValue({ error }) }, storage)).rejects.toBe(error);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("propaga fallos de red sin anunciar una salida exitosa", async () => {
    const storage = { removeItem: vi.fn() };
    await expect(closeSession({ signOut: vi.fn().mockRejectedValue(new Error("Network")) }, storage)).rejects.toThrow("Network");
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
