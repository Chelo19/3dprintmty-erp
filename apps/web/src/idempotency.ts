import { useRef } from "react";

/** Una captura conserva su llave mientras se reintente el mismo contenido. */
export function createIdempotencyAttempt(newKey: () => string = () => crypto.randomUUID()) {
  let current: { body: string; key: string } | null = null;
  return {
    headers(payload: unknown): Record<string, string> {
      const body = JSON.stringify(payload);
      if (!current || current.body !== body) current = { body, key: newKey() };
      return { "Idempotency-Key": current.key };
    },
    complete() { current = null; },
  };
}

export function useIdempotencyAttempt() {
  const attempt = useRef<ReturnType<typeof createIdempotencyAttempt> | null>(null);
  if (!attempt.current) attempt.current = createIdempotencyAttempt();
  return attempt.current;
}
