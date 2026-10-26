import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  index,
  foreignKey,
  jsonb,
  numeric,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const userAccounts = pgTable("user_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id").primaryKey().references(() => userAccounts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("pending"),
  countryCode: text("country_code").notNull().default("MX"),
  plan: text("plan").notNull().default("beta"),
  ...timestamps,
});

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => userAccounts.id),
    role: text("role").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("tenant_memberships_user_unique").on(table.userId),
  ],
);

export const platformAuditLog = pgTable("platform_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  tenantId: uuid("tenant_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companyProfiles = pgTable("company_profiles", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id),
  legalName: text("legal_name").notNull(),
  tradeName: text("trade_name"),
  rfc: text("rfc").notNull().unique(),
  taxRegime: text("tax_regime").notNull(),
  fiscalPostalCode: text("fiscal_postal_code").notNull(),
  currency: text("currency").notNull().default("MXN"),
  timezone: text("timezone").notNull().default("America/Mexico_City"),
  locale: text("locale").notNull().default("es-MX"),
  defaultTaxRateId: uuid("default_tax_rate_id").notNull(),
  defaultIsrRate: numeric("default_isr_rate", { precision: 8, scale: 6 }).notNull().default("0"),
  preinvoiceSeries: text("preinvoice_series").notNull().default("A"),
  qcGate: text("qc_gate").notNull().default("warn"),
  privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  foreignKey({ name: "company_profiles_default_tax_rate_fk", columns: [table.tenantId, table.defaultTaxRateId], foreignColumns: [taxRates.tenantId, taxRates.id] }),
]);

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("warehouse"),
  postalCode: text("postal_code").notNull(),
  state: text("state").notNull(),
  countryCode: text("country_code").notNull().default("MX"),
  isDefault: boolean("is_default").notNull().default(false),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("erp_locations_tenant_id_key").on(table.tenantId, table.id),
]);

export const taxRates = pgTable("tax_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 6, scale: 4 }).notNull(),
  countryCode: text("country_code").notNull().default("MX"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  unique("tax_rates_tenant_id_id_unique").on(table.tenantId, table.id),
]);

export const paymentMethodSettings = pgTable("payment_method_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  method: text("method").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  ...timestamps,
});

export const numberSequences = pgTable(
  "number_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    docType: text("doc_type").notNull(),
    series: text("series").notNull(),
    nextFolio: bigint("next_folio", { mode: "bigint" }).notNull().default(1n),
    ...timestamps,
  },
  (table) => [
    unique("number_sequences_unique").on(table.tenantId, table.docType, table.series),
  ],
);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  productType: text("product_type").notNull().generatedAlwaysAs(sql`case when item_class='finished_good' and supply_mode='buy' then 'resale' else item_class end`),
  itemClass: text("item_class").notNull(),
  supplyMode: text("supply_mode").notNull(),
  status: text("status").notNull().default("active"),
  stockUom: text("stock_uom").notNull().default("EA"),
  purchaseUom: text("purchase_uom").notNull().default("EA"),
  uomFactor: numeric("uom_factor", { precision: 12, scale: 4 }).notNull().default("1"),
  costMinor: bigint("cost_minor", { mode: "bigint" }),
  salePriceMinor: bigint("sale_price_minor", { mode: "bigint" }),
  qcRigor: text("qc_rigor").notNull().default("off"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("erp_products_tenant_id_key").on(table.tenantId, table.id),
]);

export const filaments = pgTable(
  "filaments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    material: text("material").notNull(),
    color: text("color").notNull(),
    diameterMm: numeric("diameter_mm", { precision: 4, scale: 2 }).notNull(),
    costMinor: bigint("cost_minor", { mode: "bigint" }),
    salePriceMinor: bigint("sale_price_minor", { mode: "bigint" }),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("filaments_sku_unique").on(table.tenantId, table.sku),
    uniqueIndex("erp_filaments_tenant_id_key").on(table.tenantId, table.id),
  ],
);

