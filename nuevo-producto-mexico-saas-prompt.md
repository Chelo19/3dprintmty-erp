# 3dprintmty-erp — Spec de producto + brief de implementación

Sustituye `3dprintmty-erp` antes de usarlo. Copia este archivo a un repositorio
nuevo; no desarrolles el SaaS dentro de este repo.

**Cómo usarlo:** pega el contenido desde la sección “Prompt” en un agente o en el
README del repo nuevo.

**Decisiones ya cerradas**

| Tema | Decisión |
| --- | --- |
| Vertical | ERP operativo para print farms / filamento |
| Entrega | SaaS hospedado por nosotros |
| Año 1 | 1–10 tenants (beta), diseñado para crecer a cientos |
| Tenant | 1 empresa = 1 RFC = 1 tenant |
| Multi-tenant | Lógico: un Postgres + `tenant_id` + RLS de Supabase |
| DB | Supabase (Postgres). SQL Server no es obligatorio |
| Backend | Node.js + TypeScript |
| Frontend | React + TypeScript |
| UI | Español (México) primero, i18n real, `es-MX` |
| Moneda / timezone | MXN / `America/Mexico_City` |
| Fiscal día 1 | Prefactura + export para contador/PAC. Sin timbrado SAT |
| Fuera de MVP | CFDI en vivo, nómina, Carta Porte, portal B2B, impresoras |

**Legal:** no copies código, esquemas ni docs de FilaOps. FilaOps está bajo
Business Source License 1.1. Este brief pide reimplementar flujos y reglas de
negocio con contratos, tablas y UX propios.

---

## Prompt

Eres un equipo senior (product architect + backend Node/TS + frontend React + fiscal MX).
Vas a construir 3dprintmty-erp desde cero.

NO clones el repositorio FilaOps. NO copies archivos, esquemas, nombres internos,
ni texto de LICENSE/docs de FilaOps. FilaOps está bajo Business Source License 1.1.
Úsalo solo como referencia de dominio: módulos, ciclos de vida, y reglas de negocio
descritas abajo, reescritas con nuestros propios contratos, tablas y UX.

El resultado es un SaaS multi-tenant, México primero, para granjas de impresión 3D
(filamento, BOM, producción, inventario, compras, MRP, calidad, cobranza).
Después debe poder crecer a otros países sin reescribir el core.

Si una decisión no está en este documento, elige la opción más simple que no rompa
multi-tenant, tenant isolation, ni la capa fiscal enchufable. Documenta la decisión.

---

## 1. Decisiones bloqueadas (no reabrir)

| Tema | Decisión |
| --- | --- |
| Vertical | ERP operativo para print farms / filamento (como el dominio de FilaOps, no un ERP genérico) |
| Entrega | SaaS que NOSOTROS hospedamos. El cliente no instala. |
| Año 1 | 1–10 tenants (beta). Diseñar para crecer a cientos sin reescribir. |
| Tenant | 1 empresa = 1 RFC = 1 tenant. Pocas sucursales/almacenes, mismo RFC. |
| Multi-tenant | LÓGICO: una sola base Postgres, `tenant_id` en toda fila de negocio, RLS de Supabase. |
| DB | Supabase (Postgres) es la fuente de verdad. SQL Server NO es obligatorio. |
| Backend | Node.js + TypeScript |
| Frontend | React + TypeScript |
| Idioma UI | Español (México) primero. i18n real (claves), no strings hardcodeados. `es-MX` default. |
| Moneda default | MXN |
| Timezone default | America/Mexico_City |
| Fiscal día 1 | PRE-FACTURA interna + exportar paquete para el contador/PAC. Sin timbrado SAT en vivo. |
| CFDI 4.0 / PAC | Fase 2. La arquitectura debe dejar el puerto listo. |
| Nómina, Carta Porte, contabilidad electrónica SAT, portal B2B, integración de impresoras | FUERA del MVP |
| Marca | No usar nombres, logos ni copy de FilaOps / BLB3D |

---

## 2. Recomendación de arquitectura (obligatoria)

### 2.1 Por qué multi-tenant LÓGICO (no físico)

