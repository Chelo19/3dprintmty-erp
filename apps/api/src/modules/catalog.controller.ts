import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { canReadSalePrice, canWriteCatalog, Money, QC_RIGOR, type TenantRole } from "@3dprintmty/domain";
import { countryPolicy } from "@3dprintmty/fiscal";
import { AppError } from "@3dprintmty/shared";
import { count, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import { products, productsVisible, serviceOfferings } from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor, type TenantActor } from "../http/actor";
import { one, withIdempotency } from "./support";

const productSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  productType: z.enum(["raw_material", "component", "finished_good", "service"]),
  material: z.string().trim().max(40).optional(),
  color: z.string().trim().max(40).optional(),
  diameterMm: z.enum(["1.75", "2.85"]).optional(),
  cost: z.string().optional(),
  salePrice: z.string().optional(),
  qcRigor: z.enum(QC_RIGOR).optional(),
});

const productPatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  cost: z.string().nullable().optional(),
  salePrice: z.string().nullable().optional(),
  qcRigor: z.enum(QC_RIGOR).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const serviceSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(400).optional(),
  unit: z.enum(["hora", "pieza", "servicio"]).default("servicio"),
  salePrice: z.string(),
  terms: z.string().trim().max(2000).optional(),
});

const servicePatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(400).optional(),
  unit: z.enum(["hora", "pieza", "servicio"]).optional(),
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
    return withIdempotency(this.database, tenant.userId, idempotencyKey, { route: "products", input }, async () => {
      const values = productValues(tenant.tenantId, tenant.userId, input);
      const [created] = await this.database.asUser(tenant, (db) =>
        db.insert(products).values(values).returning({ id: products.id }),
      );
      return this.load(tenant, created.id);
    });
  }

  @Patch("products/:id")
  async update(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = this.writer(actor);
    const input = productPatchSchema.parse(body);
    await this.database.asUser(tenant, async (db) => {
      const product = await one(db, products, products.id, id, "No encontramos ese producto.");
      await db
        .update(products)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
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

  @Get("services")
  async listServices(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db.select().from(serviceOfferings).orderBy(desc(serviceOfferings.createdAt)),
    );
    return { data: rows.map((row: ServiceRow) => mapService(row, tenant.role)) };
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
  material: string | null;
  color: string | null;
  diameterMm: string | null;
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
    material: row.material,
    color: row.color,
    diameterMm: row.diameterMm,
    stockUom: row.stockUom,
    purchaseUom: row.purchaseUom,
    uomFactor: row.uomFactor,
    cost: moneyOrNull(row.costMinor),
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

function productValues(tenantId: string, createdBy: string, input: z.infer<typeof productSchema>) {
  const filament = input.productType === "raw_material";
  return {
    tenantId,
    sku: input.sku.toUpperCase(),
    name: input.name,
    productType: input.productType,
    material: input.material || null,
    color: input.color || null,
    diameterMm: input.diameterMm ?? null,
    stockUom: filament ? "G" : "EA",
    purchaseUom: filament ? "KG" : "EA",
    uomFactor: filament ? "1000.0000" : "1.0000",
    costMinor: input.cost ? majorOrNull(input.cost) : null,
    salePriceMinor: input.salePrice ? Money.fromMajor(input.salePrice).minor : null,
    qcRigor: input.qcRigor ?? (input.productType === "finished_good" ? "basic" : "off"),
    createdBy,
  };
}
