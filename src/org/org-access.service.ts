// SPEC-011 PA-01a: tenant isolation and facility scoping, enforced on the server (code-rules P-6).
// The organisation comes from the caller's token, never from the request (SA-01a). Records of
// another organisation are reported as "not found" so their existence is not revealed.
import { Inject, Injectable } from '@nestjs/common';
import { type Action, type Id, can, canInFacility } from '@carekind/shared';
import { and, eq } from 'drizzle-orm';
import type { StaffPrincipal } from '../auth/principal.js';
import { forbidden, notFound } from '../common/api-error.js';
import { DATABASE } from '../common/tokens.js';
import type { Database, DbExecutor } from '../db/database.js';
import { facilities } from '../db/schema.js';

export type FacilityRow = typeof facilities.$inferSelect;

export function requireOrgAdminAction(actor: StaffPrincipal, action: Action): void {
	if (!(actor.isOrgAdmin && can('org_admin', action))) {
		throw forbidden();
	}
}

export function requireFacilityAction(actor: StaffPrincipal, facilityId: Id, action: Action): void {
	if (!canInFacility(actor, facilityId, action)) {
		throw forbidden();
	}
}

@Injectable()
export class OrgAccessService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async findFacility(
		actor: StaffPrincipal,
		facilityId: Id,
		executor: DbExecutor = this.db,
	): Promise<FacilityRow> {
		const [row] = await executor
			.select()
			.from(facilities)
			.where(
				and(eq(facilities.id, facilityId), eq(facilities.organisationId, actor.organisationId)),
			);
		if (row === undefined) {
			throw notFound('Facility');
		}
		return row;
	}

	async facilityFor(
		actor: StaffPrincipal,
		facilityId: Id,
		action: Action,
		executor: DbExecutor = this.db,
	): Promise<FacilityRow> {
		const facility = await this.findFacility(actor, facilityId, executor);
		requireFacilityAction(actor, facility.id, action);
		return facility;
	}

	// Every facility of the caller's organisation where the caller may perform `action`.
	async facilitiesWith(actor: StaffPrincipal, action: Action): Promise<FacilityRow[]> {
		const rows = await this.db
			.select()
			.from(facilities)
			.where(eq(facilities.organisationId, actor.organisationId))
			.orderBy(facilities.name);
		return rows.filter((row) => canInFacility(actor, row.id, action));
	}

	// null = every facility (org admin); used for audit scoping.
	async facilityIdsWith(actor: StaffPrincipal, action: Action): Promise<Id[] | null> {
		if (actor.isOrgAdmin && can('org_admin', action)) {
			return null;
		}
		return (await this.facilitiesWith(actor, action)).map((row) => row.id);
	}
}
