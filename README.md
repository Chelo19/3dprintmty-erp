# PrintMTY

ERP operativo para granjas de impresión 3D. México primero: MXN, `America/Mexico_City`, IVA y prefactura. No es un CFDI y no timbra ante el SAT.

La **fase 0** trae talleres, acceso, RLS, alta, i18n, dinero, unidades, sucursales, roles, auditoría y el esqueleto de catálogo y de política fiscal. Encima corren ventas y cobranza, y los módulos de operación:

| Módulo | Pantalla | Qué hace |
| --- | --- | --- |
| Rollos y conteos | `/app/rollos`, `/app/conteos` | Rollo con folio `R-n`, lote y peso neto. Pesaje con ajuste en el kardex. Conteo cíclico con vista previa valuada y folio `CC-n`. |
| Manufactura | `/app/manufactura` | Estaciones con tarifa por hora, BOM versionado con merma y detección de ciclos, ruta por estación, costo estándar desde el BOM. |
| Producción | `/app/produccion` | Orden `OP-n` desde pedido o para stock. Liberar aparta material, consumo por rollo, backflush al terminar, costo real con material y mano de obra. |
| Calidad | `/app/calidad` | Inspección al terminar según el rigor del producto. El candado del taller avisa o bloquea. Retrabajo, desecho y catálogo de defectos. |
| Compras | `/app/compras` | Proveedores, orden `OC-n`, recepción `REC-n` con lote y rollos. El costo del catálogo se promedia al recibir. |
| MRP | `/app/mrp` | Faltantes netos contra existencia, compras en camino y producción programada. Órdenes planeadas que se firman y se liberan como OC u OP. |
| Prefacturas | `/app/prefacturas` | Prefactura / Nota de venta (no es CFDI) con serie y folio, vista imprimible, cancelación y paquete para el contador en JSON, CSV o ZIP. |

Pagos, prefacturas y recepciones exigen el encabezado `Idempotency-Key`.

## Requisitos

- Node.js 22+

## Arranque local

```bash
npm install
npm test
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3000/api/v1/health

Los datos quedan en `.data/pglite`. `npm run db:reset` borra esa carpeta.

No hay usuario administrador de fábrica. El primer correo que completa el alta es el dueño del taller. Para la consola de plataforma, exporta `PLATFORM_ADMIN_EMAILS` antes de registrar ese correo.

Copia `.env.example` a `.env` cuando quieras fijar `JWT_SECRET`.

## Supabase

La autenticación puede usar Supabase Auth. La API obtiene la membresía actual del usuario y consulta el negocio mediante RLS con un rol interno `erp_api`. El navegador no consulta directamente las tablas del ERP; `authenticated`/`anon` no tienen acceso a ellas.

Para PostgreSQL/Supabase:

1. Configura `DATABASE_URL`, `AUTH_DRIVER=supabase` y las claves de Auth en `.env`.
2. Configura `MIGRATION_DATABASE_URL` para la credencial de despliegue si es distinta. Ejecuta `npm run db:migrate` antes de iniciar la API; el comando usa conexión dedicada, bloqueo y checksums.
3. Despliega/reinicia la API compatible inmediatamente después de la migración de cimientos: una API anterior que use `authenticated` para negocio dejará de tener permisos.
4. El arranque con PostgreSQL verifica el esquema y falla si falta una migración; nunca ejecuta DDL. PGlite prepara su esquema local automáticamente.

No ejecutes `supabase/local/auth_stubs.sql` en Supabase: el migrador solo lo usa si `auth.jwt()` no existe. La separación definitiva de privilegios del runtime debe contemplar las operaciones administrativas de onboarding, equipo y soporte; los detalles están en `DECISIONS.md`.

## Pruebas

`npm test` cubre dinero, unidades, IVA, máquinas de estado, ledger y pruebas de API: el taller A no lee al taller B, producción no ve precios de venta y la suplantación de soporte queda en la auditoría.

`apps/api/test/manufacturing.test.ts` recorre la operación completa: compra 1 kg en dos rollos, fabrica un pedido de dos llaveros (126 g por pieza con merma), lo pasa por calidad con el candado en bloqueo, cierra la orden, emite la prefactura `A-1`, registra el cobro y exporta el paquete del contador. También prueba que el MRP no cuente dos veces un pedido que ya tiene orden de producción.

## Qué sigue

Surtir el terminado al embarcar el pedido, MRP automático al confirmar y PDF de la prefactura. Las decisiones están en `DECISIONS.md`.

## Pruebas de cimientos con PostgreSQL local

`TEST_DATABASE_URL` debe apuntar a un PostgreSQL local desechable y permitir crear bases. La suite crea una base aislada por ejecución y la elimina al terminar:

```bash
TEST_DATABASE_URL=postgresql://postgres:password@127.0.0.1:55439/postgres npm run test -w @3dprintmty/api -- test/foundations.test.ts
```

Sin esa variable se ejecutan los escenarios PGlite y se omiten los de PostgreSQL. Se prueban permisos directos, FK entre talleres, reintentos, rollback de folios/efectos, COD y cobros/stock/recepciones simultáneos.
