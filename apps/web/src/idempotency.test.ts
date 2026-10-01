import { describe, expect, it } from "vitest";
import { createIdempotencyAttempt } from "./idempotency";

describe("capturas idempotentes", () => {
  it("reutiliza la llave tras perder una respuesta y renueva al cambiar contenido", () => {
    let sequence = 0;
    const attempt = createIdempotencyAttempt(() => `attempt-${++sequence}`);
    const first = attempt.headers({ amount: "100.00" });
    expect(attempt.headers({ amount: "100.00" })).toEqual(first);
    expect(attempt.headers({ amount: "50.00" })).not.toEqual(first);
  });
  it("una captura terminada permite otra captura legítima del mismo importe", () => {
    let sequence = 0;
    const attempt = createIdempotencyAttempt(() => `attempt-${++sequence}`);
    const first = attempt.headers({ quantity: "1" });
    attempt.complete();
    expect(attempt.headers({ quantity: "1" })).not.toEqual(first);
  });
});
