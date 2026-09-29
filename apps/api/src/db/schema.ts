import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  unique,
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
  rfc: text("rfc").notNull().unique(),
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
  (table) => [unique("tenant_memberships_user_unique").on(table.userId)],
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
  defaultVatRate: numeric("default_vat_rate", { precision: 6, scale: 4 }).notNull().default("0.1600"),
  preinvoiceSeries: text("preinvoice_series").notNull().default("A"),
  qcGate: text("qc_gate").notNull().default("warn"),
  privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
});

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
});

export const taxRates = pgTable("tax_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 6, scale: 4 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  countryCode: text("country_code").notNull().default("MX"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
});

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
  (table) => [unique("number_sequences_unique").on(table.tenantId, table.docType, table.series)],
);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  productType: text("product_type").notNull(),
  status: text("status").notNull().default("active"),
  material: text("material"),
  color: text("color"),
  diameterMm: numeric("diameter_mm", { precision: 4, scale: 2 }),
  stockUom: text("stock_uom").notNull().default("G"),
  purchaseUom: text("purchase_uom").notNull().default("KG"),
  uomFactor: numeric("uom_factor", { precision: 12, scale: 4 }).notNull().default("1000"),
  costMinor: bigint("cost_minor", { mode: "bigint" }),
  salePriceMinor: bigint("sale_price_minor", { mode: "bigint" }),
  qcRigor: text("qc_rigor").notNull().default("off"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
});

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
  (table) => [unique("filaments_sku_unique").on(table.tenantId, table.sku)],
);

