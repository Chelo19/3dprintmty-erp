# OC fuera del alcance actual

Las órdenes de compra quedan desactivadas (`FEATURES.purchaseOrders = false`) y las tablas `purchase_orders` y `purchase_order_lines` se eliminan mediante una migración nueva. Las rutas antiguas de API conservan autenticación y responden `module_disabled`; los enlaces antiguos de la interfaz vuelven a Compras. Se retiran el listado de OC y el indicador de compras en camino.

Las compras directas siguen disponibles para filamentos, productos comprables e insumos. El gasto y su pago inicial, la recepción, el lote, el promedio de costos y el movimiento de inventario se registran en una transacción atómica. La llave de idempotencia conserva la respuesta y evita duplicados al reintentar. Servicios y otros gastos continúan sin afectar existencias. Se mantienen proveedores, saldos y abonos, auditoría, cantidades y unidades de compra/almacén, y sincronización de costos de recetas. Se conserva la prohibición de comprar productos con fabricación habilitada.

`receipts.expense_id` y `material_lots.expense_id` reemplazan la dependencia de OC. `receipt_lines` conserva descripción, unidad de compra, factor y costo unitario. Los gastos mantienen sus folios; los movimientos conservan referencias e identidad de usuario. Las recepciones históricas sin gasto pueden mantener la referencia documental anterior sin activar una OC.

Antes de aplicar se respalda el conjunto de tablas afectadas en `.backups/2026-10-14-before-removing-oc.json`, con permisos privados y exclusión de Git. Los encabezados y partidas históricos de OC se conservan también en eventos `purchase_order.archived` de la bitácora inmutable. No se modifican importes, existencias, pagos, costos ni fechas históricas. Las huellas de los registros anteriores se comparan después de la migración.

Para una fase posterior, reintroducir el módulo mediante nuevas migraciones y un flujo explícito de solicitud, recepción y gasto/pago. No basta con cambiar el flag: deben restaurarse su esquema, rutas y UI, sin volver a crear OC ocultas para las compras directas. El código histórico queda recuperable en Git y la migración documenta la información original.

Verificación: tests de migración con OC existentes; compras directas con abono parcial, cantidades de inventario, costos, lotes y vínculos históricos; idempotencia y rollback; suites completas de ventas, cobranza, inventario, manufactura, roles y auditoría.
