// SA-04a / PA-07 / code-rules P-7: every write appends one audit row in the same transaction.
// Summaries are fixed phrases chosen by the caller: never resident names or health information.
import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry, Id } from '@carekind/shared';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { AuditActor } from '../auth/principal.js';
import type { Database, DbExecutor } from '../db/database.js';
import { auditLog } from '../db/schema.js';
import { toIso } from './dates.js';
import { DATABASE } from './tokens.js';

export interface AuditInput {
	actor: AuditActor;
	organisationId: Id | null;
	facilityId?: Id | null;
	action: string;
	entity: string;
	entityId: Id | null;
	summary: string;
}

// The console shows recent history; older rows stay in the table (append-only, never deleted).
const AUDIT_LIST_LIMIT = 500;

type AuditRow = typeof auditLog.$inferSelect;

function toAuditEntry(row: AuditRow): AuditEntry {
	return {
		id: row.id,
		organisationId: row.organisationId,
		actorType: row.actorType,
		actorId: row.actorId,
		action: row.action,
		entity: row.entity,
		entityId: row.entityId,
		occurredAt: toIso(row.occurredAt),
		summary: row.summary,
	};
}

@Injectable()
export class AuditService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async append(executor: DbExecutor, input: AuditInput): Promise<void> {
		await executor.insert(auditLog).values({
			actorType: input.actor.actorType,
			actorId: input.actor.actorId,
			organisationId: input.organisationId,
			facilityId: input.facilityId ?? null,
			action: input.action,
			entity: input.entity,
			entityId: input.entityId,
			summary: input.summary,
		});
	}

	// SA-04a: the platform audit shows what platform admins did.
	async listPlatformActions(): Promise<AuditEntry[]> {
		const rows = await this.db
			.select()
			.from(auditLog)
			.where(eq(auditLog.actorType, 'platform_admin'))
			.orderBy(desc(auditLog.occurredAt))
			.limit(AUDIT_LIST_LIMIT);
		return rows.map(toAuditEntry);
	}

	// PA-07: org admins see the whole organisation; facility roles see their facilities' entries
	// plus their own actions (facilityIds = null means every facility).
	async listForOrganisation(
		organisationId: Id,
		facilityIds: Id[] | null,
		viewerStaffId: Id,
	): Promise<AuditEntry[]> {
		const ownActions = eq(auditLog.actorId, viewerStaffId);
		const scope =
			facilityIds === null
				? undefined
				: facilityIds.length === 0
					? ownActions
					: or(inArray(auditLog.facilityId, facilityIds), ownActions);
		const rows = await this.db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.organisationId, organisationId), scope))
			.orderBy(desc(auditLog.occurredAt))
			.limit(AUDIT_LIST_LIMIT);
		return rows.map(toAuditEntry);
	}
}