Año 1 son 1–10 empresas. Una base por tenant (físico) implica migraciones N veces,
backups N veces, y mata RLS/Auth/Storage de Supabase.

Hacer:

- Una sola instancia de Postgres (Supabase).
- `tenant_id uuid NOT NULL` en TODA tabla de negocio.
- Unique constraints compuestos: `(tenant_id, order_number)`, etc.
- Supabase RLS en todas las tablas de negocio: `tenant_id = auth.jwt() -> 'tenant_id'`
  (o membership lookup). Nunca confiar solo en filtros del ORM.
- Un usuario de plataforma (superadmin nuestro) fuera del tenant, para onboarding
  y soporte. Los usuarios del tenant NUNCA ven otro tenant.
- Diseño para un futuro tier “dedicated DB” (enterprise): el acceso a datos pasa
  por un `TenantContext`. No hacer queries sueltas a `supabase.from('x')` sin contexto.

No hacer en MVP:

- Schema-per-tenant
- Database-per-tenant
- Un solo schema sin `tenant_id`

Sucursales: son LOCACIONES del mismo tenant (almacén / piso / showroom), no tenants.
El RFC vive en el tenant. El lugar de expedición (CP) vive en la sucursal, para CFDI futuro.

### 2.2 Stack recomendado

```text
Frontend:  React 19 + TypeScript + Vite + Tailwind + TanStack Query + React Router
Backend:   NestJS + TypeScript (monolito modular)
ORM:       Drizzle ORM (mejor encaje con RLS y SQL explícito que Prisma)
Auth:      Supabase Auth (email/password). JWT con claims: tenant_id, role, user_id
DB:        Supabase Postgres 15+
Storage:   Supabase Storage (PDFs, evidencias de pago, fotos QC) — paths namespaced
           por tenant_id
Realtime:  opcional en MVP (dashboard). No bloquear el MVP por websockets.
Jobs:      pg-boss o cola simple en Postgres para MRP y exports
Hosting:   Vercel/Netlify o Cloudflare Pages (front) + Fly/Render/Railway (API)
           + Supabase (DB). Preferir región cercana a México (p.ej. us-east-1 / sa-east-1).
```

NestJS porque el dominio es un ERP (módulos, guards, CQRS ligero, validación).
Drizzle porque las políticas RLS y los unique compuestos se revisan en SQL, no se esconden.

Alternativa aceptable si NestJS se siente pesado: Fastify + módulos equivalentes.
No uses Next.js full-stack como único backend: el dominio fiscal/pagos/MRP necesita
API clara, jobs y transacciones. El front puede ser SPA.

### 2.3 Monolito modular (bounded contexts)

```text
apps/web                  React SPA (admin del tenant)
apps/api                  NestJS
packages/domain           tipos, estados, money, UOM (sin I/O)
packages/fiscal           puertos + adapter MX (prefactura) + adapter stub
packages/payments         puertos + adapters (manual, MP, Conekta/Stripe)
packages/shared           Result types, errors, ids
supabase/migrations       SQL + RLS + storage policies
```

Un módulo no importa repositorios de otro. Se hablan por servicios de aplicación
o eventos internos (in-process). Nada de microservicios en MVP.

---

## 3. Principio fiscal y multi-país (desde el día 1)

Nunca pongas “IVA 16%” ni “RFC” dentro de orders/invoices core como si fueran universales.

```text
CountryPolicy (puerto)
  - countryCode: 'MX' | 'US' | ...
  - currency
  - taxEngine.calculate(lines, addresses, customerTaxProfile) -> TaxBreakdown
  - invoiceEngine.validate(draft) -> ValidationResult
  - invoiceEngine.issue(draft) -> IssuedDocument   // MX MVP: PREFACTURA
  - invoiceEngine.export(id) -> AccountantPackage  // zip/csv/json/xml-prep
  - paymentRules (métodos permitidos, PPD vs PUE, crédito)
  - addressSchema (CP 5 dígitos MX, estado, colonia opcional)
  - identitySchema (RFC, régimen, CP fiscal) — validar formato, no timbrar
```