export const productsVisible = pgView("products_visible", {
  id: uuid("id"),
  tenantId: uuid("tenant_id"),
  sku: text("sku"),
  name: text("name"),
  productType: text("product_type"),
  itemClass: text("item_class"),
  supplyMode: text("supply_mode"),
  status: text("status"),
  stockUom: text("stock_uom"),
  purchaseUom: text("purchase_uom"),
  uomFactor: numeric("uom_factor", { precision: 12, scale: 4 }),
  costMinor: bigint("cost_minor", { mode: "bigint" }),
  salePriceMinor: bigint("sale_price_minor", { mode: "bigint" }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  qcRigor: text("qc_rigor"),
}).existing();

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stockBalances = pgTable("stock_balances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  productId: uuid("product_id"),
  filamentId: uuid("filament_id"),
  locationId: uuid("location_id").notNull(),
  onHand: numeric("on_hand", { precision: 14, scale: 4 }).notNull().default("0"),
  allocated: numeric("allocated", { precision: 14, scale: 4 }).notNull().default("0"),
  reorderPoint: numeric("reorder_point", { precision: 14, scale: 4 }).notNull().default("0"),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  foreignKey({ name: "erp_stock_balances_filament_id_fk", columns: [table.tenantId, table.filamentId], foreignColumns: [filaments.tenantId, filaments.id] }),
  foreignKey({ name: "erp_stock_balances_location_id_fk", columns: [table.tenantId, table.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  foreignKey({ name: "erp_stock_balances_product_id_fk", columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }),
]);

export const stockLedgers = pgTable("stock_ledgers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  productId: uuid("product_id"),
  filamentId: uuid("filament_id"),
  locationId: uuid("location_id").notNull(),
  kind: text("kind").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  reason: text("reason").notNull(),
  valueMinor: bigint("value_minor", { mode: "bigint" }),
  referenceType: text("reference_type"),
  referenceId: uuid("reference_id"),
  lotId: uuid("lot_id"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "erp_stock_ledgers_filament_id_fk", columns: [table.tenantId, table.filamentId], foreignColumns: [filaments.tenantId, filaments.id] }),
  foreignKey({ name: "erp_stock_ledgers_location_id_fk", columns: [table.tenantId, table.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  foreignKey({ name: "erp_stock_ledgers_lot_id_fk", columns: [table.tenantId, table.lotId], foreignColumns: [materialLots.tenantId, materialLots.id] }),
  foreignKey({ name: "erp_stock_ledgers_product_id_fk", columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }),
]);

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  kind: text("kind").notNull(),
  legalName: text("legal_name").notNull(),
  rfc: text("rfc"),
  phone: text("phone"),
  paymentTerms: text("payment_terms").notNull().default("pue"),
  creditLimitMinor: bigint("credit_limit_minor", { mode: "bigint" }).notNull().default(0n),
  status: text("status").notNull().default("active"),
  taxRegime: text("tax_regime"),
  cfdiUse: text("cfdi_use").notNull().default("G03"),
  billingEmail: text("billing_email"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("erp_customers_tenant_id_key").on(table.tenantId, table.id),
]);

export const customerAddresses = pgTable("customer_addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  customerId: uuid("customer_id").notNull(),
  kind: text("kind").notNull(),
  line1: text("line1").notNull(),
  neighborhood: text("neighborhood").notNull(),
  postalCode: text("postal_code").notNull(),
  state: text("state").notNull(),
  countryCode: text("country_code").notNull().default("MX"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "erp_customer_addresses_customer_id_fk", columns: [table.tenantId, table.customerId], foreignColumns: [customers.tenantId, customers.id] }),
]);

export const serviceOfferings = pgTable(
  "service_offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    unit: text("unit").notNull().default("servicio"),
    costMinor: bigint("cost_minor", { mode: "bigint" }),
    salePriceMinor: bigint("sale_price_minor", { mode: "bigint" }),
    terms: text("terms").notNull().default(""),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("service_offerings_code_unique").on(table.tenantId, table.code),
    uniqueIndex("erp_service_offerings_tenant_id_key").on(table.tenantId, table.id),
  ],
);

export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  folio: text("folio").notNull(),
  customerId: uuid("customer_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerRfc: text("customer_rfc"),
  status: text("status").notNull().default("draft"),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  currency: text("currency").notNull().default("MXN"),
  subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
  vatRate: numeric("vat_rate", { precision: 8, scale: 6 }).notNull().default("0.16"),
  isrRate: numeric("isr_rate", { precision: 8, scale: 6 }).notNull().default("0"),
  isrWithheldMinor: bigint("isr_withheld_minor", { mode: "bigint" }).notNull().default(0n),
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
  serviceTerms: text("service_terms"),
  paymentTerms: text("payment_terms").notNull().default("pue"),
  depositPercent: integer("deposit_percent").notNull().default(0),
  paymentNotes: text("payment_notes"),
  leadTimeDays: integer("lead_time_days"),
  mode: text("mode").notNull().default("products"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  foreignKey({ name: "erp_quotes_customer_id_fk", columns: [table.tenantId, table.customerId], foreignColumns: [customers.tenantId, customers.id] }),
  uniqueIndex("erp_quotes_tenant_id_key").on(table.tenantId, table.id),
]);

