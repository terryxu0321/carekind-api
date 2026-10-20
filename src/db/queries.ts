// Small read helpers used by more than one module (auth, platform, org).
import type { Id, OrganisationLimits, StaffAssignment } from '@carekind/shared';
import { eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from './database.js';
import { toLimits } from '../platform/platform-mappers.js';
import { organisations, platformDefaults, staffAssignments } from './schema.js';

export type OrganisationRow = typeof organisations.$inferSelect;

export async function assignmentsByStaff(
	executor: DbExecutor,
	staffIds: readonly Id[],
): Promise<Map<Id, StaffAssignment[]>> {
	const byStaff = new Map<Id, StaffAssignment[]>(staffIds.map((id) => [id, []]));
	if (staffIds.length === 0) {
		return byStaff;
	}
	const rows = await executor
		.select()
		.from(staffAssignments)
		.where(inArray(staffAssignments.staffId, [...staffIds]));
	for (const row of rows) {
		byStaff.get(row.staffId)?.push({ facilityId: row.facilityId, role: row.role });
	}
	return byStaff;
}

export async function assignmentsOf(executor: DbExecutor, staffId: Id): Promise<StaffAssignment[]> {
	return (await assignmentsByStaff(executor, [staffId])).get(staffId) ?? [];
}

export async function findOrganisation(
	executor: DbExecutor,
	organisationId: Id,
): Promise<OrganisationRow | undefined> {
	const [row] = await executor
		.select()
		.from(organisations)
		.where(eq(organisations.id, organisationId));
	return row;
}

export async function currentPlatformDefaults(executor: DbExecutor): Promise<OrganisationLimits> {
	const [row] = await executor.select().from(platformDefaults).limit(1);
	if (row === undefined) {
		// The migration inserts this row; its absence means the database was not migrated.
		throw new Error('platform_defaults row is missing');
	}
	return toLimits(row);
}
