-- Solo para Postgres local / PGlite, cuando no existe el esquema auth de Supabase.
-- No se ejecuta en un proyecto Supabase que ya trae auth.jwt().

create schema if not exists auth;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;
