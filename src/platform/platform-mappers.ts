// SA-05: platform responses are built only from these mappers, which never read resident,
// consent or staff-register columns. The field-scan test in test/platform.test.ts guards this.
import type {
	FacilitySummary,
	OrgAdminSummary,
	Organisation,
	OrganisationLimits,
} from '@carekind/shared';
import { toIso } from '../common/dates.js';
import type { OrganisationRow } from '../db/queries.js';
import type { facilities, platformDefaults, staff } from '../db/schema.js';

type LimitRow = Pick<typeof platformDefaults.$inferSelect, keyof OrganisationLimits>;

export function toLimits(row: LimitRow): OrganisationLimits {
	return {
		enabledRecordTypes: row.enabledRecordTypes,
		pcwRequiresRnReview: row.pcwRequiresRnReview,
		audioRetentionDaysMax: row.audioRetentionDaysMax,
		aiProcessingEnabled: row.aiProcessingEnabled,
		facilityLimit: row.facilityLimit,
	};
}

export function toOrganisation(row: OrganisationRow): Organisation {
	return {
		id: row.id,
		name: row.name,
		abn: row.abn,
		contactName: row.contactName,
		contactEmail: row.contactEmail,
		status: row.status,
		limits: toLimits(row),
		createdAt: toIso(row.createdAt),
		updatedAt: toIso(row.updatedAt),
	};
}

export function toFacilitySummary(row: typeof facilities.$inferSelect): FacilitySummary {
	return { id: row.id, name: row.name, state: row.state, status: row.status };
}

// Org admins always have an email: they are created by an email invite.
export function toOrgAdminSummary(
	row: typeof staff.$inferSelect & { email: string },
): OrgAdminSummary {
	return {
		staffId: row.id,
		givenName: row.givenName,
		familyName: row.familyName,
		email: row.email,
		lifecycle: row.lifecycle,
	};
}
