# Cancelación de gastos y sus pagos

En **Compras → Ver gasto → Cancelar gasto y pagos**, un propietario, administrador o encargado de almacén puede cancelar un gasto indicando un motivo de 3 a 240 caracteres. La cancelación no se puede deshacer; para registrar nuevamente el gasto se crea otra compra.

Se conservan el folio, las partidas, los importes, las fechas efectivas de pago y los autores originales. El gasto y todos sus abonos se marcan con fecha, usuario y motivo de cancelación. Su saldo pasa a cero y deja de contar en los gastos y cuentas por pagar del dashboard. No se ejecutan transferencias ni devoluciones bancarias.

## Compras con inventario

Cada partida física genera una salida de reversa por la cantidad y valor exactos de su recepción, con vínculo al gasto, lote y usuario responsable. Las recepciones y lotes originales permanecen como documentos históricos; la cantidad recibida de un lote representa la recepción original, no sus existencias actuales.

Se impide cancelar si las existencias están reservadas, son insuficientes, existen salidas posteriores del artículo (aunque se haya repuesto) o un lote está asociado a una bobina. La comprobación de salidas es conservadora, por artículo y en todas las ubicaciones, porque las existencias no se gestionan como capas individuales de costo. Las reversas de otras cancelaciones no cuentan como consumo.

La cancelación revierte el valor real de la recepción y sus existencias, sin modificar los costos por defecto de productos, insumos o filamentos en el catálogo ni los costos de las recetas.

Toda la operación —reversa, cancelación de abonos y gasto, auditoría— es transaccional y utiliza el bloqueo de escritura del taller. Si falla una partida, nada queda cancelado ni descontado. Los reintentos no duplican salidas.

## API y base de datos

`POST /api/v1/expenses/:id/cancel`, con `Idempotency-Key` y cuerpo `{ "reason": "Captura duplicada" }`.

Migración: `20261027233946_cancel_expenses_and_payments.sql`. Agrega `canceled_at`, `canceled_by` y `cancellation_reason` a `expenses` y `expense_payments`, con restricciones de consistencia. Las políticas de acceso por taller y la auditoría existentes siguen vigentes. No se eliminan tablas ni registros.