export const productsVisible = pgView("products_visible", {
  id: uuid("id"),
  tenantId: uuid("tenant_id"),
  sku: text("sku"),
  name: text("name"),
  productType: text("product_type"),
  status: text("status"),
  material: text("material"),
  color: text("color"),
  diameterMm: numeric("diameter_mm", { precision: 4, scale: 2 }),
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
  productId: uuid("product_id").references(() => products.id),
  filamentId: uuid("filament_id").references(() => filaments.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  onHand: numeric("on_hand", { precision: 14, scale: 4 }).notNull().default("0"),
  allocated: numeric("allocated", { precision: 14, scale: 4 }).notNull().default("0"),
  reorderPoint: numeric("reorder_point", { precision: 14, scale: 4 }).notNull().default("0"),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
});

export const stockLedgers = pgTable("stock_ledgers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  productId: uuid("product_id").references(() => products.id),
  filamentId: uuid("filament_id").references(() => filaments.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  kind: text("kind").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  reason: text("reason").notNull(),
  valueMinor: bigint("value_minor", { mode: "bigint" }),
  referenceType: text("reference_type"),
  referenceId: uuid("reference_id"),
  lotId: uuid("lot_id"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
});

export const customerAddresses = pgTable("customer_addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  kind: text("kind").notNull(),
  line1: text("line1").notNull(),
  neighborhood: text("neighborhood").notNull(),
  postalCode: text("postal_code").notNull(),
  state: text("state").notNull(),
  countryCode: text("country_code").notNull().default("MX"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serviceOfferings = pgTable(
  "service_offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    unit: text("unit").notNull().default("servicio"),
    salePriceMinor: bigint("sale_price_minor", { mode: "bigint" }),
    terms: text("terms").notNull().default(""),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").notNull(),
    ...timestamps,
  },
  (table) => [unique("service_offerings_code_unique").on(table.tenantId, table.code)],
);

export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  folio: text("folio").notNull(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  customerName: text("customer_name").notNull(),
  customerRfc: text("customer_rfc"),
  status: text("status").notNull().default("draft"),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  currency: text("currency").notNull().default("MXN"),
  subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
  serviceTerms: text("service_terms"),
  paymentTerms: text("payment_terms").notNull().default("pue"),
  mode: text("mode").notNull().default("products"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
});

export const quotePrints = pgTable("quote_prints", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id),
  position: integer("position").notNull().default(0),
  name: text("name").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quoteLines = pgTable("quote_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id),
  printId: uuid("print_id").references(() => quotePrints.id),
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
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesOrders = pgTable("sales_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  folio: text("folio").notNull(),
  quoteId: uuid("quote_id").references(() => quotes.id),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  customerName: text("customer_name").notNull(),
  customerRfc: text("customer_rfc"),
  status: text("status").notNull().default("draft"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  fulfillmentStatus: text("fulfillment_status").notNull().default("pending"),
  currency: text("currency").notNull().default("MXN"),
  subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
  shippingMinor: bigint("shipping_minor", { mode: "bigint" }).notNull().default(0n),
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
  creditOverrideReason: text("credit_override_reason"),
  locationId: uuid("location_id").references(() => locations.id),
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
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
});

export const salesOrderLines = pgTable("sales_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
  productId: uuid("product_id").references(() => products.id),
  filamentId: uuid("filament_id").references(() => filaments.id),
  serviceId: uuid("service_id").references(() => serviceOfferings.id),
  lineKind: text("line_kind").notNull().default("product"),
  terms: text("terms"),
  resolution: text("resolution").notNull().default("pending"),
  resolutionNote: text("resolution_note"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
  netMinor: bigint("net_minor", { mode: "bigint" }).notNull(),
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
  position: integer("position").notNull().default(0),
  reservedQty: numeric("reserved_qty", { precision: 14, scale: 4 }).notNull().default("0"),
  shippedQty: numeric("shipped_qty", { precision: 14, scale: 4 }).notNull().default("0"),
  closedShortQty: numeric("closed_short_qty", { precision: 14, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesOrderEvents = pgTable("sales_order_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
  kind: text("kind").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
  method: text("method").notNull(),
  kind: text("kind").notNull().default("payment"),
  status: text("status").notNull().default("completed"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  reference: text("reference"),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: uuid("user_id").notNull().references(() => userAccounts.id),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);

const qty = (name: string) => numeric(name, { precision: 14, scale: 4 });
const tenantId = () => uuid("tenant_id").notNull().references(() => tenants.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const materialLots = pgTable("material_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productId: uuid("product_id").references(() => products.id),
  filamentId: uuid("filament_id").references(() => filaments.id),
  lotNumber: text("lot_number").notNull(),
  vendorLot: text("vendor_lot"),
  source: text("source").notNull().default("manual"),
  receivedQty: qty("received_qty").notNull().default("0"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  vendorId: uuid("vendor_id"),
  purchaseOrderId: uuid("purchase_order_id"),
  receiptId: uuid("receipt_id"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
});

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
});

export const routings = pgTable("routings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productId: uuid("product_id").notNull().references(() => products.id),
  version: integer("version").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
});

export const routingOperations = pgTable("routing_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  routingId: uuid("routing_id").notNull().references(() => routings.id),
  sequence: integer("sequence").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  workCenterId: uuid("work_center_id").notNull().references(() => workCenters.id),
  setupMinutes: numeric("setup_minutes", { precision: 10, scale: 2 }).notNull().default("0"),
  runMinutes: numeric("run_minutes", { precision: 10, scale: 2 }).notNull().default("0"),
});

export const boms = pgTable("boms", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productId: uuid("product_id").notNull().references(() => products.id),
  version: integer("version").notNull(),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
});

export const bomLines = pgTable("bom_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  bomId: uuid("bom_id").notNull().references(() => boms.id),
  componentProductId: uuid("component_product_id").references(() => products.id),
  componentFilamentId: uuid("component_filament_id").references(() => filaments.id),
  quantity: qty("quantity").notNull(),
  scrapPct: numeric("scrap_pct", { precision: 6, scale: 2 }).notNull().default("0"),
  sequence: integer("sequence").notNull().default(1),
});

export const productionOrders = pgTable("production_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  folio: text("folio").notNull(),
  productId: uuid("product_id").notNull().references(() => products.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
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
  estimatedCostMinor: bigint("estimated_cost_minor", { mode: "bigint" }),
  actualCostMinor: bigint("actual_cost_minor", { mode: "bigint" }),
  qcStatus: text("qc_status").notNull().default("not_required"),
  scrapReason: text("scrap_reason"),
  shortReason: text("short_reason"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
});

export const productionOrderMaterials = pgTable("production_order_materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productionOrderId: uuid("production_order_id").notNull().references(() => productionOrders.id),
  componentProductId: uuid("component_product_id").references(() => products.id),
  componentFilamentId: uuid("component_filament_id").references(() => filaments.id),
  requiredQty: qty("required_qty").notNull(),
  allocatedQty: qty("allocated_qty").notNull().default("0"),
  consumedQty: qty("consumed_qty").notNull().default("0"),
  unitCostMinor: numeric("unit_cost_minor", { precision: 18, scale: 6 }).notNull().default("0"),
  createdAt: createdAt(),
});

export const productionOrderOperations = pgTable("production_order_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productionOrderId: uuid("production_order_id").notNull().references(() => productionOrders.id),
  sequence: integer("sequence").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  workCenterId: uuid("work_center_id").notNull().references(() => workCenters.id),
  plannedMinutes: numeric("planned_minutes", { precision: 10, scale: 2 }).notNull().default("0"),
  hourlyRateMinor: bigint("hourly_rate_minor", { mode: "bigint" }).notNull().default(0n),
  status: text("status").notNull().default("pending"),
  actualMinutes: numeric("actual_minutes", { precision: 10, scale: 2 }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const productionConsumptions = pgTable("production_consumptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productionOrderId: uuid("production_order_id").notNull().references(() => productionOrders.id),
  materialId: uuid("material_id").notNull().references(() => productionOrderMaterials.id),
  productId: uuid("product_id").references(() => products.id),
  filamentId: uuid("filament_id").references(() => filaments.id),
  lotId: uuid("lot_id"),
  quantity: qty("quantity").notNull(),
  valueMinor: bigint("value_minor", { mode: "bigint" }).notNull().default(0n),
  source: text("source").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
});

export const defectTypes = pgTable("defect_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
});

export const inspections = pgTable("inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  productionOrderId: uuid("production_order_id").notNull().references(() => productionOrders.id),
  result: text("result").notNull(),
  qtyPassed: qty("qty_passed").notNull(),
  qtyFailed: qty("qty_failed").notNull().default("0"),
  defectTypeId: uuid("defect_type_id"),
  disposition: text("disposition"),
  notes: text("notes"),
  photoPath: text("photo_path"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
});

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
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  folio: text("folio").notNull(),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  vendorName: text("vendor_name").notNull(),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  status: text("status").notNull().default("draft"),
  expectedDate: date("expected_date", { mode: "string" }),
  orderedAt: timestamp("ordered_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  currency: text("currency").notNull().default("MXN"),
  subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull().default(0n),
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull().default(0n),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull().default(0n),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  ...timestamps,
});

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  productId: uuid("product_id").references(() => products.id),
  filamentId: uuid("filament_id").references(() => filaments.id),
  description: text("description").notNull(),
  purchaseUom: text("purchase_uom").notNull(),
  uomFactor: numeric("uom_factor", { precision: 12, scale: 4 }).notNull(),
  quantity: qty("quantity").notNull(),
  receivedQty: qty("received_qty").notNull().default("0"),
  unitCostMinor: bigint("unit_cost_minor", { mode: "bigint" }).notNull(),
  lineTotalMinor: bigint("line_total_minor", { mode: "bigint" }).notNull(),
  createdAt: createdAt(),
});

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  folio: text("folio").notNull(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
});

export const receiptLines = pgTable("receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  receiptId: uuid("receipt_id").notNull().references(() => receipts.id),
  purchaseOrderLineId: uuid("purchase_order_line_id").notNull().references(() => purchaseOrderLines.id),
  productId: uuid("product_id").references(() => products.id),
  filamentId: uuid("filament_id").references(() => filaments.id),
  quantity: qty("quantity").notNull(),
  stockQuantity: qty("stock_quantity").notNull(),
  lotId: uuid("lot_id"),
  valueMinor: bigint("value_minor", { mode: "bigint" }).notNull().default(0n),
});

export const commercialDocuments = pgTable("commercial_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  kind: text("kind").notNull().default("prefactura"),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
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
});

export const commercialDocumentLines = pgTable("commercial_document_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  documentId: uuid("document_id").notNull().references(() => commercialDocuments.id),
  description: text("description").notNull(),
  quantity: qty("quantity").notNull(),
  unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
  netMinor: bigint("net_minor", { mode: "bigint" }).notNull(),
  vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
});
