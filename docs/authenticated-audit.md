# Trazabilidad de operaciones

Los movimientos nuevos se atribuyen al usuario autenticado, sin aceptar identidad ni fecha de auditoría enviadas por el cliente. La bitácora se consulta en Configuración → Bitácora de actividad, únicamente con los roles dueño o administrador. Cada taller solo puede consultar su historial.

## Implementación

`audit_events` conserva eventos de negocio existentes y registros automáticos de altas, cambios y bajas mediante triggers PostgreSQL. Estos últimos incluyen valores anteriores y nuevos, campos modificados, UUID de usuario, correo y rol de la sesión, usuario de soporte cuando corresponda, fecha del servidor y un identificador de transacción. Se revierte todo si falla la operación. Reintentos idempotentes no generan nuevos movimientos ni nuevas firmas. Actualizaciones sin cambios reales no generan eventos.

La identidad proviene de `Actor`, verificado por autenticación, y se transmite con `SET LOCAL request.jwt.claims` en la misma conexión y transacción. Las escrituras normales usan `asUser`; las escrituras administrativas de negocio usan `asAdminActor`. El segundo método no debe emplearse para evitar permisos de un módulo: se reserva para onboarding y gestión de membresías que ya requieren autorización en el controlador. La envoltura de idempotencia conserva identidad también durante la asignación de folios.

Los triggers son SECURITY INVOKER y no elevan privilegios ni eluden RLS. Las funciones internas no tienen EXECUTE para PUBLIC, anon, authenticated ni erp_api. La aplicación no tiene permisos de UPDATE, DELETE o TRUNCATE sobre la bitácora; triggers rechazan además cambios y vaciados por conexiones administrativas. Un administrador PostgreSQL con capacidad de cambiar DDL sigue siendo parte del perímetro de confianza y puede desactivar esos controles; esto es atribución autenticada, no una firma electrónica fiscal ni evidencia criptográfica externa.

Se excluyen `idempotency_keys` e `idempotency_requests` (pueden contener respuestas y tokens), `platform_audit_log` (tiene su propia auditoría de seguridad) y la bitácora misma. Los registros automáticos omiten claves de credenciales y hashes de invitación. Los datos operativos, incluyendo importes y datos de clientes, solo se exponen a dueño y administrador mediante RLS. No se auditan lecturas. El histórico anterior se mantiene sin inventar autores que nunca se registraron; los movimientos antiguos de inventario conservan su `created_by`.

## Módulos futuros

`apply_tenant_rls` instala los triggers de auditoría en nuevas tablas. Las tablas que no usen ese helper deben incorporar explícitamente `enable_record_audit` en su migración. El helper es exclusivo de las migraciones. Mantener `tenant_id`, PK UUID y `created_by` cuando corresponda. Las nuevas columnas que contengan secretos deben añadirse a la lista de exclusión del trigger antes de desplegarlas.

La consulta de la bitácora usa paginación por fecha y UUID y conserva microsegundos en el cursor. Los índices cubren taller/fecha, entidad y usuario; no se cargan todos los eventos en el navegador. El crecimiento de los snapshots exige monitorizar tamaño y definir, cuando se requiera, archivado protegido conforme a la política de conservación del producto; no borrar eventos como parte de la edición de entidades.

## Verificación

Pruebas de altas/cambios/bajas, anti-suplantación, creador original, inmutabilidad, rollback, roles, aislamiento de talleres, retiro del autor, ocultación de tokens, idempotencia, precisión de paginación y tablas futuras en `apps/api/test/audit.test.ts`. Además se ejecutan las suites operativas de compras, inventario, fabricación, cobros y ventas.

Referencia: [Triggers de PostgreSQL en Supabase](https://supabase.com/docs/guides/database/postgres/triggers).
