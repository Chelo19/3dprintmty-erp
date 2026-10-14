# Revisión de redundancia y simplificación de la base de datos

Este documento conserva el diagnóstico previo. La implementación y verificación posterior están en [Simplificación aplicada](database-simplification-2026-10-14.md).

Fecha: 14 de octubre de 2026. Fuente: base conectada por las variables del repositorio, esquema Drizzle, migraciones y usos en apps/api/src. Solo consultas de lectura; no se modificó estructura ni datos. Los conteos son exactos al momento de la revisión y pueden cambiar con actividad posterior.

Se inventariaron 92 tablas: 53 en public (52 de aplicación y schema_migrations), 27 en auth, 3 en realtime, 8 en storage y 1 en vault. Para las tablas administradas por Supabase se revisó inventario, no reglas internas ni contenido. También se contrastó products_visible y los triggers de clasificación; no se afirma una auditoría completa de todas las funciones/RLS o de consumidores externos.

La simplificación conveniente consiste en retirar infraestructura duplicada y centralizar datos maestros. Fusionar indiscriminadamente documentos, saldos e historiales perdería funcionalidades. No hay base para reducir decenas de tablas sin rediseñar el negocio.

## Orden recomendado

1. Corregir la incompatibilidad de materias primas y estabilizar la clasificación.
2. Retirar una copia de cada índice exacto duplicado y evaluar las FKs simples ya cubiertas por las compuestas.
3. Archivar la idempotencia antigua y retirar ese contrato tras confirmar consumidores.
4. Centralizar RFC e IVA conservando contratos de API, restricciones y snapshots.
5. Cerrar la doble entrada de servicios; evaluar un maestro de artículos únicamente si los módulos nuevos lo justifican.
6. Diseñar múltiples talleres por cuenta, envíos parciales e impuestos por línea como evoluciones de producto separadas.

## Hallazgos

### 1. Clasificación antigua incompatible con materias primas — Alta

Tablas: products.

Evidencia: La API y products_item_class_check aceptan raw_material. El trigger sync_product_classification lo copia a product_type, pero products_type_check no admite ese valor. Conflicto confirmado en la base conectada; no se intentó insertar datos.

Recomendación: Corregir primero la restricción de compatibilidad. Después retirar usos de product_type en API, vistas y clientes hasta dejar item_class/supply_mode como fuente única.

Condición para conservar funcionalidades: Retirar la columna de golpe rompe contratos antiguos y la vista products_visible.

Referencia: apps/api/src/modules/catalog.controller.ts:14; supabase/migrations/20261014000144_product_classification_supply.sql.

### 2. 23 índices duplicados exactos — Media

Tablas: 23 pares sobre relaciones de ventas, inventario y fabricación.

Evidencia: Comparación de pg_index: mismas columnas, clases, orden, colación, predicado, expresiones, unicidad y método. Ninguno respalda una PK/UNIQUE. Una copia por par suma 360448 bytes (352 KiB) actualmente.

Recomendación: Mantener uno por par y retirar el duplicado con una migración controlada. Revisar opciones físicas y uso externo antes de elegir cuál conservar.

Condición para conservar funcionalidades: No hay medición que permita prometer una reducción concreta de latencia; el ahorro de espacio hoy es pequeño.

Referencia: Catálogos PostgreSQL consultados en modo READ ONLY; pestaña Índices.

### 3. 75 claves foráneas simples cubiertas por una compuesta — Media

Tablas: Relaciones entre entidades del mismo taller.

Evidencia: Existe FK por id y otra por (tenant_id,id) al mismo padre, con acciones y diferibilidad compatibles; la compuesta está validada. Ejemplo: expense_payments.expense_id.

Recomendación: Conservar las compuestas y retirar únicamente las simples equivalentes tras revisar acciones de borrado, columnas SET NULL, dependencias y pruebas entre talleres.

Condición para conservar funcionalidades: Nunca retirar las compuestas: impiden relacionar datos de empresas distintas. Los índices UNIQUE(tenant_id,id) son soporte necesario y no se consideran duplicados de una PK(id).

