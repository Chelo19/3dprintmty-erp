# Decisiones de la fase 0

El brief manda elegir la opción más simple que no rompa el aislamiento del tenant ni el puerto fiscal.

- Multi-tenant lógico: un Postgres, `tenant_id` y RLS. No hay schema ni base por taller.
- Local sin Docker: PGlite aplica las mismas migraciones. `DATABASE_URL` cambia a Supabase sin reescribir servicios.
- La sesión de negocio entra a Postgres con `set local role authenticated` y el JWT en `request.jwt.claims`. El superusuario solo se usa para alta, invitaciones y consola de plataforma.
- Identidad local (scrypt + JWT propio) para desarrollar. En producción, Supabase Auth con la llave publicable en el front y la llave secreta solo en la API. El JWT del usuario se verifica con el JWKS del proyecto. No se usa el JWT secret legacy ni las llaves `anon` / `service_role`.
- Dinero en centavos (`bigint`). Nada de float.
- El factor de unidad (1000 g = 1 kg) es la fuente de la valuación. No es el tamaño del rollo.
- Roles y estados viven en `text` con `check`, no en enums de Postgres, para poder ampliarlos en migraciones cortas.
- El precio de venta de producción se anula en la vista `products_visible`. RLS sigue siendo por fila; la vista es la defensa de columna.
- Un usuario pertenece a un solo taller (`unique (user_id)` en membresías).
- La invitación devuelve un enlace. No hay proveedor de correo en esta fase.
- La semilla de demo carga PLA y PETG. El cliente y el BOM entran con ventas y producción.
- `CountryPolicy` solo activa México. Estados Unidos existe como puerto y responde que no está habilitado.
- Las llaves de Mercado Pago, Conekta o Stripe son del tenant. Sin secreto del taller no hay checkout.
- Idempotencia real en el alta de productos, que es el patrón que usarán pagos, prefacturas y recepciones.
- Nest se compone en `startContainer` porque el runtime de desarrollo es `tsx` y esbuild no emite metadata de decoradores. Los módulos y guards siguen siendo de Nest.

# Decisiones de los módulos de operación

- FilaOps sirvió solo como referencia funcional de qué flujos necesita una granja de impresión. Está bajo Business Source License 1.1: no se copió código, esquema, nombres internos ni documentación. Tablas, contratos, reglas y pantallas son propios. Donde la costumbre mexicana difiere, gana México.
- Cantidades con cuatro decimales en `bigint` escalado (×10000). El filamento vive en gramos; el costo del catálogo es por unidad de compra (MXN/kg).
- Los folios (`OP`, `OC`, `REC`, `R`, `CC`, serie de prefactura) se asignan fuera de la transacción del usuario, porque PGlite no admite una segunda conexión dentro de la primera. Para no dejar huecos, cada operación valida primero en una pasada de solo lectura y solo después pide folio.
- La reserva de material es un movimiento del kardex (`reservation` / `release`), no una tabla aparte. Existencia, apartado y disponible salen del mismo saldo.
- Al terminar una orden, lo que el BOM esperaba y no se consumió a mano se descuenta solo (backflush). Lo apartado que sobra se libera.
- Calidad: el rigor es del producto (`off`, `basic`, `full`) y el candado es del taller (`off`, `warn`, `block`). Con `block`, una inspección rechazada sin retrabajo ni desecho no deja cerrar la orden.
- El costo del filamento se promedia al recibir compras. El terminado conserva un costo estándar que se recalcula a mano desde el BOM; su costo real queda en cada orden.
- El MRP resta la producción programada para no contar dos veces un pedido que ya tiene orden. Los materiales de las órdenes abiertas cuentan como demanda.
- La prefactura toma montos del pedido, nunca del cuerpo de la petición. Dice «Prefactura / Nota de venta — no es un CFDI». La forma de pago SAT es 01/03/04 solo si es PUE con un único método; si no, 99.
- El paquete del contador es un ZIP sin compresión escrito a mano (CRC32 incluido) para no sumar dependencias. Las fechas usan el corte de `America/Mexico_City` (−06:00).
- La vista imprimible del navegador reemplaza al PDF en esta entrega.
- Fuera de alcance por ahora: surtir el terminado al embarcar, MRP automático al confirmar el pedido y capacidad finita por estación.