MVP implementa solo `MxCountryPolicy`.
`UsCountryPolicy` o `GenericVatPolicy` pueden ser stubs.

Documento comercial interno ≠ comprobante fiscal.

- Quote / Sales Order / Prefactura: nuestros documentos.
- CFDI: documento fiscal emitido por un PAC (fase 2).
- La prefactura puede volverse “origen” de un CFDI después, sin rehacer la orden.

Campos fiscales MX en el tenant (obligatorios para operar, aunque no timbre):

- rfc, razon_social, regimen_fiscal, codigo_postal_fiscal, nombre_comercial
- iva_default = 0.16 (configurable; frontera 0.08 / tasa 0 más adelante)
- serie_prefactura (ej. A), folio consecutivo POR TENANT

Campos fiscales MX en el cliente:

- tipo: persona_fisica | persona_moral | publico_general
- rfc (usar RFC genérico XAXX010101000 / XEXX010101000 cuando aplique)
- razon_social / nombre, regimen_fiscal, uso_cfdi_default, cp_fiscal
- email_facturacion

Aunque no se timbre, captura estos datos desde el alta de cliente/tenant.
Si faltan, la prefactura se emite como “público en general” y se marca incompleta
para el contador.

---

## 4. Producto — qué construye el usuario

Un taller de impresión 3D en México entra, configura su empresa (RFC, MXN, IVA),
carga filamentos y productos con BOM, cotiza, confirma pedidos, cobra a la mexicana
(efectivo, SPEI, link de pago, crédito, abonos), produce, controla calidad,
compra material cuando MRP dice que falta, y entrega. Al cierre, exporta un
paquete de prefacturas y cobros para su contador.

No es un marketplace. No es un slicer. No controla impresoras en MVP.

---

## 5. Roles y tenancy

### Plataforma (nosotros)

- `platform_admin`: crea tenants, suspende, impersonation de soporte (auditada).

### Dentro del tenant

- `owner`: billing del SaaS + settings + fiscales
- `admin`: todo lo operativo
- `sales`: clientes, cotizaciones, pedidos, cobranza
- `production`: OP, piso, calidad
- `warehouse`: inventario, recepciones, surtido
- `viewer`: solo lectura

Un usuario pertenece a UN tenant en MVP (no multi-tenant login).
Invitación por email. El primer usuario se crea en el onboarding del tenant.

RBAC en API (guards) Y en RLS (policies). Defense in depth.

---

## 6. Onboarding del tenant (first-run)

Wizard, en español:

1. Cuenta owner (email/password)
2. Empresa: nombre, RFC, régimen, CP fiscal, timezone America/Mexico_City, MXN, es-MX
3. Sucursal/almacén inicial (“Matriz”)
4. Impuesto default: IVA 16%, nombre “IVA”
5. Métodos de cobro activos (toggles)
6. Opcional: datos de demo (filamentos PLA/PETG, un producto con BOM, un cliente)

Sin secrets hardcodeados. Sin usuario admin default.

---

## 7. Módulos MVP y reglas de negocio

Money: usar `decimal.js` o `Dinero.js` / minor units. NUNCA float para dinero.
UOM: una sola fuente (`packages/domain/uom`). No hardcodear conversiones.

### 7.1 Catálogo e inventario

Productos:

- tipo: raw_material | component | finished_good | service
- sku único por tenant, nombre, estado
- para filamento: material (PLA, PETG, ABS, ASA, TPU, …), color, diámetro (1.75/2.85)
- UOM de filamento (default):
  - almacén/consumo: gramos (G)
  - compra: kilogramos (KG)
  - factor: 1000
  - costo de referencia: MXN por KG
- Ejemplo: compra $250/KG, hay 500 G → valuación = 500 * (250/1000) = $125.00
- El factor es conversión de unidad, NO el tamaño del rollo. Un rollo de 1 kg es 1 KG en la OC.
- UOM perfiles extra (más adelante): hojas EA, etc. No bloquear el modelo a filamento.

Inventario:

- multi-locación (almacenes del tenant)
- on_hand, allocated, available = on_hand - allocated
- kardex: toda entrada/salida es transacción (receipt, issue, adjustment, reservation,
  release, scrap, transfer) con qty, costo, user, reason
