export function vercelConfig(apiOrigin) {
  if (!apiOrigin) throw new Error("Define API_ORIGIN en Vercel con el origen HTTPS de tu API de Render.");
  let url;
  try { url = new URL(apiOrigin); }
  catch { throw new Error("API_ORIGIN debe ser un origen HTTPS válido."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("API_ORIGIN debe usar HTTPS, sin credenciales, rutas, parámetros ni fragmentos.");
  }
  return {
    version: 3,
    routes: [
      { src: "^/api(?:/(.*))?$", dest: `${url.origin}/api/$1`, headers: { "Cache-Control": "private, no-store" } },
      { src: "^/assets/.*$", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
      { handle: "filesystem" },
      { src: "^/(?!api(?:/|$)|assets(?:/|$)).*$", dest: "/index.html", headers: { "Cache-Control": "no-cache" } },
    ],
  };
}
