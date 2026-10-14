# Simplificación aplicada — 14 de octubre de 2026

La migración `20261014210912_simplify_database_foundations` está aplicada y tiene checksum verificado en la base conectada. Se conservaron los datos y los flujos actuales; las respuestas de la API siguen incluyendo RFC, IVA y `productType`.

## Cambios

- Retirados 23 índices equivalentes; conservada una copia comprobada de cada uno. La migración comprueba columnas, predicados, expresiones, colaciones, método, unicidad y opciones antes de retirar un índice.
- Retiradas 75 FKs simples; conservadas las 75 compuestas validadas que incluyen `tenant_id`, con sus acciones de borrado. Las relaciones y los índices únicos de soporte quedaron reflejados en Drizzle.
- RFC canónico en `company_profiles.rfc`, con unicidad y validación de formato. Plataforma y alta siguen devolviendo RFC mediante el perfil fiscal. La creación del taller ahora es atómica para revertir todos los registros si el RFC ya existe.
- IVA canónico en `tax_rates.rate`. `company_profiles.default_tax_rate_id` selecciona la tasa mediante una FK compuesta por taller. Se retiraron la copia `default_vat_rate` y el indicador repetido `tax_rates.is_default`. Las lecturas fiscales se resuelven con un helper común y mantienen `vatRate` en la API.
- `products.product_type` quedó como columna generada desde `item_class` y `supply_mode`, conservando compatibilidad de lectura y respuestas antiguas. Se retiraron el trigger de sincronización y la restricción incompatible con `raw_material`. Las entradas antiguas de la API se traducen a la clasificación canónica.
- `idempotency_keys` se movió íntegra a `erp_archive`, con su fila histórica y FK intactas. El archivo no concede permisos a `PUBLIC`, `anon`, `authenticated` ni `erp_api`. Las operaciones actuales siguen usando `idempotency_requests`. La vinculación de cuentas de Supabase conserva su actualización del historial archivado y también mantiene las respuestas activas al reconciliar el ID de usuario.

`public` pasa de 53 a 52 tablas, incluyendo `schema_migrations`; la tabla archivada sigue existiendo en su schema privado. No se borraron registros de negocio.

## Funcionalidades conservadas

Cotizaciones, pedidos, compras, recepciones, gastos, abonos, cobranza, inventario, rollos, lotes, recetas, rutas, fabricación, calidad, equipo, roles y soporte. Prefacturas conserva su historial y código con el estado de desactivación anterior.

Se mantienen separados los documentos de sus snapshots, los movimientos de los saldos, las recetas de los consumos reales y las compras de sus pagos. La separación permite conservar trazabilidad, recepciones parciales, reservas y costos históricos.

Los servicios siguen en su catálogo actual. La API ya rechazaba dar de alta servicios por el endpoint de productos; no se retiró una funcionalidad adicional. El maestro común de artículos, múltiples talleres por cuenta, envíos parciales y el rediseño de cuentas por pagar quedan como evoluciones de producto, no como parte de esta limpieza.

## Verificación

- Copia local completa del esquema anterior y sus datos: migración exitosa y comparación lógica de las 52 tablas con datos, reconstruyendo los campos centralizados. Cero diferencias.
- Base conectada tras la migración: misma comparación de las 52 tablas; cero diferencias. La tabla archivada se incluyó en la comparación.
- Verificados 23 índices conservados, 75 FKs compuestas validadas, dos triggers de permisos del operador y `security_invoker` en `products_visible`. El archivo y las tablas sensibles siguen cerrados para los roles públicos.
- 120 pruebas ejecutadas y aprobadas en el monorepo: 48 de API, 14 de frontend, 43 de dominio, 8 fiscales, 6 de pagos y 1 compartida.
- 22 pruebas omitidas: 21 necesitan `TEST_DATABASE_URL` de PostgreSQL local y una prueba de concurrencia de lectura requiere ese driver. No se afirma cobertura completa de estrés en PostgreSQL con estas ejecuciones.
- TypeScript de todos los workspaces y compilación del frontend aprobados. La advertencia previa de tamaño del bundle de Vite permanece.
- Pruebas nuevas para migrar datos existentes, privacidad del archivo, materia prima, compatibilidad de clasificación, IVA, rechazo atómico de RFC repetido y reconciliación de identidades sin perder membresía o respuestas históricas.
- El código actualizado arrancó contra PostgreSQL y consultó correctamente los contratos fiscales de los dos talleres mediante sus permisos de lectura.

## Copia de seguridad y conexión de migraciones

El snapshot protegido está en `.backups/database/20261014-before-simplification.json` y la verificación posterior en `.backups/database/20261014-after-simplification-verification.json`. La carpeta tiene permisos privados y está excluida de Git. El snapshot contiene datos de `public`, metadatos y fuentes de las migraciones anteriores; no es un backup físico ni incluye Auth/Storage administrados, que no se modificaron.

Se configuró `MIGRATION_DATABASE_URL` en el `.env` local con el pooler de sesión en el puerto 5432. La conexión de la API conserva su modo anterior. Para desplegar esta versión se debe aplicar la migración antes de iniciar el código actualizado; el arranque verifica el historial y no ejecuta DDL automáticamente.

La migración completa opera en una transacción, usa límites de tiempo y aborta si los RFC o tasas anteriores no coinciden. Las migraciones históricas no se modificaron.
