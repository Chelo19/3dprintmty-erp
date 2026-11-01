# Autores de movimientos y retiro de la bitácora

La bitácora de actividad del taller fue retirada por decisión del producto. Se eliminan su pantalla, navegación, endpoint y las escrituras explícitas y automáticas a `audit_events`. La migración `20261101053558_remove_activity_audit.sql` elimina la tabla, sus índices, los triggers que la alimentaban y sus funciones auxiliares. El historial acumulado en esa tabla deja de estar disponible, incluidos snapshots anteriores y nuevos de los registros y eventos históricos archivados allí.

Se conservan los datos de negocio y sus historiales específicos: `stock_ledgers`, `sales_order_events`, pagos, gastos, cancelaciones, consumos, recepciones e inspecciones. Los campos `created_by`, `created_at`, `canceled_by` y `canceled_at` existentes no se eliminan. Esto permite seguir identificando autores en los registros originales, pero no reconstruir todas las ediciones o bajas como hacía la bitácora.

`guard_record_author` y los triggers `record_author` siguen impidiendo suplantar o reemplazar al creador original. La identidad proviene del Actor verificado y se transmite en la misma transacción. Se mantienen RLS, roles, atomicidad y protección contra reintentos duplicados.

`apply_tenant_rls` continúa configurando permisos por taller y ahora instala únicamente `enable_record_author`, sin logging adicional. Los módulos futuros deben mantener `tenant_id`, PK y `created_by` cuando corresponda.

`platform_audit_log` permanece: es el registro independiente de seguridad de soporte y suplantación administrativa. No es la bitácora de actividad del taller.

## Despliegue y eliminación de datos

Este cambio requiere actualizar API y esquema de forma coordinada. Una API anterior sigue consultando e insertando en `audit_events`, por lo que fallará si se elimina la tabla mientras continúa atendiendo tráfico. Durante el despliegue, detener las instancias anteriores, ejecutar la migración y arrancar la API de esta versión. Después desplegar el frontend para retirar el enlace a la pantalla anterior. El arranque verifica las migraciones, por lo que no se debe iniciar la API nueva contra una base sin migrar.

No usar un pre-deploy con cambio incompatible si todavía hay instancias antiguas atendiendo tráfico. La eliminación del historial no tiene reversión automática; volver al código anterior requiere recrear su esquema, y recrearlo vacío no recupera los eventos eliminados.

## Verificación

`apps/api/test/record-authors.test.ts` comprueba ausencia de la tabla y triggers de actividad, API retirada, conservación de autores, anti-suplantación, aislamiento, atomicidad, idempotencia y permisos de módulos futuros. Las pruebas de compras verifican que las migraciones conservan abonos, inventario e importes históricos. Las demás suites cubren ventas, cobros, fabricación y soporte administrativo.