- cycle count (conteo cíclico) básico
- ajuste con motivo; inventario negativo requiere aprobación admin
- low stock + punto de reorden + lead time en el material

Spools (rollos) — incluir en MVP porque es el corazón del vertical:

- spool_number único por tenant
- peso inicial / peso actual en GRAMOS
- lote proveedor, ubicación, estado (available, in_use, empty, scrapped)
- se pueden crear al recibir la OC
- consumo se registra contra la orden de producción
- umbral ~5 g → empty

### 7.2 BOM y routings

- BOM multinivel con rollup de costo
- líneas: producto componente, qty, scrap %
- routing: secuencia de operaciones (PRINT → POST → QC → PACK)
- work centers (impresora genérica, postproceso, QC, empaque) — sin integración de red
- materiales por operación (opcional)
- duplicar producto + swap de componente (variante de color)
- matriz de variantes (color/material) puede ser fase 1.1, no día 1

### 7.3 Clientes

- B2B (razón social) y B2C (nombre)
- RFC + perfil fiscal MX (arriba)
- direcciones: fiscal y de envío (CP 5 dígitos, estado MX, colonia, país MX default)
- teléfono formato MX
- términos: PUE (contado) vs crédito net-15 / net-30 + límite de crédito
- estado: active / inactive / suspended
- no vender por encima del límite sin override admin (motivo + audit)

### 7.4 Cotizaciones → pedidos (order-to-cash)

Cotización:

- multi-línea, descuento por línea y/o global
- vigencia (default 30 días)
- IVA calculado por tax engine (no “sales tax” US)
- snapshot de precios al emitir
- estados: draft → sent → accepted → converted | expired | void
- PDF en español, MXN, IVA desglosado

Pedido (sales order):

- nace de cotización aceptada O captura directa (wizard)
- líneas de producto / material / servicio
- snapshots: cliente, precios, impuestos, envío
- envío: cargo de envío recálcula IVA y total
- close-short: aceptar cumplimiento parcial con motivo
- editar líneas solo en estados permitidos; no si ya se embarcó o hay OP activa
- no facturar/prefacturar un pedido `pending` — primero `confirmed`

Estados de pedido (autoritarios; máquina de estados, no strings sueltos):

```text
draft → pending → confirmed → in_production → ready_to_ship → shipped → delivered → completed
                  ↘ on_hold
                  ↘ cancelled
```

Estados de pago (separados del fulfillment):

```text
pending | partial | paid | refunded | cancelled
```

Estados de fulfillment (separados de producción):

```text
pending | ready | picking | packing | shipped | delivered
```

Revenue operativo (interno, no SAT): se reconoce al embarcar (devengado), no al cobrar.
La prefactura se puede emitir desde `confirmed` en adelante.

### 7.5 Prefactura (documento comercial MX) — MVP fiscal

NO es CFDI. UI y PDF deben decir “Prefactura / Nota de venta — no es un CFDI”.
Nunca uses la palabra “Factura” sola en el PDF.

Campos:

- serie + folio por tenant (A-1, A-2…)
- emisor: razón social, RFC, régimen, CP fiscal, logo
- receptor: razón social/nombre, RFC, uso CFDI pretendido, CP
- líneas, descuentos, IVA desglosado, total
- método de pago pretendido: PUE | PPD
- forma de pago SAT catalog (01 efectivo, 03 transferencia, 04 tarjeta, 99 por definir…)
- estado: draft → issued → paid | partial | void
- void con motivo + usuario + timestamp; si había AR interno, reversa

Una prefactura por pedido en MVP (1:1). Fase 2: varias, notas de crédito, CFDI.

Export contador (por rango de fechas):

- CSV de prefacturas (folios, RFC, subtotal, IVA, total, PUE/PPD, estado cobro)
- CSV de pagos (fecha, forma, monto, folio prefactura, referencia SPEI)
- ZIP de PDFs
- JSON estable versionado (`accountant_package_v1`) para el futuro PAC

