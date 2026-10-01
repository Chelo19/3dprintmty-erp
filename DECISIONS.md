# Decisiones de la fase 0

El brief manda elegir la opción más simple que no rompa el aislamiento del tenant ni el puerto fiscal.

- Multi-tenant lógico: un Postgres, `tenant_id` y RLS. No hay schema ni base por taller.
- Local sin Docker: PGlite aplica las mismas migraciones. `DATABASE_URL` cambia a Supabase sin reescribir servicios.
- La sesión de negocio entra a Postgres con `set local role erp_api` y el JWT en `request.jwt.claims`. Las operaciones administrativas usan `asAdmin` y no pueden ejecutarse desde un contexto de usuario.
- Identidad local (scrypt + JWT propio) para desarrollar. En producción, Supabase Auth con la llave publicable en el front y la llave secreta solo en la API. El JWT del usuario se verifica con el JWKS del proyecto. No se usa el JWT secret legacy ni las llaves `anon` / `service_role`.
- Dinero en centavos (`bigint`). Nada de float.
- El factor de unidad (1000 g = 1 kg) es la fuente de la valuación. No es el tamaño del rollo.
- Roles y estados viven en `text` con `check`, no en enums de Postgres, para poder ampliarlos en migraciones cortas.
- El precio de venta de producción se anula en la vista `products_visible`. RLS protege filas; la API controla los campos visibles por rol y la Data API no tiene acceso a tablas ni vistas de negocio.
- Un usuario pertenece a un solo taller (`unique (user_id)` en membresías).
- La invitación devuelve un enlace. No hay proveedor de correo en esta fase.
- La semilla de demo carga PLA y PETG. El cliente y el BOM entran con ventas y producción.
- `CountryPolicy` solo activa México. Estados Unidos existe como puerto y responde que no está habilitado.
- Las llaves de Mercado Pago, Conekta o Stripe son del tenant. Sin secreto del taller no hay checkout.
- La idempotencia reserva la llave, ejecuta los efectos y guarda la respuesta en una misma transacción. Es obligatoria para pagos, prefacturas, recepciones y despachos; opcional en altas de catálogo.
- Nest se compone en `startContainer` porque el runtime de desarrollo es `tsx` y esbuild no emite metadata de decoradores. Los módulos y guards siguen siendo de Nest.

# Decisiones de los módulos de operación

- FilaOps sirvió solo como referencia funcional de qué flujos necesita una granja de impresión. Está bajo Business Source License 1.1: no se copió código, esquema, nombres internos ni documentación. Tablas, contratos, reglas y pantallas son propios. Donde la costumbre mexicana difiere, gana México.
- Cantidades con cuatro decimales en `bigint` escalado (×10000). El filamento vive en gramos; el costo del catálogo es por unidad de compra (MXN/kg).
- Los folios se asignan mediante el contexto administrativo. En operaciones idempotentes se comparte la transacción envolvente, por lo que un fallo revierte también el folio. Los flujos sin envolvente atómica todavía pueden dejar huecos y no deben tratar su numeración como un consecutivo fiscal sin interrupciones.
- La reserva de material es un movimiento del kardex (`reservation` / `release`), no una tabla aparte. Existencia, apartado y disponible salen del mismo saldo.
- Al terminar una orden, lo que el BOM esperaba y no se consumió a mano se descuenta solo (backflush). Lo apartado que sobra se libera.
- Calidad: el rigor es del producto (`off`, `basic`, `full`) y el candado es del taller (`off`, `warn`, `block`). Con `block`, una inspección rechazada sin retrabajo ni desecho no deja cerrar la orden.
- El costo del filamento se promedia al recibir compras. El terminado conserva un costo estándar que se recalcula a mano desde el BOM; su costo real queda en cada orden.
- El MRP resta la producción programada para no contar dos veces un pedido que ya tiene orden. Los materiales de las órdenes abiertas cuentan como demanda.
- La prefactura toma montos del pedido, nunca del cuerpo de la petición. Dice «Prefactura / Nota de venta — no es un CFDI». La forma de pago SAT es 01/03/04 solo si es PUE con un único método; si no, 99.
- El paquete del contador es un ZIP sin compresión escrito a mano (CRC32 incluido) para no sumar dependencias. Las fechas usan el corte de `America/Mexico_City` (−06:00).
- La vista imprimible del navegador reemplaza al PDF en esta entrega.
- Fuera de alcance por ahora: surtir el terminado al embarcar, MRP automático al confirmar el pedido y capacidad finita por estación.

