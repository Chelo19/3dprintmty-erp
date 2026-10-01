import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { canReadMargins, canReadSalePrice, canWriteCatalog, Money, QC_RIGOR, STOCK_UOMS, uomShort, type TenantRole } from "@3dprintmty/domain";
import { countryPolicy } from "@3dprintmty/fiscal";
import { AppError } from "@3dprintmty/shared";
import { and, count, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import { filaments, products, productsVisible, serviceOfferings, stockBalances } from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor, type TenantActor } from "../http/actor";
import { one, withIdempotency, type Db } from "./support";

const productSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  productType: z.enum(["raw_material", "component", "finished_good", "service", "resale"]),
  stockUom: z.enum(STOCK_UOMS).optional(),
  cost: z.string().optional(),
  salePrice: z.string().optional(),
  qcRigor: z.enum(QC_RIGOR).optional(),
});

const productPatchSchema = z.object({
  sku: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  stockUom: z.enum(STOCK_UOMS).optional(),
  cost: z.string().nullable().optional(),
  salePrice: z.string().nullable().optional(),
  qcRigor: z.enum(QC_RIGOR).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const filamentSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  material: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(40),
  diameterMm: z.enum(["1.75", "2.85"]),
  cost: z.string().optional(),
  salePrice: z.string().optional(),
});