export const quotePrints = pgTable("quote_prints", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  quoteId: uuid("quote_id").notNull(),
  position: integer("position").notNull().default(0),
  name: text("name").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "erp_quote_prints_quote_id_fk", columns: [table.tenantId, table.quoteId], foreignColumns: [quotes.tenantId, quotes.id] }),
  uniqueIndex("erp_quote_prints_tenant_id_key").on(table.tenantId, table.id),
]);

export const quoteLines = pgTable("quote_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  quoteId: uuid("quote_id").notNull(),
  printId: uuid("print_id"),
  position: integer("position").notNull().default(0),
  catalogId: uuid("catalog_id"),
  sku: text("sku").notNull().default(""),
  lineKind: text("line_kind").notNull().default("product"),
  terms: text("terms"),
  description: text("description").notNull(),
  uom: text("uom").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
  netMinor: bigint("net_minor", { mode: "bigint" }).notNull(),
  vatRate: numeric("vat_rate", { precision: 8, scale: 6 }).notNull().default("0.16"),
  vatExempt: boolean("vat_exempt").notNull().default(false),
  isrRate: numeric("isr_rate", { precision: 8, scale: 6 }).notNull().default("0"),
  isrWithheldMinor: bigint("isr_withheld_minor", { mode: "bigint" }).notNull().default(0n),
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "erp_quote_lines_print_id_fk", columns: [table.tenantId, table.printId], foreignColumns: [quotePrints.tenantId, quotePrints.id] }),
  foreignKey({ name: "erp_quote_lines_quote_id_fk", columns: [table.tenantId, table.quoteId], foreignColumns: [quotes.tenantId, quotes.id] }),
]);

