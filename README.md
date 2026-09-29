# PrintMTY

ERP operativo para granjas de impresión 3D. México primero: MXN, `America/Mexico_City`, IVA y prefactura. No es un CFDI y no timbra ante el SAT.

La **fase 0** trae talleres, acceso, RLS, alta, i18n, dinero, unidades, sucursales, roles, auditoría y el esqueleto de catálogo y de política fiscal. Encima corren ventas y cobranza, y los módulos de operación:

| Módulo | Pantalla | Qué hace |
| --- | --- | --- |
| Rollos y conteos | `/app/rollos`, `/app/conteos` | Rollo con folio `R-n`, lote y peso neto. Pesaje con ajuste en el kardex. Conteo cíclico con vista previa valuada y folio `CC-n`. |
| Manufactura | `/app/manufactura` | Estaciones con tarifa por hora, BOM versionado con merma y detección de ciclos, ruta por estación, costo estándar desde el BOM. |
| Producción | `/app/produccion` | Orden `OP-n` desde pedido o para stock. Liberar aparta material, consumo por rollo, backflush al terminar, costo real con material y mano de obra. |
| Calidad | `/app/calidad` | Inspección al terminar según el rigor del producto. El candado del taller avisa o bloquea. Retrabajo, desecho y catálogo de defectos. |
| Compras | `/app/compras` | Proveedores, orden `OC-n`, recepción `REC-n` con lote y rollos. El costo del catálogo se promedia al recibir. |
| MRP | `/app/mrp` | Faltantes netos contra existencia, compras en camino y producción programada. Órdenes planeadas que se firman y se liberan como OC u OP. |
| Prefacturas | `/app/prefacturas` | Prefactura / Nota de venta (no es CFDI) con serie y folio, vista imprimible, cancelación y paquete para el contador en JSON, CSV o ZIP. |

Pagos, prefacturas y recepciones exigen el encabezado `Idempotency-Key`.

## Requisitos

- Node.js 22+

## Arranque local

```bash
npm install
npm test
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3000/api/v1/health

Los datos quedan en `.data/pglite`. `npm run db:reset` borra esa carpeta.

No hay usuario administrador de fábrica. El primer correo que completa el alta es el dueño del taller. Para la consola de plataforma, exporta `PLATFORM_ADMIN_EMAILS` antes de registrar ese correo.

Copia `.env.example` a `.env` cuando quieras fijar `JWT_SECRET`.

## Supabase

Cuando tengas un proyecto:

1. Aplica `supabase/migrations` en el SQL editor o con la CLI.
2. No ejecutes `supabase/local/auth_stubs.sql` ahí: Supabase ya trae `auth.jwt()`.
3. Define `DATABASE_URL` y, en producción, `AUTH_DRIVER=supabase` con `JWT_SECRET` de al menos 32 caracteres.

El gancho de claims `tenant_id` y `role` queda documentado para cuando la identidad pase a Supabase Auth. Hoy el JWT lo firma la API local.

## Pruebas

`npm test` cubre dinero, unidades, IVA, máquinas de estado, ledger y pruebas de API: el taller A no lee al taller B, producción no ve precios de venta y la suplantación de soporte queda en la auditoría.

`apps/api/test/manufacturing.test.ts` recorre la operación completa: compra 1 kg en dos rollos, fabrica un pedido de dos llaveros (126 g por pieza con merma), lo pasa por calidad con el candado en bloqueo, cierra la orden, emite la prefactura `A-1`, registra el cobro y exporta el paquete del contador. También prueba que el MRP no cuente dos veces un pedido que ya tiene orden de producción.

## Qué sigue

Surtir el terminado al embarcar el pedido, MRP automático al confirmar y PDF de la prefactura. Las decisiones están en `DECISIONS.md`.