const filamentPatchSchema = z.object({
  sku: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  material: z.string().trim().min(1).max(40).optional(),
  color: z.string().trim().min(1).max(40).optional(),
  cost: z.string().nullable().optional(),
  salePrice: z.string().nullable().optional(),
  diameterMm: z.enum(["1.75", "2.85"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const serviceSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(400).optional(),
  unit: z.enum(["minuto", "hora", "pieza", "servicio"]).default("servicio"),
  cost: z.string().optional(),
  salePrice: z.string(),
  terms: z.string().trim().max(2000).optional(),
});

const servicePatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(400).optional(),
  unit: z.enum(["minuto", "hora", "pieza", "servicio"]).optional(),
  cost: z.string().nullable().optional(),
  salePrice: z.string().optional(),
  terms: z.string().trim().max(2000).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const previewSchema = z.object({
  lines: z.array(z.object({
    description: z.string().min(1),
    quantity: z.string(),
    unitPrice: z.string(),
    discount: z.string().optional(),
    taxable: z.boolean().optional(),
  })).min(1),
  globalDiscount: z.string().optional(),
  rate: z.string().default("0.16"),
});

@Controller()
export class CatalogController {
  private get database() {
    return services().database;
  }

  @Get("products")
  async list(
    @CurrentUser() actor: Actor,
    @Query("page") pageRaw?: string,
    @Query("limit") limitRaw?: string,
    @Query("q") q?: string,
  ) {
    const tenant = requireTenant(actor);
    const page = Math.max(1, Number(pageRaw ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitRaw ?? 20) || 20));
    const offset = (page - 1) * limit;
    const filter = q?.trim()
      ? or(ilike(productsVisible.sku, `%${q.trim()}%`), ilike(productsVisible.name, `%${q.trim()}%`))
      : undefined;
    const rows = await this.database.asUser(tenant, (db) => {
      const query = db.select().from(productsVisible).orderBy(desc(productsVisible.createdAt)).limit(limit).offset(offset);
      return filter ? query.where(filter) : query;
    });
    const [{ value }] = await this.database.asUser(tenant, (db) => {
      const query = db.select({ value: count() }).from(productsVisible);
      return filter ? query.where(filter) : query;
    });
    return {
      data: rows.map((row: ProductRow) => mapProduct(row, tenant.role)),
      page,
      limit,
      total: Number(value ?? 0),
    };
  }

  @Get("products/:id")
  async get(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = requireTenant(actor);
    const row = await this.database.asUser(tenant, (db) =>
      one(db, productsVisible, productsVisible.id, id, "No encontramos ese producto."),
    );
    return mapProduct(row, tenant.role);
  }

  @Post("products")
  async create(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const tenant = this.writer(actor);
    const input = productSchema.parse(body);
    if (input.productType === "service") {
      throw new AppError("use_service_catalog", "Los servicios se capturan en el catálogo de servicios.", 409);
    }
    if (input.productType === "raw_material") {
      throw new AppError("use_filament_catalog", "Los filamentos se capturan en el catálogo de filamentos.", 409);
    }
    return withIdempotency(this.database, tenant, idempotencyKey, { route: "products", input }, async () => {
      const values = productValues(tenant.tenantId, tenant.userId, input);
      const [created] = await this.database.asUser(tenant, async (db) => {
        await assertSkuFree(db, tenant.tenantId, values.sku);
        return db.insert(products).values(values).returning({ id: products.id });
      });
      return this.load(tenant, created.id);
    }, { required: false });
  }

  @Patch("products/:id")
  async update(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = this.writer(actor);
    const input = productPatchSchema.parse(body);
    await this.database.asUser(tenant, async (db) => {
      const product = await one(db, products, products.id, id, "No encontramos ese producto.");
      const sku = input.sku?.toUpperCase();
      if (sku && sku !== product.sku) await assertSkuFree(db, tenant.tenantId, sku, { table: "product", id: product.id });
      const uomChanged = input.stockUom !== undefined && input.stockUom !== product.stockUom;
      if (uomChanged) await assertNoStock(db, product.id, product.stockUom);
      await db
        .update(products)
        .set({
          ...(sku ? { sku } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(uomChanged ? { stockUom: input.stockUom, purchaseUom: input.stockUom, uomFactor: "1.0000" } : {}),
          ...(input.cost !== undefined ? { costMinor: majorOrNull(input.cost) } : {}),
          ...(input.salePrice !== undefined ? { salePriceMinor: majorOrNull(input.salePrice) } : {}),
          ...(input.qcRigor !== undefined ? { qcRigor: input.qcRigor } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(products.id, product.id));
    });
    return this.load(tenant, id);
  }

  @Delete("products/:id")
  async removeProduct(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = this.writer(actor);
    await this.database.asUser(tenant, async (db) => {
      const product = await one(db, products, products.id, id, "No encontramos ese producto.");
      const [removed] = await db.delete(products).where(eq(products.id, product.id)).returning({ id: products.id });
      if (!removed) throw new AppError("forbidden", "No tienes permiso para eliminar ese producto.", 403);
    });
    return { ok: true };
  }

  @Get("filaments")
  async listFilaments(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db.select().from(filaments).orderBy(desc(filaments.createdAt)),
    );
    return { data: rows.map((row: FilamentRow) => mapFilament(row, tenant.role)) };
  }

  @Get("filaments/:id")
  async getFilament(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = requireTenant(actor);
    const row = await this.database.asUser(tenant, (db) =>
      one(db, filaments, filaments.id, id, "No encontramos ese filamento."),
    );
    return mapFilament(row, tenant.role);
  }

  @Post("filaments")
  async createFilament(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const tenant = this.writer(actor);
    const input = filamentSchema.parse(body);
    return withIdempotency(this.database, tenant, idempotencyKey, { route: "filaments", input }, async () => {
      const [created] = await this.database.asUser(tenant, async (db) => {
        await assertSkuFree(db, tenant.tenantId, input.sku.toUpperCase());
        return db
          .insert(filaments)
          .values({
            tenantId: tenant.tenantId,
            sku: input.sku.toUpperCase(),
            name: input.name,
            material: input.material,
            color: input.color,
            diameterMm: input.diameterMm,
            costMinor: input.cost ? majorOrNull(input.cost) : null,
            salePriceMinor: input.salePrice ? Money.fromMajor(input.salePrice).minor : null,
            createdBy: tenant.userId,
          })
          .returning();
      });
      return mapFilament(created, tenant.role);
    }, { required: false });
  }

  @Patch("filaments/:id")
  async updateFilament(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = this.writer(actor);
    const input = filamentPatchSchema.parse(body);
    const updated = await this.database.asUser(tenant, async (db) => {
      const filament = await one(db, filaments, filaments.id, id, "No encontramos ese filamento.");
      const sku = input.sku?.toUpperCase();
      if (sku && sku !== filament.sku) await assertSkuFree(db, tenant.tenantId, sku, { table: "filament", id: filament.id });
      const [row] = await db
        .update(filaments)
        .set({
          ...(sku ? { sku } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.material !== undefined ? { material: input.material } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.diameterMm !== undefined ? { diameterMm: input.diameterMm } : {}),
          ...(input.cost !== undefined ? { costMinor: majorOrNull(input.cost) } : {}),
          ...(input.salePrice !== undefined ? { salePriceMinor: input.salePrice === null ? null : Money.fromMajor(input.salePrice).minor } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(filaments.id, filament.id))
        .returning();
      return row;
    });
    return mapFilament(updated, tenant.role);
  }

  @Delete("filaments/:id")
  async removeFilament(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = this.writer(actor);
    await this.database.asUser(tenant, async (db) => {
      const filament = await one(db, filaments, filaments.id, id, "No encontramos ese filamento.");
      const [removed] = await db.delete(filaments).where(eq(filaments.id, filament.id)).returning({ id: filaments.id });
      if (!removed) throw new AppError("forbidden", "No tienes permiso para eliminar ese filamento.", 403);
    });
    return { ok: true };
  }

  @Get("services")
  async listServices(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db.select().from(serviceOfferings).orderBy(desc(serviceOfferings.createdAt)),
    );
    return { data: rows.map((row: ServiceRow) => mapService(row, tenant.role)) };
  }

  @Get("services/:id")
  async getService(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = requireTenant(actor);
    const row = await this.database.asUser(tenant, (db) =>
      one(db, serviceOfferings, serviceOfferings.id, id, "No encontramos ese servicio."),
    );
    return mapService(row, tenant.role);
  }

  @Post("services")
  async createService(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "sales"]);
    const input = serviceSchema.parse(body);
    const [created] = await this.database.asUser(tenant, (db) =>
      db
        .insert(serviceOfferings)
        .values({
          tenantId: tenant.tenantId,
          code: input.code.toUpperCase(),
          name: input.name,
          description: input.description || null,
          unit: input.unit,
          costMinor: input.cost ? majorOrNull(input.cost) : null,
          salePriceMinor: Money.fromMajor(input.salePrice).minor,
          terms: input.terms ?? "",
          createdBy: tenant.userId,
        })
        .returning(),
    );
    return mapService(created, tenant.role);
  }

  @Patch("services/:id")
  async updateService(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "sales"]);
    const input = servicePatchSchema.parse(body);
    const updated = await this.database.asUser(tenant, async (db) => {
      const service = await one(db, serviceOfferings, serviceOfferings.id, id, "No encontramos ese servicio.");
      const [row] = await db
        .update(serviceOfferings)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.cost !== undefined ? { costMinor: majorOrNull(input.cost) } : {}),
          ...(input.salePrice !== undefined ? { salePriceMinor: Money.fromMajor(input.salePrice).minor } : {}),
          ...(input.terms !== undefined ? { terms: input.terms } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(serviceOfferings.id, service.id))
        .returning();
      return row;
    });
    return mapService(updated, tenant.role);
  }

  @Delete("services/:id")
  async removeService(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = assertRole(actor, ["owner", "admin", "sales"]);
    await this.database.asUser(tenant, async (db) => {
      const service = await one(db, serviceOfferings, serviceOfferings.id, id, "No encontramos ese servicio.");
      const [removed] = await db.delete(serviceOfferings).where(eq(serviceOfferings.id, service.id)).returning({ id: serviceOfferings.id });
      if (!removed) throw new AppError("forbidden", "No tienes permiso para eliminar ese servicio.", 403);
    });
    return { ok: true };
  }

  @Post("tax/preview")
  preview(@CurrentUser() actor: Actor, @Body() body: unknown) {
    assertRole(actor, ["owner", "admin", "sales"]);
    const input = previewSchema.parse(body);
    return countryPolicy("MX").taxEngine.calculate(input);
  }

  private writer(actor: Actor): TenantActor {
    const tenant = assertRole(actor, ["owner", "admin", "warehouse"]);
    if (!canWriteCatalog(tenant.role)) {
      throw new AppError("forbidden", "No tienes permiso para esta acción.", 403);
    }
    return tenant;
  }

  private async load(tenant: TenantActor, id: string) {
    const row = await this.database.asUser(tenant, (db) =>
      one(db, productsVisible, productsVisible.id, id, "No encontramos ese producto."),
    );
    return mapProduct(row, tenant.role);
  }
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  productType: string;
  status: string;
  stockUom: string;
  purchaseUom: string;
  uomFactor: string;
  costMinor: bigint | number | string | null;
  salePriceMinor: bigint | number | string | null;
  qcRigor: string;
}