Puerto `invoiceEngine.issue` hoy = persistir prefactura + PDF.
Mañana el adapter MX-CFDI llamará al PAC y guardará uuid, xml, cadena, pac, status.

### 7.6 Cobranza México (crítico)

Ledger de pagos, no un flag. Varios pagos por pedido/prefactura. Reembolsos negativos.

Métodos MVP (toggles por tenant):

| Método | Cómo se captura |
| --- | --- |
| efectivo | monto + caja + nota |
| transferencia / SPEI | banco, CLABE/referencia, fecha, folio bancario, comprobante (Storage) |
| tarjeta (terminal o link) | últimos 4, autorización, o checkout Conekta/Stripe |
| Mercado Pago | checkout + webhook → payment completed |
| Conekta o Stripe MX | un provider de tarjeta/link en MVP; el otro puede quedar ported |
| COD / contra entrega | se marca cobrado al entregar; no liberar crédito |
| crédito net-15/30 | no exige pago para producir si admin aprobó términos |
| PPD / abonos | anticipo, abonos, saldo; payment_status=partial hasta liquidar |

Reglas:

- `amount_due = total - sum(pagos completed) + sum(refunds)`
- PUE: se espera liquidar en una exhibición; si hay abonos, forzar PPD en la prefactura
- crédito: bloquear confirmación si excede límite, salvo override
- COD: producción puede arrancar; cobranza al delivery
- webhooks de MP/Conekta/Stripe: idempotentes, firmados, siempre atados a tenant_id
- cada tenant usa SUS keys (Storage/settings cifrados). Nunca keys de plataforma para cobrar al cliente final del tenant
- UI de métodos: SPEI, efectivo, tarjeta, MP — no Venmo/Zelle/cheques US
- complemento de pagos SAT (REP): fase 2; hoy solo el ledger interno

Estados de un payment: pending → completed | failed | voided

### 7.7 Producción

OP (orden de producción):

- fuentes: manual | sales_order | mrp_planned
- tipo: MAKE_TO_ORDER | MAKE_TO_STOCK
- qty ordered / completed / scrapped
- snapshot de BOM + routing al liberar
- reservar material al release (allocated); consumir al completar
- accept-short: cerrar con menos qty
- split de OP (padre/hijo) puede ser fase 1.1

Estados OP:

```text
draft → released → scheduled → in_progress → completed → closed
                                 ↘ qc_hold → (rework | scrapped | closed)
                                 ↘ on_hold | cancelled
```

Work centers y scheduler básico (calendario + secuencia). Sin drivers de impresora.
Costo estimado vs real (material + mano de obra del work center).

### 7.8 Calidad

- rigor por tenant o por producto: off | basic | full
- plan de calidad: características variables y atributos
- inspección al completar OP; fotos en Storage
- taxonomía de defectos configurable
- gate: off | warn | block (block impide cerrar OP si QC fail)
- trazabilidad: lote al recibir OC; spool → OP → pedido (genealogía)
- SPC / control charts: fuera de MVP

### 7.9 Compras

- proveedores (RFC opcional, datos MX)
- OC: líneas, UOM de compra (KG para filamento), recepción parcial
- al recibir: kardex + lote + spools opcionales
- adjuntos (PDF factura del proveedor — documento de ellos, no nuestro CFDI)
- crear OC desde Buy List / low stock

### 7.10 MRP

Corre on-demand y opcionalmente al confirmar un pedido.

Inputs: pedidos abiertos, OP abiertas, on-hand, OC abiertas, BOM (explosión multinivel),
puntos de reorden, lead times, horizonte.

Outputs:

- net shortage
- planned orders (comprar o fabricar)
- Buy List → crear OC
- planned make → crear OP

No over-count: una demanda cubierta por OP no se vuelve a explotar como si fuera
solo el pedido. Tests de doble conteo obligatorios.

### 7.11 Dashboard (command center)

- pedidos por estado, OP atrasadas, low stock, AR (saldo por cobrar), QC pendientes
- no analytics PRO, no BI

---

## 8. Modelo de datos (mínimo)

Todas las tablas de negocio: `id uuid PK`, `tenant_id uuid NOT NULL`, timestamps,
`created_by`. Soft-delete solo donde importe auditoría.

