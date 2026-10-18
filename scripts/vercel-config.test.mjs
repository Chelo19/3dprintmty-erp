import assert from "node:assert/strict";
import { test } from "node:test";
import { vercelConfig } from "./vercel-config.mjs";

test("el proxy conserva el prefijo API y se evalúa antes del fallback de React", () => {
  const { routes } = vercelConfig("https://api.example.test/");
  const match = (path) => routes.find((route) => route.src && new RegExp(route.src).test(path));
  for (const path of ["/api/v1/orders/id/confirm", "/api/v1/quotes/id/pdf", "/api/v1/auth/me"]) {
    const route = match(path);
    assert.equal(path.replace(new RegExp(route.src), route.dest), `https://api.example.test${path}`);
    assert.equal(route.headers["Cache-Control"], "private, no-store");
    assert.equal(route.methods, undefined); // Incluye POST/PATCH/DELETE además de GET.
  }
  assert.equal(match("/app/pedidos/id").dest, "/index.html");
  assert.equal(match("/auth/callback").dest, "/index.html");
});

test("requiere un origen HTTPS sin rutas ni secretos para evitar un proxy mal configurado", () => {
  for (const origin of [undefined, "", "no-url", "http://api.example.test", "https://user:password@api.example.test", "https://api.example.test/api/v1", "https://api.example.test?key=secret", "https://api.example.test/#fragment"]) {
    assert.throws(() => vercelConfig(origin));
  }
});