Referencia: supabase/migrations/20261001043842_saas_foundation_integrity.sql; pestaña Relaciones.

### 4. Una tabla antigua de idempotencia sin uso actual — Media

Tablas: idempotency_keys / idempotency_requests.

Evidencia: idempotency_keys contiene 1 fila; sin uso en las operaciones actuales, aunque una referencia SQL cruda de vinculación de cuentas de Supabase actualiza sus IDs de usuario. Esa referencia se identificó en la revisión final y se adaptó al archivo privado. withIdempotency usa idempotency_requests, que contiene 6 filas. pg_depend no mostró vistas/FKs entrantes dependientes de la antigua.

Recomendación: Archivar la fila y confirmar que no hay integraciones externas antes de retirar idempotency_keys y su definición Drizzle.

Condición para conservar funcionalidades: La búsqueda de código no prueba que un consumidor externo no la use. Mantener la nueva tabla y su garantía contra cobros/movimientos repetidos.

Referencia: apps/api/src/modules/support.ts:75; apps/api/src/db/schema.ts:448.

### 5. RFC maestro almacenado dos veces — Media

Tablas: tenants.rfc / company_profiles.rfc.

Evidencia: Ambos son UNIQUE y editables. Onboarding escribe ambos y Settings actualiza ambos. En los 2 talleres actuales no hay diferencias.

Recomendación: Conservar tenants como identidad SaaS y company_profiles como perfil fiscal; usar este último como fuente canónica del RFC y adaptar la consulta de plataforma y la respuesta de alta antes de quitar la copia.

Condición para conservar funcionalidades: Preservar unicidad global, normalización y mensajes de duplicado. No fusionar tenant y empresa fiscal solo para ahorrar una tabla.

Referencia: apps/api/src/modules/onboarding.controller.ts:99; apps/api/src/modules/settings.controller.ts:85; apps/api/src/modules/platform.controller.ts:32.

### 6. IVA predeterminado duplicado y catálogo sin lectura de negocio — Media

Tablas: company_profiles.default_vat_rate / tax_rates.rate.

Evidencia: tax_rates solo se crea en onboarding y se actualiza en Settings. Ventas, compras y prefacturas calculan desde default_vat_rate. Las 2 tasas actuales coinciden.

Recomendación: Para el SaaS y futura facturación, convertir tax_rates en la fuente canónica con una referencia default_tax_rate_id desde company_profiles; conservar vatRate en los contratos de API.

Condición para conservar funcionalidades: Quitar tax_rates simplificaría el alcance actual de IVA único, pero dificultaría múltiples impuestos y tasas por línea. Los documentos necesitan snapshots de los impuestos aplicados.

Referencia: apps/api/src/modules/settings.controller.ts:82; apps/api/src/modules/orders.shared.ts:526; apps/api/src/modules/purchasing.controller.ts:632.

### 7. Servicios pueden entrar por dos catálogos — Media

Tablas: products.item_class=service / service_offerings.

Evidencia: El endpoint de productos acepta service, aunque el flujo comercial real tiene service_offerings y referencias service_id. Actualmente hay 0 productos con esa clasificación y 2 service_offerings.

Recomendación: Cerrar la creación de servicios por products y mantener un único catálogo de servicios. Como evolución opcional, usar items comunes con atributos especializados para producto/filamento/servicio.

Condición para conservar funcionalidades: Un maestro común exige migrar referencias y unidades. Puede aumentar tablas, aunque reduzca ramas de código; no justifica fusionarlo todo ahora.

Referencia: apps/api/src/modules/catalog.controller.ts:14; apps/api/src/db/schema.ts:272.

### 8. Compras y gastos repiten parte del detalle — Futura

Tablas: expenses / purchase_orders / purchase_order_lines / receipts.

Evidencia: El gasto de producto/filamento crea una OC, la recibe y luego registra expenses con referencia a la OC. Importe, cantidad y descripción se guardan en ambos recorridos.