export const salesOrders = pgTable("sales_orders", {
  salesChannel: text("sales_channel").notNull().default("order"),
  cashTenderedMinor: bigint("cash_tendered_minor", { mode: "bigint" }),
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  folio: text("folio").notNull(),
  quoteId: uuid("quote_id"),
  customerId: uuid("customer_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerRfc: text("customer_rfc"),
  status: text("status").notNull().default("draft"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  fulfillmentStatus: text("fulfillment_status").notNull().default("pending"),
  currency: text("currency").notNull().default("MXN"),
  subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
  shippingMinor: bigint("shipping_minor", { mode: "bigint" }).notNull().default(0n),
  vatRate: numeric("vat_rate", { precision: 8, scale: 6 }).notNull().default("0.16"),
  isrRate: numeric("isr_rate", { precision: 8, scale: 6 }).notNull().default("0"),
  isrWithheldMinor: bigint("isr_withheld_minor", { mode: "bigint" }).notNull().default(0n),
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
  creditOverrideReason: text("credit_override_reason"),
  locationId: uuid("location_id"),
  promisedDate: date("promised_date", { mode: "string" }),
  shipTo: jsonb("ship_to"),
  carrier: text("carrier"),
  trackingNumber: text("tracking_number"),
  shipmentFolio: text("shipment_folio"),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  holdReason: text("hold_reason"),
  cancelReason: text("cancel_reason"),
  closedShortReason: text("closed_short_reason"),
  notes: text("notes"),
  serviceTerms: text("service_terms"),
  paymentTerms: text("payment_terms"),
  depositPercent: integer("deposit_percent").notNull().default(0),
  paymentNotes: text("payment_notes"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  foreignKey({ name: "erp_sales_orders_customer_id_fk", columns: [table.tenantId, table.customerId], foreignColumns: [customers.tenantId, customers.id] }),
  foreignKey({ name: "erp_sales_orders_location_id_fk", columns: [table.tenantId, table.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  foreignKey({ name: "erp_sales_orders_quote_id_fk", columns: [table.tenantId, table.quoteId], foreignColumns: [quotes.tenantId, quotes.id] }),
  uniqueIndex("erp_sales_orders_tenant_id_key").on(table.tenantId, table.id),
]);

export const salesOrderPrints = pgTable("sales_order_prints", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  salesOrderId: uuid("sales_order_id").notNull(),
  position: integer("position").notNull().default(0),
  name: text("name").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  resolution: text("resolution").notNull().default("pending"),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "erp_sales_order_prints_sales_order_id_fk", columns: [table.tenantId, table.salesOrderId], foreignColumns: [salesOrders.tenantId, salesOrders.id] }),
  uniqueIndex("erp_sales_order_prints_tenant_id_key").on(table.tenantId, table.id),
]);

export const salesOrderLines = pgTable("sales_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  salesOrderId: uuid("sales_order_id").notNull(),
  printId: uuid("print_id"),
  productId: uuid("product_id"),
  filamentId: uuid("filament_id"),
  serviceId: uuid("service_id"),
  lineKind: text("line_kind").notNull().default("product"),
  terms: text("terms"),
  resolution: text("resolution").notNull().default("pending"),
  resolutionNote: text("resolution_note"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
  netMinor: bigint("net_minor", { mode: "bigint" }).notNull(),
  vatRate: numeric("vat_rate", { precision: 8, scale: 6 }).notNull().default("0.16"),
  vatExempt: boolean("vat_exempt").notNull().default(false),
  isrRate: numeric("isr_rate", { precision: 8, scale: 6 }).notNull().default("0"),
  isrWithheldMinor: bigint("isr_withheld_minor", { mode: "bigint" }).notNull().default(0n),
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
  position: integer("position").notNull().default(0),
  reservedQty: numeric("reserved_qty", { precision: 14, scale: 4 }).notNull().default("0"),
  shippedQty: numeric("shipped_qty", { precision: 14, scale: 4 }).notNull().default("0"),
  closedShortQty: numeric("closed_short_qty", { precision: 14, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "erp_sales_order_lines_filament_id_fk", columns: [table.tenantId, table.filamentId], foreignColumns: [filaments.tenantId, filaments.id] }),
  foreignKey({ name: "erp_sales_order_lines_print_id_fk", columns: [table.tenantId, table.printId], foreignColumns: [salesOrderPrints.tenantId, salesOrderPrints.id] }), // SET NULL de la columna individual: ver migraciones (tenant_id se conserva).
  foreignKey({ name: "erp_sales_order_lines_product_id_fk", columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }),
  foreignKey({ name: "erp_sales_order_lines_sales_order_id_fk", columns: [table.tenantId, table.salesOrderId], foreignColumns: [salesOrders.tenantId, salesOrders.id] }),
  foreignKey({ name: "erp_sales_order_lines_service_id_fk", columns: [table.tenantId, table.serviceId], foreignColumns: [serviceOfferings.tenantId, serviceOfferings.id] }),
]);

export const salesOrderEvents = pgTable("sales_order_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  salesOrderId: uuid("sales_order_id").notNull(),
  kind: text("kind").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "erp_sales_order_events_sales_order_id_fk", columns: [table.tenantId, table.salesOrderId], foreignColumns: [salesOrders.tenantId, salesOrders.id] }),
]);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  salesOrderId: uuid("sales_order_id").notNull(),
  method: text("method").notNull(),
  kind: text("kind").notNull().default("payment"),
  status: text("status").notNull().default("completed"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  reference: text("reference"),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "erp_payments_sales_order_id_fk", columns: [table.tenantId, table.salesOrderId], foreignColumns: [salesOrders.tenantId, salesOrders.id] }),
]);

// Historial de operaciones atómicas. Solo se consulta con privilegios del servidor.
export const idempotencyRequests = pgTable("idempotency_requests", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id").notNull().references(() => userAccounts.id),
  operation: text("operation").notNull(),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull().default("processing"),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.userId, table.operation, table.key] }),
]);

const qty = (name: string) => numeric(name, { precision: 14, scale: 4 });
const tenantId = () => uuid("tenant_id").notNull().references(() => tenants.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const spools = pgTable(
  "spools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    spoolNumber: text("spool_number").notNull(),
    filamentId: uuid("filament_id").notNull(),
    locationId: uuid("location_id").notNull(),
    lotId: uuid("lot_id"),
    initialGrams: qty("initial_grams").notNull(),
    currentGrams: qty("current_grams").notNull(),
    status: text("status").notNull().default("available"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("spools_number_unique").on(table.tenantId, table.spoolNumber),
    foreignKey({ name: "erp_spools_filament_id_fk", columns: [table.tenantId, table.filamentId], foreignColumns: [filaments.tenantId, filaments.id] }),
    foreignKey({ name: "erp_spools_location_id_fk", columns: [table.tenantId, table.locationId], foreignColumns: [locations.tenantId, locations.id] }),
    foreignKey({ name: "erp_spools_lot_id_fk", columns: [table.tenantId, table.lotId], foreignColumns: [materialLots.tenantId, materialLots.id] }),
    uniqueIndex("erp_spools_tenant_id_key").on(table.tenantId, table.id),
  ],
);

export const spoolEvents = pgTable("spool_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  spoolId: uuid("spool_id").notNull(),
  kind: text("kind").notNull(),
  grams: qty("grams").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ name: "erp_spool_events_spool_id_fk", columns: [table.tenantId, table.spoolId], foreignColumns: [spools.tenantId, spools.id] }),
]);