## Cimientos SaaS: API privada, atomicidad y despliegue

- Las tablas y vistas del ERP se consultan a través de Nest. `authenticated` y `anon` de Supabase Auth no tienen acceso directo a esos datos. La API usa `SET LOCAL ROLE erp_api`, un rol NOLOGIN/NOBYPASSRLS, con las mismas políticas por tenant y rol comercial. No se concede este rol a `authenticator`, `authenticated` ni `anon`. El helper de futuras tablas RLS concede privilegios a `erp_api`. El navegador conserva Supabase Auth, sin usar su Data API para negocio.
- Las FK existentes entre entidades con `tenant_id` se complementan con `(tenant_id, referencia) → (tenant_id, id)`. Se valida el historial al migrar; datos cruzados abortan la migración y requieren revisión, nunca una corrección automática ni un borrado.
- Pagos, recepciones, prefacturas y despachos requieren una llave por captura, con ámbito tenant/usuario/operación. Reserva, efectos, folios y respuesta se escriben en una transacción compartida mediante contexto async. Un fallo revierte todo. La llave puede reintentarse con el mismo contenido; cambiar contenido devuelve conflicto. Las llaves antiguas se conservan en su tabla histórica y no se reutilizan como operaciones nuevas.
- PostgreSQL serializa las transacciones `asUser` por taller mediante un advisory lock transaccional. Así saldo, reservas, OP, recepciones y costo promedio se validan después del commit anterior, también entre réplicas. Los distintos talleres son independientes. Es una elección conservadora para esta etapa: las consultas `asUser` también participan, por lo que reportes largos pueden retrasar escrituras del mismo taller. No hacer llamadas externas dentro de esas transacciones. Antes de necesitar más concurrencia dentro de un taller, separar lecturas y reemplazar este mutex por bloqueos de agregados con un orden global, manteniendo las pruebas de carreras.
- COD no excede el saldo ni reserva dos veces el mismo pendiente. Al completarlo o entregar el pedido se vuelve a validar el saldo. Si llegó otro pago, anular el pendiente con motivo y registrar el importe correcto. Solo owner/admin/sales anulan pendientes; dinero completado se corrige mediante un reembolso. Crear, completar y anular deja eventos de auditoría.
- Con PostgreSQL, el arranque únicamente verifica migraciones y checksums. `npm run db:migrate` usa una conexión dedicada y un lock de sesión para exclusión entre despliegues. Admite archivos históricos de 4 dígitos y nuevos archivos creados por Supabase CLI de 14 dígitos. El primer uso registra baseline de checksums para el historial heredado. En desarrollo/test con PGlite se mantiene preparación automática.
- `MIGRATION_DATABASE_URL` permite separar la credencial de DDL de `DATABASE_URL`. El aprovisionamiento de credenciales/privilegios mínimos del runtime debe cubrir las operaciones administrativas de onboarding/auth/equipo/soporte, que todavía usan `asAdmin`; retirar DDL del arranque no convierte por sí solo una conexión postgres existente en una credencial restringida.
- La suite `foundations.test.ts` puede correr contra PGlite y PostgreSQL 16 real con `TEST_DATABASE_URL` local. Crea y elimina una base temporal por ejecución; nunca se acepta un host remoto para esas pruebas.