Recomendación: Definir explícitamente el documento operativo y la obligación financiera como fuentes para cada dato; evolucionar cuentas por pagar con detalles múltiples sin eliminar recepción parcial ni gastos sin artículos.

Condición para conservar funcionalidades: Una compra no implica pago y una recepción no equivale a deuda completa. Fusionar tablas ahora elimina distinciones necesarias.

Referencia: apps/api/src/modules/purchasing.controller.ts:241.

### 9. Cada usuario solo puede pertenecer a un taller — Futura

Tablas: tenant_memberships.

Evidencia: tenant_memberships_user_unique aplica UNIQUE(user_id), a pesar de existir tenant_id y role.

Recomendación: Si el producto permitirá una cuenta en varios talleres, pasar a UNIQUE(tenant_id,user_id) junto con selección explícita de taller y cambios de Auth/RLS.

Condición para conservar funcionalidades: Cambiar únicamente la restricción rompería la selección de membresía actual. Es una decisión de negocio, no una limpieza aislada.

Referencia: apps/api/src/db/schema.ts:44; apps/api/src/modules/auth.service.ts.

### 10. El pedido representa un solo envío — Futura

Tablas: sales_orders.

Evidencia: carrier, tracking_number, shipment_folio y shipped_at viven como campos únicos del pedido.

Recomendación: Al incorporar proveedores de envío y entregas parciales, crear shipments y shipment_lines enlazados al pedido y a sus líneas, preservando las cantidades acumuladas.

Condición para conservar funcionalidades: No fusionar tablas comerciales para resolverlo; el futuro requiere una relación uno a muchos.

Referencia: apps/api/src/db/schema.ts:346.

## Duplicaciones que conviene conservar

- quotes, sales_orders y commercial_documents: oferta, compromiso y documento emitido son etapas diferentes. Guardar nombres, RFC, precios y totales como snapshot evita que editar el catálogo cambie el pasado.
- boms/routings y production_order_materials/operations: receta/ruta vigente frente a copia utilizada para una orden concreta; conservar versionado y costos.
- stock_ledgers y stock_balances: historial frente a saldo y reservas operativas. Agregar conciliación y pruebas de reconstrucción, no calcular todo el inventario en cada GET.
- production_consumptions y stock_ledgers: consumos/costos frente a movimientos físicos. Actualmente el filamento se descuenta por pesaje; el consumo de producción lo valora sin repetir esa salida.
- spools/spool_events: rollo físico frente a catálogo de filamento e inventario agregado. Las tablas vacías tienen rutas implementadas y no son evidencia de desuso.
- payments y expense_payments: cuentas por cobrar y por pagar tienen reglas y referencias distintas. Una abstracción común sería una evolución, no un borrado inmediato.
- audit_events, platform_audit_log y sales_order_events: ámbito del taller, administración de plataforma y estados de pedido. Mantener responsabilidades y políticas de acceso.
- auth.users y user_accounts: identidad administrada por Supabase frente al registro de aplicación y su driver local. Revisar sincronización, no borrar una tabla por compartir email.
- public.schema_migrations y migraciones de auth/storage/realtime: historiales de componentes distintos. Las 39 tablas de schemas administrados no son candidatas a simplificar desde el ERP.

## Inventario completo de public


### Identidad y configuración