export const materialLots = pgTable("material_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productId: uuid("product_id"),
  filamentId: uuid("filament_id"),
  lotNumber: text("lot_number").notNull(),
  vendorLot: text("vendor_lot"),
  source: text("source").notNull().default("manual"),
  receivedQty: qty("received_qty").notNull().default("0"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  vendorId: uuid("vendor_id"),
  expenseId: uuid("expense_id"),
  receiptId: uuid("receipt_id"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ name: "erp_material_lots_filament_id_fk", columns: [table.tenantId, table.filamentId], foreignColumns: [filaments.tenantId, filaments.id] }),
  foreignKey({ name: "erp_material_lots_product_id_fk", columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }),
  foreignKey({ name: "erp_material_lots_expense_id_fk", columns: [table.tenantId, table.expenseId], foreignColumns: [expenses.tenantId, expenses.id] }),
  foreignKey({ name: "erp_material_lots_receipt_id_fk", columns: [table.tenantId, table.receiptId], foreignColumns: [receipts.tenantId, receipts.id] }),
  foreignKey({ name: "erp_material_lots_vendor_id_fk", columns: [table.tenantId, table.vendorId], foreignColumns: [vendors.tenantId, vendors.id] }),
  uniqueIndex("erp_material_lots_tenant_id_key").on(table.tenantId, table.id),
]);

export const workCenters = pgTable("work_centers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("printer"),
  hourlyRateMinor: bigint("hourly_rate_minor", { mode: "bigint" }).notNull().default(0n),
  capacityHours: numeric("capacity_hours", { precision: 6, scale: 2 }).notNull().default("8"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("erp_work_centers_tenant_id_key").on(table.tenantId, table.id),
]);

export const routings = pgTable("routings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productId: uuid("product_id").notNull(),
  version: integer("version").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ name: "erp_routings_product_id_fk", columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }),
  uniqueIndex("erp_routings_tenant_id_key").on(table.tenantId, table.id),
]);

export const routingOperations = pgTable("routing_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  routingId: uuid("routing_id").notNull(),
  sequence: integer("sequence").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  workCenterId: uuid("work_center_id").notNull(),
  setupMinutes: numeric("setup_minutes", { precision: 10, scale: 2 }).notNull().default("0"),
  runMinutes: numeric("run_minutes", { precision: 10, scale: 2 }).notNull().default("0"),
}, (table) => [
  foreignKey({ name: "erp_routing_operations_routing_id_fk", columns: [table.tenantId, table.routingId], foreignColumns: [routings.tenantId, routings.id] }),
  foreignKey({ name: "erp_routing_operations_work_center_id_fk", columns: [table.tenantId, table.workCenterId], foreignColumns: [workCenters.tenantId, workCenters.id] }),
]);

export const boms = pgTable("boms", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productId: uuid("product_id").notNull(),
  version: integer("version").notNull(),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ name: "erp_boms_product_id_fk", columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }),
  uniqueIndex("erp_boms_tenant_id_key").on(table.tenantId, table.id),
]);

export const bomLines = pgTable("bom_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  bomId: uuid("bom_id").notNull(),
  componentProductId: uuid("component_product_id"),
  componentFilamentId: uuid("component_filament_id"),
  quantity: qty("quantity").notNull(),
  scrapPct: numeric("scrap_pct", { precision: 6, scale: 2 }).notNull().default("0"),
  sequence: integer("sequence").notNull().default(1),
}, (table) => [
  foreignKey({ name: "erp_bom_lines_bom_id_fk", columns: [table.tenantId, table.bomId], foreignColumns: [boms.tenantId, boms.id] }),
  foreignKey({ name: "erp_bom_lines_component_filament_id_fk", columns: [table.tenantId, table.componentFilamentId], foreignColumns: [filaments.tenantId, filaments.id] }),
  foreignKey({ name: "erp_bom_lines_component_product_id_fk", columns: [table.tenantId, table.componentProductId], foreignColumns: [products.tenantId, products.id] }),
]);

