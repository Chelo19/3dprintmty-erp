# Compras con varias partidas

En **Compras → Registrar compra o gasto**, buscar artículos por nombre o SKU y agregarlos con un clic a la compra actual. El catálogo se filtra por productos de reventa, insumos y filamentos. Cada artículo se carga con su costo de catálogo por unidad de compra; cantidad × costo unitario determina el importe de la partida en MXN. El costo es editable y se conserva al volver a agregar el artículo. Si no hay costo en el catálogo, debe capturarse. Los productos con fabricación habilitada no se pueden comprar.

Los botones **Agregar servicio** y **Otro gasto** incorporan partidas de descripción y costo manuales. Las fechas usan el día actual por defecto. **Fecha del pago** aparece al marcar **Compra pagada**; la fecha de compra y la nota se ajustan en **Fecha de compra y nota**. Los abonos posteriores también permiten seleccionar la fecha real del pago.

La compra tiene un folio, una fecha, un importe total y un saldo. El pago inicial y los abonos posteriores se aplican al total. Su detalle muestra las partidas con paginación.

## Inventario y costos

Una compra con artículos físicos genera una recepción. Cada partida física conserva su cantidad, factor de conversión, lote, valor y movimiento de entrada. Los kilogramos de filamento se convierten a gramos. Servicios y otros gastos forman parte del importe, sin generar existencias.

El costo de catálogo es el valor por defecto para capturar una compra. Cambiar el costo en la compra no modifica el catálogo ni las recetas dependientes. El importe real queda registrado en las partidas, recepciones y movimientos de inventario. Si el mismo artículo aparece en varias partidas, cada una puede tener su propio costo y lote.

Compra, partidas, pago inicial, recepción, lotes, importes reales, entradas, auditoría y respuesta idempotente se confirman en una sola transacción. Un error revierte todos los efectos. El frontend conserva la llave de idempotencia para reintentar una misma captura sin duplicar entradas.

## Contrato de API

`POST /api/v1/expenses` admite `lines`, con hasta 100 partidas. Cada una usa `kind` (`product`, `filament`, `service` u `other`), `itemId` para artículos de catálogo, `description` para gastos, `quantity`, `amount` y, opcionalmente, `lotNumber` y `vendorLot`. El servidor suma los importes. Fecha, pago inicial, proveedor, sucursal y nota pertenecen a la compra completa.

Se conserva el formato anterior de una sola partida. Una compra múltiple usa `expenses.kind = 'mixed'` y sus partidas financieras se guardan en `expense_lines`. El detalle devuelve `lines`; los movimientos físicos siguen en `receipts`, `receipt_lines`, `material_lots` y `stock_ledgers`.

La migración incorpora las compras históricas a `expense_lines` conservando sus importes, cantidades, autores y fechas. Usa las unidades y conversiones de las recepciones históricas cuando existen. No modifica sus abonos ni inventarios. La nueva tabla tiene RLS, referencias compuestas por taller y auditoría de movimientos.