- **user_accounts** (3 filas): Conservar. Perfil de aplicación y soporte de autenticación local; no duplicar la identidad de Supabase como otro usuario distinto.
- **platform_admins** (0 filas): Conservar. Privilegios globales separados de los roles del taller; estar vacía no la vuelve redundante.
- **tenants** (2 filas): Conservar la entidad SaaS. Retirar su copia editable del RFC cuando company_profiles sea la fuente canónica.
- **tenant_memberships** (3 filas): Conservar. Rol y acceso por taller. UNIQUE(user_id) actualmente limita cada cuenta a un solo taller.
- **platform_audit_log** (6 filas): Conservar. Auditoría global y soporte; tiene un ámbito distinto de audit_events.
- **company_profiles** (2 filas): Conservar perfil fiscal separado. Centralizar RFC; reemplazar la copia de IVA por una referencia a la tasa predeterminada.
- **locations** (2 filas): Conservar. Sucursales y almacenes, necesarios para inventario y futuras entregas.
- **tax_rates** (2 filas): Centralizar. Hoy se escribe, pero los cálculos usan company_profiles.default_vat_rate; darle función real como catálogo fiscal.
- **payment_method_settings** (16 filas): Conservar. Configuración independiente por taller y método; no es un registro de pagos.
- **number_sequences** (10 filas): Conservar. Asignación concurrente de folios; no reemplazar por MAX(folio)+1.
- **invitations** (3 filas): Conservar. Invitaciones pendientes, vencimiento y aceptación; distinta de una membresía activa.
- **schema_migrations** (31 filas): Conservar. Historial técnico de migraciones; no es una tabla de negocio.

### Catálogos

- **products** (5 filas): Simplificar clasificación. item_class y supply_mode deben ser canónicos; retirar product_type antiguo. Evitar nuevos servicios en este catálogo.
- **filaments** (6 filas): Conservar por ahora. Datos técnicos y unidades en gramos. Un maestro común de artículos es una evolución opcional, no un borrado inmediato.
- **service_offerings** (2 filas): Conservar. Catálogo real de servicios; impedir crear el mismo concepto también como products.item_class=service.
- **customers** (2 filas): Conservar. Cliente, crédito y datos fiscales actuales; no debe sustituir las copias históricas de documentos.
- **customer_addresses** (2 filas): Conservar. Varias direcciones de entrega y facturación por cliente.
- **vendors** (1 filas): Conservar. Proveedores de compras; fusionar con clientes requeriría un modelo explícito de contactos con roles.

### Ventas y cobros

- **quotes** (5 filas): Conservar. Oferta y condiciones históricas independientes del pedido.
- **quote_prints** (4 filas): Conservar. Agrupa piezas o trabajos de impresión; no equivale a una línea de material o servicio.
- **quote_lines** (13 filas): Conservar snapshots de descripción, SKU e importes. catalog_id polimórfico es un punto a mejorar en una evolución del catálogo.
- **sales_orders** (5 filas): Conservar. Pedido confirmado, crédito, entrega y cobro; no fusionar con quotes. A futuro extraer envíos múltiples a entidades propias.
- **sales_order_prints** (4 filas): Conservar. Ejecución y resolución de cada trabajo vendido, independiente del original cotizado.
- **sales_order_lines** (13 filas): Conservar. Snapshot comercial y cantidades reservadas/entregadas; mantener coherencia con movimientos y ejecución.
- **sales_order_events** (31 filas): Conservar. Historial específico de estados y motivos; audit_events tiene otra finalidad.
- **payments** (4 filas): Conservar. Cobros y devoluciones de clientes, con método y estado.
- **commercial_documents** (1 filas): Conservar. Prefacturas desactivadas, pero existe historial. No es infraestructura completa de CFDI futuro.
- **commercial_document_lines** (1 filas): Conservar. Snapshot del documento emitido; evitar recalcularlo desde el pedido actual.

### Inventario

- **stock_balances** (5 filas): Conservar. Saldo operativo y reservas para bloquear sobreventa; reconciliar on_hand con stock_ledgers.
- **stock_ledgers** (18 filas): Conservar. Movimientos auditables; no sustituir por únicamente el saldo.
- **spools** (0 filas): Conservar. Rollos individuales y pesajes, aunque hoy no tiene filas. El inventario puede incluir filamento todavía sin rollos.
- **spool_events** (0 filas): Conservar. Historia física de un rollo; enlazar al ledger cuando cambia inventario para facilitar conciliación.
- **material_lots** (3 filas): Conservar. Trazabilidad de lotes, proveedor, compra y recepción; útil para calidad y costos.

### Fabricación y calidad

