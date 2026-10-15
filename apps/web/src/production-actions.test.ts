import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, postJson } from "./api";
import { finishProduction } from "./production-actions";

vi.mock("./api", () => ({ api: vi.fn(), postJson: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe("terminar producción usando las respuestas del servidor", () => {
  it("fabrica e inspecciona sin GET intermedios y usa la cantidad realmente terminada", async () => {
    vi.mocked(postJson).mockResolvedValueOnce({ status: "released" })
      .mockResolvedValueOnce({ status: "qc_hold", quantityCompleted: "3" })
      .mockResolvedValueOnce({ status: "completed", quantityCompleted: "3" })
      .mockResolvedValueOnce({ status: "closed", quantityCompleted: "3" });
    const result = await finishProduction("op", "draft", "3");
    expect(api).not.toHaveBeenCalled();
    expect(postJson).toHaveBeenNthCalledWith(3, "/production-orders/op/inspections", { result: "pass", qtyPassed: "3", qtyFailed: "0" });
    expect(result.status).toBe("closed");
    expect(postJson).toHaveBeenCalledTimes(4);
  });
  it("sin calidad cierra directamente y no registra una inspección", async () => {
    vi.mocked(postJson).mockResolvedValueOnce({ status: "completed", quantityCompleted: "2" })
      .mockResolvedValueOnce({ status: "closed", quantityCompleted: "2" });
    await finishProduction("op", "released", "2");
    expect(api).not.toHaveBeenCalled();
    expect(postJson).toHaveBeenCalledTimes(2);
    expect(postJson).toHaveBeenLastCalledWith("/production-orders/op/close", {});
  });
  it("al retomar calidad consulta el estado actual y no repite la fabricación", async () => {
    vi.mocked(api).mockResolvedValueOnce({ status: "qc_hold", quantityCompleted: "1" });
    vi.mocked(postJson).mockResolvedValueOnce({ status: "completed", quantityCompleted: "1" })
      .mockResolvedValueOnce({ status: "closed", quantityCompleted: "1" });
    await finishProduction("op", "qc_hold", "5");
    expect(api).toHaveBeenCalledTimes(1);
    expect(postJson).toHaveBeenNthCalledWith(1, "/production-orders/op/inspections", { result: "pass", qtyPassed: "1", qtyFailed: "0" });
  });
  it("si falla una etapa no continúa ni cierra la orden", async () => {
    vi.mocked(postJson).mockResolvedValueOnce({ status: "released" }).mockRejectedValueOnce(new Error("Sin inventario"));
    await expect(finishProduction("op", "draft", "2")).rejects.toThrow("Sin inventario");
    expect(postJson).toHaveBeenCalledTimes(2);
    expect(api).not.toHaveBeenCalled();
  });
});
