import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/main";

process.env.VITEST = "1";
delete process.env.DATABASE_URL;

describe("módulos temporalmente desactivados", () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => {
    app = await createApp({ dataDir: null });
    const signup = await request(app.getHttpServer()).post("/api/v1/auth/register")
      .send({ email: "disabled@features.test", password: "taller-seguro" });
    expect(signup.status).toBe(201);
    token = signup.body.token;
  });
  afterAll(async () => { await app?.close(); });
  it("bloquea listado, detalle, emisión y cancelación incluso con sesión válida", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    for (const path of ["/prefacturas", `/prefacturas/${id}`, "/PREFActuras"]) {
      const response = await request(app.getHttpServer()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("module_disabled");
    }
    for (const path of ["/prefacturas", `/prefacturas/${id}/void`]) {
      const response = await request(app.getHttpServer()).post(`/api/v1${path}`)
        .set("Authorization", `Bearer ${token}`).send({});
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("module_disabled");
    }
  });
  it("mantiene la autenticación del módulo desactivado", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/prefacturas");
    expect(response.status).toBe(401);
  });
});