- **work_centers** (4 filas): Conservar. Recursos, capacidad y costos de fabricación.
- **routings** (0 filas): Conservar. Rutas versionadas de fabricación; API implementada aunque actualmente no tiene filas.
- **routing_operations** (0 filas): Conservar. Operaciones de la ruta; maestro para planificar, no ejecución de una orden.
- **boms** (9 filas): Conservar. Recetas versionadas por producto.
- **bom_lines** (11 filas): Conservar. Materiales y mermas de la receta; no fusionar con consumos reales.
- **production_orders** (6 filas): Conservar. Orden fabricada, programación, calidad y costos propios.
- **production_order_materials** (6 filas): Conservar. Snapshot de necesidades y costos de una orden; cambios posteriores en BOM no deben alterarla.
- **production_order_operations** (0 filas): Conservar. Snapshot y ejecución de operaciones; distinto de routing_operations.
- **production_consumptions** (4 filas): Conservar. Consumo y costo de producción. Filamento se descuenta físicamente por pesaje; unir ciegamente con ledger causaría doble descuento.
- **defect_types** (6 filas): Conservar. Catálogo de defectos independiente de inspecciones.
- **inspections** (4 filas): Conservar. Resultados, evidencias y disposiciones de calidad.

### Compras y pagos

- **purchase_orders** (3 filas): Conservar. Compromiso de compra, proveedor y recepción parcial; distinto de un gasto pagado.
- **purchase_order_lines** (3 filas): Conservar. Cantidades compradas, unidades y conversión; received_qty es un acumulado a conciliar.
- **receipts** (3 filas): Conservar. Entradas físicas parciales o múltiples por compra.
- **receipt_lines** (3 filas): Conservar. Cantidad, conversión y lote recibido; no reemplazar por purchase_order_lines.
- **expenses** (3 filas): Conservar. Obligación/gasto financiero enlazado a la compra. Cantidad y descripción repiten información: revisar fuente canónica sin perder gastos de servicio u otros.
- **expense_payments** (3 filas): Conservar. Abonos a gastos distintos de cobros a clientes; posible abstracción común de pagos más adelante.

### Infraestructura y auditoría

- **audit_events** (78 filas): Conservar. Auditoría de negocio por taller; no sustituye historiales específicos ni la auditoría global.
- **idempotency_keys** (1 filas): Retirar gradualmente. Fuera del flujo actual de operaciones; conserva una fila histórica y una referencia de reconciliación de identidad que debe adaptarse al archivo privado. Archivar y revisar consumidores externos primero.
- **idempotency_requests** (6 filas): Conservar. Implementación actual atómica con clave por taller, usuario, operación y petición.

## Pares de índices idénticos

Fuente: pg_index, pg_class, pg_am y pg_constraint. Ninguno de los pares respalda una PK o una restricción UNIQUE; las clases, colaciones, expresiones y predicados coinciden. El plan todavía debe elegir qué nombre conservar.

- **production_order_materials**: production_order_materials_order_idx, erp_production_order_materials_production_order_id_idx.
- **production_order_operations**: production_order_operations_order_idx, erp_production_order_operations_production_order_id_idx.
- **production_orders**: production_orders_sales_order_idx, erp_production_orders_sales_order_id_idx.
- **customer_addresses**: customer_addresses_customer_idx, erp_customer_addresses_customer_id_idx.
- **payments**: payments_order_idx, erp_payments_sales_order_id_idx.
- **quote_lines**: quote_lines_quote_idx, erp_quote_lines_quote_id_idx.
- **quote_lines**: quote_lines_print_idx, erp_quote_lines_print_id_idx.
- **receipt_lines**: receipt_lines_receipt_idx, erp_receipt_lines_receipt_id_idx.
- **material_lots**: material_lots_product_idx, erp_material_lots_product_id_idx.
- **material_lots**: material_lots_filament_idx, erp_material_lots_filament_id_idx.
- **routing_operations**: routing_operations_routing_idx, erp_routing_operations_routing_id_idx.
- **sales_order_lines**: sales_order_lines_order_idx, erp_sales_order_lines_sales_order_id_idx.
- **sales_order_lines**: sales_order_lines_service_idx, erp_sales_order_lines_service_id_idx.
- **sales_order_lines**: sales_order_lines_filament_idx, erp_sales_order_lines_filament_id_idx.
- **bom_lines**: bom_lines_bom_idx, erp_bom_lines_bom_id_idx.
- **inspections**: inspections_order_idx, erp_inspections_production_order_id_idx.
- **production_consumptions**: production_consumptions_order_idx, erp_production_consumptions_production_order_id_idx.
- **purchase_order_lines**: purchase_order_lines_order_idx, erp_purchase_order_lines_purchase_order_id_idx.
- **sales_orders**: sales_orders_location_idx, erp_sales_orders_location_id_idx.
- **commercial_document_lines**: commercial_document_lines_document_idx, erp_commercial_document_lines_document_id_idx.
- **stock_balances**: stock_balances_tenant_product_idx, erp_stock_balances_product_id_idx.
- **stock_balances**: stock_balances_filament_idx, erp_stock_balances_filament_id_idx.
- **stock_ledgers**: stock_ledgers_filament_idx, erp_stock_ledgers_filament_id_idx.