Tablas plataforma:

- tenants (rfc unique, slug, status, country_code='MX', plan)
- tenant_memberships (user_id, tenant_id, role)
- platform_audit_log

Tablas tenant (ejemplos, no copies nombres de FilaOps si puedes evitarlo):

- organizations / company_profile (1 fila por tenant: RFC, régimen, logo, tax)
- locations
- users_profile (app metadata; auth.users es de Supabase)
- customers, customer_addresses, customer_tax_profiles
- products, product_variants, boms, bom_lines, routings, routing_ops, work_centers
- stock_balances, stock_ledgers, material_lots, spools
- quotes, quote_lines
- sales_orders, sales_order_lines
- production_orders, production_order_ops, production_consumptions
- purchase_orders, purchase_order_lines, receipts
- commercial_documents (prefacturas), commercial_document_lines
- payments, payment_allocations
- quality_plans, inspections, defects
- mrp_runs, mrp_planned_orders
- tax_rates (named; default IVA)
- number_sequences (folios por tenant + tipo)
- attachments (storage path)
- audit_events

Índices: `(tenant_id, …)` en todo. Nunca unique global de folio.

RLS: deny by default. Policies de SELECT/INSERT/UPDATE/DELETE por tenant_id.
Storage: bucket paths `tenants/{tenant_id}/...`.

---

## 9. API

REST versionado `/api/v1`.
Auth: Bearer JWT Supabase.
Header o claim obligatorio `tenant_id`. El server lo toma del JWT, NUNCA del body.
Idempotency-Key en POST de pagos, prefacturas, recepciones.
Errores: `{ code, message, details }` en español para el usuario, code estable en inglés.
Paginación cursor o page+limit. Filtros consistentes.

Módulos de rutas alineados a bounded contexts. Endpoints delgados; lógica en services.

---

## 10. Frontend UX (México)

- UI 100% en español; claves i18n (`t('orders.confirm')`)
- MXN con `Intl` locale `es-MX`
- fechas `es-MX`, timezone del tenant
- CP, estados de México, RFC con máscara/validación de formato
- teléfonos MX
- copy fiscal honesto: “Prefactura (no CFDI)”
- flujo order-to-cash visible: confirmar → prefactura → cobro → producir → surtir → embarcar
- no esconder acciones detrás de estados ilegales; deshabilitar + tooltip
- roles: sales no ve settings fiscales sensibles; production no ve márgenes si el tenant lo configura (default: production no ve precios de venta)
- responsive: desktop primero (taller), usable en tablet piso
- vacíos, errores y primeros pasos en español

Páginas MVP:

- Onboarding, Login, Invitaciones
- Command Center
- Clientes, Cotizaciones, Pedidos, Envíos
- Prefacturas, Cobranza
- Productos, BOM, Inventario, Kardex, Spools, Conteos
- Producción, Work Centers, Calidad, Trazabilidad
- Proveedores, OC, Buy List / MRP
- Equipo, Settings (empresa, impuestos, pagos, locaciones)
- (plataforma) consola de tenants — puede ser ruta simple protegida

---

## 11. Seguridad y cumplimiento (MVP)

- secretos en env / Supabase vault; nunca en el repo
- keys de MP/Conekta/Stripe cifradas at rest
- HTTPS only
- rate limit en login y webhooks
- audit log: login, cambios fiscales, voids, overrides de crédito, impersonation
- backups Supabase + plan de restore
- LFPDPPP: aviso de privacidad, consentimiento en onboarding, minimizar PII,
  retención configurable, export/delete de un tenant (derecho ARCO básico)
- no logs con RFC + montos en claro en terceros
- tests de aislamiento: usuario del tenant A no lee filas del tenant B (API + RLS)

---

## 12. Fases

### Fase 0 — cimientos (semana 1–2)

Tenants, Auth, RLS, onboarding, i18n, money/UOM, locaciones, RBAC, audit.
Prueba de aislamiento tenant A/B.

### Fase 1 — catálogo + inventario + spools

Productos, UOM filamento, kardex, ajustes, low stock.

