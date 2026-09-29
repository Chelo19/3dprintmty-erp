import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("../..", import.meta.url)), "");
  return {
    plugins: [react(), tailwindcss()],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.SUPABASE_URL ?? ""),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(env.SUPABASE_PUBLISHABLE_KEY ?? ""),
    },
    resolve: {
    alias: {
      "@3dprintmty/domain": fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)),
      "@3dprintmty/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
    server: {
      port: 5173,
      proxy: {
        "/api": "http://localhost:3000",
      },
    },
  };
});