## FKs simples candidatas a retirar

75 coincidencias de relación, columna referenciada, acciones y diferibilidad, con contraparte compuesta validada. Verificar MATCH, SET NULL, nulabilidad, dependencias y pruebas de aislamiento antes de cualquier migración. Las compuestas son las que deben conservarse.

- **expense_payments**: revisar `expense_payments_expense_id_fkey`; conservar `erp_expense_payments_expense_id_fk`.
- **production_order_materials**: revisar `production_order_materials_component_filament_id_fkey`; conservar `erp_production_order_materials_component_filament_id_fk`.
- **production_order_materials**: revisar `production_order_materials_component_product_id_fkey`; conservar `erp_production_order_materials_component_product_id_fk`.
- **production_order_materials**: revisar `production_order_materials_production_order_id_fkey`; conservar `erp_production_order_materials_production_order_id_fk`.
- **production_order_operations**: revisar `production_order_operations_production_order_id_fkey`; conservar `erp_production_order_operations_production_order_id_fk`.
- **production_order_operations**: revisar `production_order_operations_work_center_id_fkey`; conservar `erp_production_order_operations_work_center_id_fk`.
- **production_orders**: revisar `production_orders_bom_id_fkey`; conservar `erp_production_orders_bom_id_fk`.
- **production_orders**: revisar `production_orders_location_id_fkey`; conservar `erp_production_orders_location_id_fk`.
- **production_orders**: revisar `production_orders_product_id_fkey`; conservar `erp_production_orders_product_id_fk`.
- **production_orders**: revisar `production_orders_routing_id_fkey`; conservar `erp_production_orders_routing_id_fk`.
- **production_orders**: revisar `production_orders_sales_order_id_fkey`; conservar `erp_production_orders_sales_order_id_fk`.
- **customer_addresses**: revisar `customer_addresses_customer_id_fkey`; conservar `erp_customer_addresses_customer_id_fk`.
- **payments**: revisar `payments_sales_order_id_fkey`; conservar `erp_payments_sales_order_id_fk`.
- **quote_lines**: revisar `quote_lines_print_id_fkey`; conservar `erp_quote_lines_print_id_fk`.
- **quote_lines**: revisar `quote_lines_quote_id_fkey`; conservar `erp_quote_lines_quote_id_fk`.
- **quote_prints**: revisar `quote_prints_quote_id_fkey`; conservar `erp_quote_prints_quote_id_fk`.
- **quotes**: revisar `quotes_customer_id_fkey`; conservar `erp_quotes_customer_id_fk`.
- **receipt_lines**: revisar `receipt_lines_filament_id_fkey`; conservar `erp_receipt_lines_filament_id_fk`.
- **receipt_lines**: revisar `receipt_lines_lot_id_fkey`; conservar `erp_receipt_lines_lot_id_fk`.
- **receipt_lines**: revisar `receipt_lines_product_id_fkey`; conservar `erp_receipt_lines_product_id_fk`.
- **receipt_lines**: revisar `receipt_lines_purchase_order_line_id_fkey`; conservar `erp_receipt_lines_purchase_order_line_id_fk`.
- **receipt_lines**: revisar `receipt_lines_receipt_id_fkey`; conservar `erp_receipt_lines_receipt_id_fk`.
- **material_lots**: revisar `material_lots_filament_id_fkey`; conservar `erp_material_lots_filament_id_fk`.
- **material_lots**: revisar `material_lots_product_id_fkey`; conservar `erp_material_lots_product_id_fk`.
- **material_lots**: revisar `material_lots_purchase_order_id_fkey`; conservar `erp_material_lots_purchase_order_id_fk`.
- **material_lots**: revisar `material_lots_receipt_id_fkey`; conservar `erp_material_lots_receipt_id_fk`.
- **material_lots**: revisar `material_lots_vendor_id_fkey`; conservar `erp_material_lots_vendor_id_fk`.
- **routing_operations**: revisar `routing_operations_routing_id_fkey`; conservar `erp_routing_operations_routing_id_fk`.
- **routing_operations**: revisar `routing_operations_work_center_id_fkey`; conservar `erp_routing_operations_work_center_id_fk`.
- **routings**: revisar `routings_product_id_fkey`; conservar `erp_routings_product_id_fk`.
- **sales_order_events**: revisar `sales_order_events_sales_order_id_fkey`; conservar `erp_sales_order_events_sales_order_id_fk`.
- **sales_order_lines**: revisar `sales_order_lines_filament_id_fkey`; conservar `erp_sales_order_lines_filament_id_fk`.
- **sales_order_lines**: revisar `sales_order_lines_print_id_fkey`; conservar `erp_sales_order_lines_print_id_fk`.
- **sales_order_lines**: revisar `sales_order_lines_product_id_fkey`; conservar `erp_sales_order_lines_product_id_fk`.
- **sales_order_lines**: revisar `sales_order_lines_sales_order_id_fkey`; conservar `erp_sales_order_lines_sales_order_id_fk`.
- **sales_order_lines**: revisar `sales_order_lines_service_id_fkey`; conservar `erp_sales_order_lines_service_id_fk`.
- **sales_order_prints**: revisar `sales_order_prints_sales_order_id_fkey`; conservar `erp_sales_order_prints_sales_order_id_fk`.
- **bom_lines**: revisar `bom_lines_bom_id_fkey`; conservar `erp_bom_lines_bom_id_fk`.
- **bom_lines**: revisar `bom_lines_component_filament_id_fkey`; conservar `erp_bom_lines_component_filament_id_fk`.
- **bom_lines**: revisar `bom_lines_component_product_id_fkey`; conservar `erp_bom_lines_component_product_id_fk`.
- **boms**: revisar `boms_product_id_fkey`; conservar `erp_boms_product_id_fk`.
- **inspections**: revisar `inspections_defect_type_id_fkey`; conservar `erp_inspections_defect_type_id_fk`.
- **inspections**: revisar `inspections_production_order_id_fkey`; conservar `erp_inspections_production_order_id_fk`.
- **production_consumptions**: revisar `production_consumptions_filament_id_fkey`; conservar `erp_production_consumptions_filament_id_fk`.
- **production_consumptions**: revisar `production_consumptions_lot_id_fkey`; conservar `erp_production_consumptions_lot_id_fk`.
- **production_consumptions**: revisar `production_consumptions_material_id_fkey`; conservar `erp_production_consumptions_material_id_fk`.
- **production_consumptions**: revisar `production_consumptions_product_id_fkey`; conservar `erp_production_consumptions_product_id_fk`.
- **production_consumptions**: revisar `production_consumptions_production_order_id_fkey`; conservar `erp_production_consumptions_production_order_id_fk`.
- **purchase_order_lines**: revisar `purchase_order_lines_filament_id_fkey`; conservar `erp_purchase_order_lines_filament_id_fk`.
- **purchase_order_lines**: revisar `purchase_order_lines_product_id_fkey`; conservar `erp_purchase_order_lines_product_id_fk`.
- **purchase_order_lines**: revisar `purchase_order_lines_purchase_order_id_fkey`; conservar `erp_purchase_order_lines_purchase_order_id_fk`.
- **purchase_orders**: revisar `purchase_orders_location_id_fkey`; conservar `erp_purchase_orders_location_id_fk`.
- **purchase_orders**: revisar `purchase_orders_vendor_id_fkey`; conservar `erp_purchase_orders_vendor_id_fk`.
- **receipts**: revisar `receipts_location_id_fkey`; conservar `erp_receipts_location_id_fk`.
- **receipts**: revisar `receipts_purchase_order_id_fkey`; conservar `erp_receipts_purchase_order_id_fk`.
- **sales_orders**: revisar `sales_orders_customer_id_fkey`; conservar `erp_sales_orders_customer_id_fk`.
- **sales_orders**: revisar `sales_orders_location_id_fkey`; conservar `erp_sales_orders_location_id_fk`.
- **sales_orders**: revisar `sales_orders_quote_id_fkey`; conservar `erp_sales_orders_quote_id_fk`.
- **commercial_documents**: revisar `commercial_documents_sales_order_id_fkey`; conservar `erp_commercial_documents_sales_order_id_fk`.
- **commercial_document_lines**: revisar `commercial_document_lines_document_id_fkey`; conservar `erp_commercial_document_lines_document_id_fk`.
- **stock_balances**: revisar `stock_balances_filament_id_fkey`; conservar `erp_stock_balances_filament_id_fk`.
- **stock_balances**: revisar `stock_balances_location_id_fkey`; conservar `erp_stock_balances_location_id_fk`.
- **stock_balances**: revisar `stock_balances_product_id_fkey`; conservar `erp_stock_balances_product_id_fk`.
- **expenses**: revisar `expenses_filament_id_fkey`; conservar `erp_expenses_filament_id_fk`.
- **expenses**: revisar `expenses_product_id_fkey`; conservar `erp_expenses_product_id_fk`.
- **expenses**: revisar `expenses_purchase_order_id_fkey`; conservar `erp_expenses_purchase_order_id_fk`.
- **expenses**: revisar `expenses_service_id_fkey`; conservar `erp_expenses_service_id_fk`.
- **stock_ledgers**: revisar `stock_ledgers_filament_id_fkey`; conservar `erp_stock_ledgers_filament_id_fk`.
- **stock_ledgers**: revisar `stock_ledgers_location_id_fkey`; conservar `erp_stock_ledgers_location_id_fk`.
- **stock_ledgers**: revisar `stock_ledgers_lot_id_fkey`; conservar `erp_stock_ledgers_lot_id_fk`.
- **stock_ledgers**: revisar `stock_ledgers_product_id_fkey`; conservar `erp_stock_ledgers_product_id_fk`.
- **spool_events**: revisar `spool_events_spool_id_fkey`; conservar `erp_spool_events_spool_id_fk`.
- **spools**: revisar `spools_filament_id_fkey`; conservar `erp_spools_filament_id_fk`.
- **spools**: revisar `spools_location_id_fkey`; conservar `erp_spools_location_id_fk`.
- **spools**: revisar `spools_lot_id_fkey`; conservar `erp_spools_lot_id_fk`.

## Validación necesaria para ejecutar cambios

Migraciones sobre copia/QA; comparación de conteos y documentos antes/después; pruebas de idempotencia, RFC repetido, impuestos, ventas, recepción parcial, reservas, fabricación, pesajes, permisos y cruces entre talleres. Preservar acciones ON DELETE y constraints compuestas. Respaldo y archivo del dato histórico antes de retirar tablas o columnas. Revisión de planes/índices tras el cambio; ningún ahorro de latencia se ha medido aquí.

Referencias primarias: [PostgreSQL: restricciones](https://www.postgresql.org/docs/current/ddl-constraints.html) y [Supabase: datos del usuario](https://supabase.com/docs/guides/auth/managing-user-data).