export const bomServiceLines = pgTable("bom_service_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  bomId: uuid("bom_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  quantity: qty("quantity").notNull(),
}, (table) => [
  foreignKey({ name: "bom_service_lines_bom_fk", columns: [table.tenantId, table.bomId], foreignColumns: [boms.tenantId, boms.id] }),
  foreignKey({ name: "bom_service_lines_service_fk", columns: [table.tenantId, table.serviceId], foreignColumns: [serviceOfferings.tenantId, serviceOfferings.id] }),
  uniqueIndex("bom_service_lines_unique").on(table.tenantId, table.bomId, table.serviceId),
  index("bom_service_lines_service_idx").on(table.tenantId, table.serviceId),
]);

export const productionOrders = pgTable("production_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  folio: text("folio").notNull(),
  productId: uuid("product_id").notNull(),
  locationId: uuid("location_id").notNull(),
  salesOrderId: uuid("sales_order_id"),
  source: text("source").notNull().default("manual"),
  kind: text("kind").notNull().default("make_to_stock"),
  status: text("status").notNull().default("draft"),
  priority: integer("priority").notNull().default(3),
  quantityOrdered: qty("quantity_ordered").notNull(),
  quantityCompleted: qty("quantity_completed").notNull().default("0"),
  quantityScrapped: qty("quantity_scrapped").notNull().default("0"),
  dueDate: date("due_date", { mode: "string" }),
  scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  bomId: uuid("bom_id"),
  routingId: uuid("routing_id"),
  serviceCostMinor: bigint("service_cost_minor", { mode: "bigint" }).notNull().default(0n),
  estimatedCostMinor: bigint("estimated_cost_minor", { mode: "bigint" }),
  actualCostMinor: bigint("actual_cost_minor", { mode: "bigint" }),
  qcStatus: text("qc_status").notNull().default("not_required"),
  scrapReason: text("scrap_reason"),
  shortReason: text("short_reason"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  foreignKey({ name: "erp_production_orders_bom_id_fk", columns: [table.tenantId, table.bomId], foreignColumns: [boms.tenantId, boms.id] }),
  foreignKey({ name: "erp_production_orders_location_id_fk", columns: [table.tenantId, table.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  foreignKey({ name: "erp_production_orders_product_id_fk", columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }),
  foreignKey({ name: "erp_production_orders_routing_id_fk", columns: [table.tenantId, table.routingId], foreignColumns: [routings.tenantId, routings.id] }),
  foreignKey({ name: "erp_production_orders_sales_order_id_fk", columns: [table.tenantId, table.salesOrderId], foreignColumns: [salesOrders.tenantId, salesOrders.id] }),
  uniqueIndex("erp_production_orders_tenant_id_key").on(table.tenantId, table.id),
]);

export const productionOrderMaterials = pgTable("production_order_materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productionOrderId: uuid("production_order_id").notNull(),
  componentProductId: uuid("component_product_id"),
  componentFilamentId: uuid("component_filament_id"),
  requiredQty: qty("required_qty").notNull(),
  allocatedQty: qty("allocated_qty").notNull().default("0"),
  consumedQty: qty("consumed_qty").notNull().default("0"),
  unitCostMinor: numeric("unit_cost_minor", { precision: 18, scale: 6 }).notNull().default("0"),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ name: "erp_production_order_materials_component_filament_id_fk", columns: [table.tenantId, table.componentFilamentId], foreignColumns: [filaments.tenantId, filaments.id] }),
  foreignKey({ name: "erp_production_order_materials_component_product_id_fk", columns: [table.tenantId, table.componentProductId], foreignColumns: [products.tenantId, products.id] }),
  foreignKey({ name: "erp_production_order_materials_production_order_id_fk", columns: [table.tenantId, table.productionOrderId], foreignColumns: [productionOrders.tenantId, productionOrders.id] }),
  uniqueIndex("erp_production_order_materials_tenant_id_key").on(table.tenantId, table.id),
]);

