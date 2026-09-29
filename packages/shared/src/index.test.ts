import { describe, expect, it } from "vitest";
import { AppError, err, ok } from "./index";

describe("Result", () => {
  it("envuelve éxito y error", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    const error = new AppError("nope", "No se pudo", 422);
    expect(err(error).ok).toBe(false);
  });
});
