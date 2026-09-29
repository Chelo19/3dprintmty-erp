import "reflect-metadata";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { startContainer, stopContainer } from "./container";
import type { DbOptions } from "./db/database.service";
import { AllExceptionsFilter } from "./http/errors";

function loadEnvFile(): void {
  if (process.env.VITEST) return;
  const candidates = [join(process.cwd(), ".env"), join(process.cwd(), "../../.env")];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return;
  process.loadEnvFile(file);
}

export async function createApp(options: DbOptions = {}) {
  loadEnvFile();
  await startContainer(options);
  const app = await NestFactory.create(AppModule, {
    logger: process.env.VITEST ? false : ["error", "warn", "log"],
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(","),
  });
  await app.init();
  const close = app.close.bind(app);
  app.close = async () => {
    await close();
    await stopContainer();
  };
  return app;
}

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API lista en http://localhost:${port}/api/v1`);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("main.ts") || entry.endsWith("main.js")) {
  bootstrap().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