export const productionOrderOperations = pgTable("production_order_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productionOrderId: uuid("production_order_id").notNull(),
  sequence: integer("sequence").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  workCenterId: uuid("work_center_id").notNull(),
  plannedMinutes: numeric("planned_minutes", { precision: 10, scale: 2 }).notNull().default("0"),
  hourlyRateMinor: bigint("hourly_rate_minor", { mode: "bigint" }).notNull().default(0n),
  status: text("status").notNull().default("pending"),
  actualMinutes: numeric("actual_minutes", { precision: 10, scale: 2 }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  foreignKey({ name: "erp_production_order_operations_production_order_id_fk", columns: [table.tenantId, table.productionOrderId], foreignColumns: [productionOrders.tenantId, productionOrders.id] }),
  foreignKey({ name: "erp_production_order_operations_work_center_id_fk", columns: [table.tenantId, table.workCenterId], foreignColumns: [workCenters.tenantId, workCenters.id] }),
]);

export const productionConsumptions = pgTable("production_consumptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productionOrderId: uuid("production_order_id").notNull(),
  materialId: uuid("material_id").notNull(),
  productId: uuid("product_id"),
  filamentId: uuid("filament_id"),
  lotId: uuid("lot_id"),
  quantity: qty("quantity").notNull(),
  valueMinor: bigint("value_minor", { mode: "bigint" }).notNull().default(0n),
  source: text("source").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ name: "erp_production_consumptions_filament_id_fk", columns: [table.tenantId, table.filamentId], foreignColumns: [filaments.tenantId, filaments.id] }),
  foreignKey({ name: "erp_production_consumptions_lot_id_fk", columns: [table.tenantId, table.lotId], foreignColumns: [materialLots.tenantId, materialLots.id] }),
  foreignKey({ name: "erp_production_consumptions_material_id_fk", columns: [table.tenantId, table.materialId], foreignColumns: [productionOrderMaterials.tenantId, productionOrderMaterials.id] }),
  foreignKey({ name: "erp_production_consumptions_product_id_fk", columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }),
  foreignKey({ name: "erp_production_consumptions_production_order_id_fk", columns: [table.tenantId, table.productionOrderId], foreignColumns: [productionOrders.tenantId, productionOrders.id] }),
]);

export const defectTypes = pgTable("defect_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("erp_defect_types_tenant_id_key").on(table.tenantId, table.id),
]);

export const inspections = pgTable("inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productionOrderId: uuid("production_order_id").notNull(),
  result: text("result").notNull(),
  qtyPassed: qty("qty_passed").notNull(),
  qtyFailed: qty("qty_failed").notNull().default("0"),
  defectTypeId: uuid("defect_type_id"),
  disposition: text("disposition"),
  notes: text("notes"),
  photoPath: text("photo_path"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ name: "erp_inspections_defect_type_id_fk", columns: [table.tenantId, table.defectTypeId], foreignColumns: [defectTypes.tenantId, defectTypes.id] }),
  foreignKey({ name: "erp_inspections_production_order_id_fk", columns: [table.tenantId, table.productionOrderId], foreignColumns: [productionOrders.tenantId, productionOrders.id] }),
]);

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  rfc: text("rfc"),
  email: text("email"),
  phone: text("phone"),
  paymentTerms: text("payment_terms").notNull().default("contado"),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("erp_vendors_tenant_id_key").on(table.tenantId, table.id),
]);

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  folio: text("folio").notNull(),
  expenseId: uuid("expense_id"),
  vendorId: uuid("vendor_id"),
  sourceFolio: text("source_folio"),
  locationId: uuid("location_id").notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ name: "erp_receipts_location_id_fk", columns: [table.tenantId, table.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  foreignKey({ name: "erp_receipts_expense_id_fk", columns: [table.tenantId, table.expenseId], foreignColumns: [expenses.tenantId, expenses.id] }),
  foreignKey({ name: "erp_receipts_vendor_id_fk", columns: [table.tenantId, table.vendorId], foreignColumns: [vendors.tenantId, vendors.id] }),
  uniqueIndex("erp_receipts_tenant_id_key").on(table.tenantId, table.id),
]);

