// Las pruebas corren contra PGlite en memoria con sesiones locales, sin importar el entorno del shell.
process.env.VITEST = "1";
process.env.AUTH_DRIVER = "local";
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_PUBLISHABLE_KEY;
