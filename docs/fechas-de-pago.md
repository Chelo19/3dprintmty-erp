# Fechas de pago

## Compras

Al marcar **Compra pagada** se muestra **Fecha del pago**, con el día actual como valor inicial. Los abonos posteriores también permiten elegir su fecha. La fecha de compra (`expenses.occurred_on`) y la del pago (`expense_payments.paid_on`) son independientes.

## Cobranza

**Registrar cobro** permite seleccionar **Fecha del pago**. Un cobro contra entrega permanece pendiente y no tiene fecha de recepción hasta confirmarlo. Desde la acción **Confirmar cobro** se puede indicar el día en que se recibió el dinero. La confirmación automática al entregar un pedido usa el día actual.

`payments.paid_on` guarda la fecha civil del movimiento de dinero. `payments.created_at` conserva el timestamp original de captura para trazabilidad. Los reembolsos usan el mismo esquema de fecha efectiva.

El historial muestra la fecha efectiva y la fecha de registro por separado. El dashboard agrupa cobros y reembolsos por mes de pago; el paquete para el contador usa esa misma fecha en su filtro de periodo y en sus archivos.

## Compatibilidad y migración

La API acepta `paidOn` en `POST /api/v1/payments` y `POST /api/v1/payments/:id/complete`. Es opcional para clientes anteriores. Cuando falta en un movimiento completado, un trigger asigna el día actual en la zona horaria del taller. Esto cubre también ventas inmediatas del POS y la confirmación de cobros contra entrega.

La migración asigna a los pagos históricos completados su día de captura en la zona horaria del taller, que es la única fecha previamente disponible. Los pendientes mantienen `paid_on` nulo. No cambia importes, estados, autores ni timestamps originales. Las fechas capturadas desde la API deben ser fechas de calendario válidas con formato `YYYY-MM-DD`.
