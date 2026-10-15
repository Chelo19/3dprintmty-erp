import { Controller, Get, Query } from "@nestjs/common";
import { and, count, desc, eq, getTableColumns, ilike, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import { auditEvents, tenantMemberships } from "../db/schema";
import { assertRole, CurrentUser, type Actor } from "../http/actor";

const ENTITY_GROUPS: Record<string, string[]> = {
  company_profiles: ["company_profiles", "company"], products: ["products", "product"],
  boms: ["boms", "bom"], expenses: ["expenses", "expense"], payments: ["payments", "payment"],
  tenant_memberships: ["tenant_memberships", "membership"], invitations: ["invitations", "invitation"],
  sales_orders: ["sales_orders", "sales_order"], receipts: ["receipts", "receipt"],
  production_orders: ["production_orders", "production_order"],
};
const canonicalEntity = (type: string) => Object.entries(ENTITY_GROUPS).find(([, types]) => types.includes(type))?.[0] ?? type;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  entityType: z.string().trim().max(80).optional(),
  entityId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  actor: z.string().trim().max(120).optional(),
  action: z.enum(["record.insert", "record.update", "record.delete"]).optional(),
  before: z.string().datetime({ offset: true }).optional(),
  beforeId: z.string().uuid().optional(),
}).refine((input) => Boolean(input.before) === Boolean(input.beforeId), "El cursor de la bitácora no es válido.");

@Controller()
export class AuditController {
  @Get("audit-events")
  async list(@CurrentUser() actor: Actor, @Query() query: unknown) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const input = querySchema.parse(query);
    const escapedActor = input.actor?.replace(/[\\%_]/g, "\\$&");
    return services().database.asReadUser(tenant, async (db) => {
      const availableFilters = and(
        eq(auditEvents.tenantId, tenant.tenantId),
        notInArray(auditEvents.entityType, ["idempotency_keys", "idempotency_requests"]),
        input.actorUserId ? eq(auditEvents.actorUserId, input.actorUserId) : undefined,
        input.entityId ? eq(auditEvents.entityId, input.entityId) : undefined,
        input.action ? eq(auditEvents.action, input.action) : undefined,
        escapedActor ? ilike(sql`coalesce(${auditEvents.metadata}->>'actorEmail', ${tenantMemberships.email}, ${auditEvents.actorUserId}::text, '')`, `%${escapedActor}%`) : undefined,
      );
      const filters = and(availableFilters,
        input.entityType ? inArray(auditEvents.entityType, (Object.hasOwn(ENTITY_GROUPS, input.entityType) ? ENTITY_GROUPS[input.entityType] ?? [input.entityType] : [input.entityType])) : undefined,
      );
      // Build options from all matching records, independent of the current page and module selection.
      const availableTypes: Array<{ entityType: string }> = await db.selectDistinct({ entityType: auditEvents.entityType }).from(auditEvents)
        .leftJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, auditEvents.tenantId), eq(tenantMemberships.userId, auditEvents.actorUserId)))
        .where(availableFilters);
      const entityTypes = [...new Set(availableTypes.map((row) => canonicalEntity(row.entityType)))];
      const rows: Array<typeof auditEvents.$inferSelect & { currentEmail: string | null; cursorTime: string }> = await db
        .select({ ...getTableColumns(auditEvents), currentEmail: tenantMemberships.email, cursorTime: sql<string>`to_char(${auditEvents.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
        .from(auditEvents)
        .leftJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, auditEvents.tenantId), eq(tenantMemberships.userId, auditEvents.actorUserId)))
        .where(and(filters,
          input.before && input.beforeId ? or(sql`${auditEvents.createdAt} < ${input.before}::timestamptz`, and(sql`${auditEvents.createdAt} = ${input.before}::timestamptz`, lt(auditEvents.id, input.beforeId))) : undefined,
        ))
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)).limit(input.limit + 1);
      const [{ total }] = await db.select({ total: count() }).from(auditEvents)
        .leftJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, auditEvents.tenantId), eq(tenantMemberships.userId, auditEvents.actorUserId)))
        .where(filters);
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const data = page.map(({ currentEmail, cursorTime: _cursorTime, ...row }) => {
        const metadata = row.metadata as Record<string, unknown>;
        return { ...row, actorEmail: typeof metadata.actorEmail === "string" ? metadata.actorEmail : currentEmail,
          actorRole: metadata.actorRole ?? null, impersonator: metadata.impersonator ?? null };
      });
      const last = page.at(-1);
      return { data, total, entityTypes, next: hasMore && last ? { before: last.cursorTime, beforeId: last.id } : null };
    });
  }
}