### Fase 2 — ventas

Clientes fiscales MX, cotizaciones, pedidos, PDF, máquina de estados.

### Fase 3 — prefactura + cobranza MX

Documentos comerciales, ledger, SPEI/efectivo/COD/crédito/PPD,
adapter Mercado Pago + un adapter tarjeta (Conekta o Stripe).
Export contador.

### Fase 4 — producción + BOM + calidad

OP, reservas, consumo, QC gate, trazabilidad lote/spool.

### Fase 5 — compras + MRP

OC, recepción, planned orders, Buy List, tests de neteo.

### Fase 6 — pulido beta

Dashboard, invitaciones, permisos, seed demo, docs de operación.

### Fase 7+ (NO MVP)

Adapter CFDI + PAC, complemento de pagos, carta porte, nómina,
portal B2B, impresoras (Bambu/Klipper), multi-RFC, país #2,
DB dedicada enterprise.

Cada fase: migraciones + tests + UI usable. No mezclar 5 módulos en un PR.

---

## 13. Testing (obligatorio)

- Unit: money, UOM, tax MX (16%, exento, descuentos), state machines, MRP neteo
- Integration: RLS isolation, pagos parciales, void prefactura, recepción + spools
- API e2e: quote → order → prefactura → SPEI → OP → QC → ship
- Webhooks: replay e idempotencia
- No tests que dependan de PAC real. El puerto fiscal se mockea.

Cobertura mínima razonable en domain + fiscal + payments. No vanidad 100%.

---

## 14. No objetivos (rechazar scope creep)

- Copiar UI pixel-perfect de FilaOps
- Timbrado SAT, cancelación CFDI, XML 4.0 en MVP
- QuickBooks / CONTPAQi sync
- Shopify / Woo
- Agentes AI, intake studio
- Multi-moneda en la misma prefactura
- Multi-país activo (solo el puerto)
- Impresoras conectadas
- App nativa
- Microservicios, Kubernetes “por si acaso”
- SQL Server como segunda fuente de verdad

---

## 15. Criterios de aceptación del MVP (beta 1–10 tenants)

1. Puedo crear un tenant MX, configurar RFC e IVA 16%, invitar un usuario.
2. Tenant A no puede leer ningún dato de tenant B (prueba automatizada).
3. Cargo filamento en KG, el sistema almacena G y valúa en MXN/KG correctamente.
4. Cotizo con IVA desglosado, convierto a pedido, confirmo.
5. Emito prefactura (folio por tenant) cuyo PDF dice que NO es CFDI.
6. Registro abono SPEI + comprobante; el saldo queda partial; al liquidar, paid.
7. Un pedido a crédito respeta límite; override queda en audit.
8. Mercado Pago o Conekta/Stripe: un pago real en sandbox cierra saldo.
9. Libero OP, reserva material, consumo spool, QC pass, cierro, stock FG sube.
10. MRP detecta faltante y me deja crear OC; al recibir, stock y lote cuadran.
11. Exporto ZIP/CSV para el contador del mes.
12. UI en español, MXN, timezone CDMX.
13. Código, docs y nombres propios — cero artefactos FilaOps.

---

## 16. Cómo trabajar

- Repo nuevo, licencia propia (sugerida: proprietary mientras es SaaS; o BSL tuya).
- Conventional commits. PRs chicos.
- Migraciones SQL en `supabase/migrations`; nunca editar prod a mano.
- Feature flags solo si un adapter de pago no está listo.
- README: cómo levantar local (Supabase local o proyecto dev), seed, tests.
- Antes de “listo”: correr el flujo e2e como un taller en Guadalajara o CDMX
  (RFC de prueba, SPEI ficticio, un rollo de 1 kg, un pedido de 2 piezas).

Empieza por Fase 0. No diseñes 80 tablas perfectas: crea el esqueleto de tenancy,
RLS, CountryPolicy y el módulo de catálogo, y construye en el orden de las fases.

Cuando algo de FilaOps contradiga costumbre mexicana (ZIP vs CP, sales tax vs IVA,
Zelle vs SPEI, invoice vs prefactura), gana México.
