# Revisión de materiales de producción

En Producción, seleccionar las órdenes con las casillas y pulsar **Revisar gasto de material**. La casilla del encabezado selecciona la página actual. La selección se conserva al paginar y se limpia al cambiar el filtro de estado. Se admite revisar hasta 1,000 órdenes en una consulta.

El modal considera la cantidad completa de piezas de cada orden, sin restar piezas terminadas ni material consumido. Agrupa por artículo los filamentos, insumos y productos requeridos, y por servicio los servicios de las recetas. Incluye subrecetas y su merma; evita sumar el costo de un producto intermedio además de sus componentes. La mano de obra por unidad configurada en las rutas se incluye como servicio de ruta.

Es una estimación de planificación con **recetas activas y costos actuales del catálogo**, no el costo histórico congelado de las órdenes ni el gasto real de fabricación. La consulta no crea movimientos, reservas ni modifica las órdenes. Las cantidades de filamento se muestran en gramos, con su costo convertido desde el costo por kilogramo del catálogo.

Se muestran cantidades, unidades, costos unitarios, importes, subtotal de materiales, subtotal de servicios y total general. Si falta algún costo, se indica y los totales afectados quedan sin calcular. El operador puede revisar cantidades; el servidor oculta sus costos e importes conforme a los permisos existentes.

La API usa `POST /api/v1/production-orders/material-review` con `{ "orderIds": ["uuid", "uuid"] }`, ejecutado en una transacción de solo lectura con el aislamiento RLS del taller. Elimina identificadores repetidos y rechaza la selección completa si alguna orden no está disponible en ese taller. Carga las recetas y catálogos una sola vez por consulta, sin una petición por cada orden. No requiere migración.