interface ServiceRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  costMinor: bigint | number | string | null;
  salePriceMinor: bigint | number | string | null;
  terms: string;
  status: string;
}

function mapService(row: ServiceRow, role: TenantRole) {
  const hidePrice = !canReadSalePrice(role);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    unit: row.unit,
    cost: canReadMargins(role) ? moneyOrNull(row.costMinor) : null,
    salePrice: hidePrice ? null : moneyOrNull(row.salePriceMinor),
    terms: row.terms,
    status: row.status,
    pricesHidden: hidePrice,
    currency: "MXN",
  };
}

function mapProduct(row: ProductRow, role: TenantRole) {
  const hidePrice = role === "production";
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    productType: row.productType,
    status: row.status,
    stockUom: row.stockUom,
    purchaseUom: row.purchaseUom,
    uomFactor: row.uomFactor,
    cost: canReadMargins(role) ? moneyOrNull(row.costMinor) : null,
    salePrice: hidePrice ? null : moneyOrNull(row.salePriceMinor),
    pricesHidden: hidePrice,
    qcRigor: row.qcRigor,
    currency: "MXN",
  };
}

function moneyOrNull(value: bigint | number | string | null): string | null {
  if (value === null || value === undefined) return null;
  return Money.fromMinor(BigInt(value)).toMajor();
}

