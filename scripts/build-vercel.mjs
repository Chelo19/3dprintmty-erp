import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vercelConfig } from "./vercel-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../.vercel/output/", import.meta.url);
const config = vercelConfig(process.env.API_ORIGIN);
// No conservar una salida anterior si la nueva compilación falla.
rmSync(output, { recursive: true, force: true });
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "-w", "@3dprintmty/web"], {
  cwd: root, stdio: "inherit",
});
mkdirSync(output, { recursive: true });
cpSync(new URL("../apps/web/dist/", import.meta.url), new URL("static/", output), { recursive: true });
writeFileSync(new URL("config.json", output), `${JSON.stringify(config, null, 2)}\n`);
console.log("Salida de Vercel preparada: frontend estático, proxy /api y rutas de React.");
