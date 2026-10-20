// Which staff records the caller may see or change (PA-01a, PA-02). Org admins: everyone in the
// organisation. Facility roles with manage_staff: staff assigned to one of their facilities.
// Only an org admin may change another org admin (prevents a facility role taking over the tenant).
import { Injectable } from '@nestjs/common';
import type { Id, StaffAssignment } from '@carekind/shared';
import { and, eq } from 'drizzle-orm';
import type { StaffPrincipal } from '../auth/principal.js';
import { forbidden, notFound } from '../common/api-error.js';
import type { DbExecutor } from '../db/database.js';
import { assignmentsOf } from '../db/queries.js';
import { staff } from '../db/schema.js';
import { OrgAccessService } from './org-access.service.js';
import type { StaffRow } from './org-mappers.js';

export interface AccessibleStaff {
	row: StaffRow;
	assignments: StaffAssignment[];
	// Facilities where the caller may manage staff; null = all (org admin).
	managedFacilityIds: Id[] | null;
	// The facility this change is filed under in the audit log (facility roles see their own).
	auditFacilityId: Id | null;
}

export function isManaged(managedFacilityIds: Id[] | null, facilityId: Id): boolean {
	return managedFacilityIds === null || managedFacilityIds.includes(facilityId);
}

export function auditFacilityFor(
	assignments: readonly StaffAssignment[],
	managedFacilityIds: Id[] | null,
): Id | null {
	const managed = assignments.find((item) => isManaged(managedFacilityIds, item.facilityId));
	return managed?.facilityId ?? null;
}

@Injectable()
export class StaffAccessService {
	constructor(private readonly access: OrgAccessService) {}

	managedFacilityIds(actor: StaffPrincipal): Promise<Id[] | null> {
		return this.access.facilityIdsWith(actor, 'manage_staff');
	}

	async forRead(actor: StaffPrincipal, staffId: Id, executor: DbExecutor): Promise<AccessibleStaff> {
		const [row] = await executor
			.select()
			.from(staff)
			.where(and(eq(staff.id, staffId), eq(staff.organisationId, actor.organisationId)));
		if (row === undefined) {
			throw notFound('Staff member');
		}
		const managedFacilityIds = await this.managedFacilityIds(actor);
		const assignments = await assignmentsOf(executor, row.id);
		const isVisible =
			managedFacilityIds === null ||
			assignments.some((item) => managedFacilityIds.includes(item.facilityId));
		if (!isVisible) {
			throw forbidden();
		}
		return {
			row,
			assignments,
			managedFacilityIds,
			auditFacilityId: auditFacilityFor(assignments, managedFacilityIds),
		};
	}

	async forWrite(actor: StaffPrincipal, staffId: Id, executor: DbExecutor): Promise<AccessibleStaff> {
		const target = await this.forRead(actor, staffId, executor);
		if (target.row.isOrgAdmin && !actor.isOrgAdmin) {
			throw forbidden();
		}
		return target;
	}
}