export const receiptLines = pgTable("receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  receiptId: uuid("receipt_id").notNull(),
  description: text("description").notNull().default(""),
  purchaseUom: text("purchase_uom").notNull().default("PZA"),
  uomFactor: numeric("uom_factor", { precision: 12, scale: 4 }).notNull().default("1"),
  unitCostMinor: bigint("unit_cost_minor", { mode: "bigint" }).notNull().default(0n),
  productId: uuid("product_id"),
  filamentId: uuid("filament_id"),
  quantity: qty("quantity").notNull(),
  stockQuantity: qty("stock_quantity").notNull(),
  lotId: uuid("lot_id"),
  valueMinor: bigint("value_minor", { mode: "bigint" }).notNull().default(0n),
}, (table) => [
  foreignKey({ name: "erp_receipt_lines_filament_id_fk", columns: [table.tenantId, table.filamentId], foreignColumns: [filaments.tenantId, filaments.id] }),
  foreignKey({ name: "erp_receipt_lines_lot_id_fk", columns: [table.tenantId, table.lotId], foreignColumns: [materialLots.tenantId, materialLots.id] }),
  foreignKey({ name: "erp_receipt_lines_product_id_fk", columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }),
  foreignKey({ name: "erp_receipt_lines_receipt_id_fk", columns: [table.tenantId, table.receiptId], foreignColumns: [receipts.tenantId, receipts.id] }),
]);

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  folio: text("folio").notNull(),
  kind: text("kind").notNull(),
  productId: uuid("product_id"),
  filamentId: uuid("filament_id"),
  serviceId: uuid("service_id"),
  description: text("description").notNull(),
  quantity: qty("quantity").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  occurredOn: date("occurred_on").notNull(),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ name: "erp_expenses_filament_id_fk", columns: [table.tenantId, table.filamentId], foreignColumns: [filaments.tenantId, filaments.id] }),
  foreignKey({ name: "erp_expenses_product_id_fk", columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }),
  foreignKey({ name: "erp_expenses_service_id_fk", columns: [table.tenantId, table.serviceId], foreignColumns: [serviceOfferings.tenantId, serviceOfferings.id] }),
  uniqueIndex("erp_expenses_tenant_id_key").on(table.tenantId, table.id),
]);

export const expensePayments = pgTable("expense_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  expenseId: uuid("expense_id").notNull(),
  paidOn: date("paid_on").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ name: "erp_expense_payments_expense_id_fk", columns: [table.tenantId, table.expenseId], foreignColumns: [expenses.tenantId, expenses.id] }),
]);

export const commercialDocuments = pgTable("commercial_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  kind: text("kind").notNull().default("prefactura"),
  salesOrderId: uuid("sales_order_id").notNull(),
  series: text("series").notNull(),
  folio: integer("folio").notNull(),
  status: text("status").notNull().default("issued"),
  title: text("title").notNull(),
  emitter: jsonb("emitter").notNull(),
  receiver: jsonb("receiver").notNull(),
  intendedPayment: text("intended_payment").notNull(),
  satPaymentForm: text("sat_payment_form").notNull(),
  currency: text("currency").notNull().default("MXN"),
  subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
  shippingMinor: bigint("shipping_minor", { mode: "bigint" }).notNull().default(0n),
  vatRate: numeric("vat_rate", { precision: 8, scale: 6 }).notNull().default("0.16"),
  isrRate: numeric("isr_rate", { precision: 8, scale: 6 }).notNull().default("0"),
  isrWithheldMinor: bigint("isr_withheld_minor", { mode: "bigint" }).notNull().default(0n),
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
  incomplete: boolean("incomplete").notNull().default(false),
  warnings: jsonb("warnings").notNull().default([]),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  voidReason: text("void_reason"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedBy: uuid("voided_by"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
}, (table) => [
  foreignKey({ name: "erp_commercial_documents_sales_order_id_fk", columns: [table.tenantId, table.salesOrderId], foreignColumns: [salesOrders.tenantId, salesOrders.id] }),
  uniqueIndex("erp_commercial_documents_tenant_id_key").on(table.tenantId, table.id),
]);

export const commercialDocumentLines = pgTable("commercial_document_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  documentId: uuid("document_id").notNull(),
  description: text("description").notNull(),
  quantity: qty("quantity").notNull(),
  unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
  netMinor: bigint("net_minor", { mode: "bigint" }).notNull(),
  vatRate: numeric("vat_rate", { precision: 8, scale: 6 }).notNull().default("0.16"),
  vatExempt: boolean("vat_exempt").notNull().default(false),
  isrRate: numeric("isr_rate", { precision: 8, scale: 6 }).notNull().default("0"),
  isrWithheldMinor: bigint("isr_withheld_minor", { mode: "bigint" }).notNull().default(0n),
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
}, (table) => [
  foreignKey({ name: "erp_commercial_document_lines_document_id_fk", columns: [table.tenantId, table.documentId], foreignColumns: [commercialDocuments.tenantId, commercialDocuments.id] }),
]);
