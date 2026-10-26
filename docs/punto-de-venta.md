# Punto de venta

Disponible en **Ventas → Punto de venta**, para Dueño, Administrador, Ventas y Operador.

## Operación

1. Seleccionar sucursal y buscar productos o servicios por nombre o SKU. El catálogo oculta por defecto los artículos sin existencia libre en esa sucursal (las unidades apartadas no cuentan como disponibles). Los filtros separan servicios, productos terminados fabricados y productos de reventa; los artículos mixtos aparecen en ambos filtros de productos. «Mostrar sin inventario» permite consultarlos, sin habilitar su venta.
2. Agregar artículos al carrito, capturar cantidades y, si corresponde, descuentos e impuestos por partida.
3. Elegir público en general o un cliente activo mediante autocomplete.
4. Registrar el cobro completo en efectivo, tarjeta o transferencia. Solo aparecen métodos habilitados en el taller.
5. Confirmar la venta e imprimir su ticket. El historial permite volver a consultarlo e imprimirlo.

Los precios capturados son unitarios, en MXN y antes de impuestos. El efectivo recibido debe cubrir el total; el cambio no se registra como ingreso. Los cobros con tarjeta y transferencia registran operaciones realizadas en la terminal o banco del taller, sin procesarlas automáticamente.

El POS vende productos con existencia física libre y servicios de atención inmediata. No permite usar unidades apartadas para otros pedidos ni generar inventario negativo. La venta queda pagada, entregada y completada en Pedidos; el cobro aparece en Cobranza. El ticket es un comprobante de venta, no un CFDI.

## Integridad y permisos

`POST /api/v1/pos/sales` exige `Idempotency-Key` y el total que el usuario revisó (`expectedTotal`). Una misma llave y contenido devuelven la misma venta. Reutilizarla con otro contenido produce un conflicto.

Folio, cliente de público general cuando hace falta, pedido, partidas, cobro, salidas de inventario, auditoría y respuesta idempotente se guardan en una sola transacción. Un error revierte todos los efectos. Las escrituras se serializan por taller con el mecanismo existente del sistema.

Catálogo, sucursal, cliente y configuración de pago se validan bajo RLS. El rol Ventas no recibe permisos generales de inventario: la salida se ejecuta con autoría verificada, únicamente para los artículos y la sucursal ya validados de la venta nueva. Los permisos generales del Operador para modificar otros registros permanecen restringidos.

La venta utiliza las tablas existentes de pedidos, cobros e inventario. `sales_orders.sales_channel = 'pos'` distingue el origen y `cash_tendered_minor` conserva el efectivo recibido. El importe del pago corresponde al total cobrado, sin incluir el cambio.

## Endpoints

- `GET /api/v1/pos/catalog`: búsqueda por `q` y sucursal `locationId`; incluye precios, existencia libre, sucursales, métodos de cobro y tasas predeterminadas.
- `POST /api/v1/pos/sales`: cobro y entrega inmediata.
- `GET /api/v1/pos/sales?page=1&limit=10`: historial paginado por fecha descendente.
- `GET /api/v1/pos/sales/:id`: ticket de la venta dentro del taller actual.

Las respuestas del POS incluyen datos comerciales, sin costos ni márgenes.