function majorOrNull(value: string | null): bigint | null {
  if (value === null || value.trim() === "") return null;
  const minor = Money.fromMajor(value).minor;
  if (minor < 0n) throw new AppError("invalid_money", "El importe no puede ser negativo.");
  return minor;
}

function mapFilament(row: FilamentRow, role: TenantRole) {
  const hidePrice = role === "production";
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    material: row.material,
    color: row.color,
    diameterMm: row.diameterMm,
    status: row.status,
    stockUom: "G",
    purchaseUom: "KG",
    cost: canReadMargins(role) ? moneyOrNull(row.costMinor) : null,
    salePrice: hidePrice ? null : moneyOrNull(row.salePriceMinor),
    pricesHidden: hidePrice,
    currency: "MXN",
  };
}

interface FilamentRow {
  id: string;
  sku: string;
  name: string;
  material: string;
  color: string;
  diameterMm: string;
  costMinor: bigint | number | string | null;
  salePriceMinor: bigint | number | string | null;
  status: string;
}

const SKU_OWNER: Record<string, string> = {
  component: "el insumo",
  finished_good: "el producto terminado",
  resale: "el producto revendido",
};

/** Productos, insumos y filamentos comparten un solo espacio de SKU porque todos pasan por el kardex. */
async function assertSkuFree(db: Db, tenantId: string, sku: string, self?: { table: "product" | "filament"; id: string }) {
  const productSelf = self?.table === "product" ? ne(products.id, self.id) : undefined;
  const filamentSelf = self?.table === "filament" ? ne(filaments.id, self.id) : undefined;
  const [product] = await db
    .select({ name: products.name, productType: products.productType, status: products.status })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.sku, sku), productSelf))
    .limit(1);
  const [filament] = product
    ? []
    : await db
        .select({ name: filaments.name, productType: sql<string>`'filament'`, status: filaments.status })
        .from(filaments)
        .where(and(eq(filaments.tenantId, tenantId), eq(filaments.sku, sku), filamentSelf))
        .limit(1);
  const owner = product ?? filament;
  if (!owner) return;
  const who = owner.productType === "filament" ? "el filamento" : SKU_OWNER[owner.productType] ?? "el artículo";
  const inactive = owner.status === "inactive" ? " (inactivo)" : "";
  throw new AppError("sku_taken", `Ese SKU ya lo usa ${who} «${owner.name}»${inactive}.`, 409);
}

/** Las cantidades del kardex están en la unidad del producto; cambiarla con existencia las reinterpretaría. */
async function assertNoStock(db: Db, productId: string, currentUom: string) {
  const [balance] = await db
    .select({ onHand: sql<string>`coalesce(sum(${stockBalances.onHand}), 0)`, allocated: sql<string>`coalesce(sum(${stockBalances.allocated}), 0)` })
    .from(stockBalances)
    .where(eq(stockBalances.productId, productId));
  const onHand = Number(balance?.onHand ?? 0);
  const allocated = Number(balance?.allocated ?? 0);
  if (onHand !== 0 || allocated !== 0) {
    const unit = uomShort(currentUom);
    const detail = allocated !== 0 ? `${onHand} ${unit} en existencia y ${allocated} ${unit} apartados` : `${onHand} ${unit} en existencia`;
    throw new AppError(
      "uom_has_stock",
      `No se puede cambiar la unidad: hay ${detail}. Las cantidades no se convierten; deja la existencia en cero primero.`,
      409,
    );
  }
}

function productValues(tenantId: string, createdBy: string, input: z.infer<typeof productSchema>) {
  return {
    tenantId,
    sku: input.sku.toUpperCase(),
    name: input.name,
    productType: input.productType,
    stockUom: input.stockUom ?? "EA",
    purchaseUom: input.stockUom ?? "EA",
    uomFactor: "1.0000",
    costMinor: input.cost ? majorOrNull(input.cost) : null,
    salePriceMinor: input.salePrice ? Money.fromMajor(input.salePrice).minor : null,
    qcRigor: input.qcRigor ?? (input.productType === "finished_good" ? "basic" : "off"),
    createdBy,
  };
}
