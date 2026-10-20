// Database rows → shared response shapes for the facility admin console.
import {
	type Consent,
	type Credential,
	type Facility,
	type GoLiveItem,
	type IsoDate,
	type Resident,
	type ResidentEvent,
	type Staff,
	type StaffAssignment,
	type WorkflowSettings,
	credentialReminder,
} from '@carekind/shared';
import { toIso, toIsoOrNull } from '../common/dates.js';
import type {
	consents,
	credentials,
	facilities,
	goLiveItems,
	residentEvents,
	residents,
	staff,
	workflowSettings,
} from '../db/schema.js';

export type StaffRow = typeof staff.$inferSelect;
export type ResidentRow = typeof residents.$inferSelect;
export type CredentialRow = typeof credentials.$inferSelect;

export function toFacility(row: typeof facilities.$inferSelect): Facility {
	return {
		id: row.id,
		organisationId: row.organisationId,
		name: row.name,
		address: row.address,
		state: row.state,
		beds: row.beds,
		timezone: row.timezone,
		status: row.status,
		createdAt: toIso(row.createdAt),
		updatedAt: toIso(row.updatedAt),
	};
}

export function toGoLiveItem(row: typeof goLiveItems.$inferSelect): GoLiveItem {
	return {
		key: row.key,
		completedAt: toIsoOrNull(row.completedAt),
		completedBy: row.completedBy,
		noticeSentOn: row.noticeSentOn,
	};
}

export function toWorkflowSettings(row: typeof workflowSettings.$inferSelect): WorkflowSettings {
	return {
		facilityId: row.facilityId,
		pcwRequiresRnReview: row.pcwRequiresRnReview,
		reviewRecordTypes: row.reviewRecordTypes,
		unreviewedReminderMinutes: row.unreviewedReminderMinutes,
		escalateTo: row.escalateTo,
		incidentNotifyRoles: row.incidentNotifyRoles.filter((role) => role !== 'no_app'),
		transferToFacilitySystemDays: row.transferToFacilitySystemDays,
		transferOwnerStaffId: row.transferOwnerStaffId,
	};
}

// The password hash and last-login time never leave the server.
export function toStaff(row: StaffRow, assignments: StaffAssignment[]): Staff {
	return {
		id: row.id,
		organisationId: row.organisationId,
		givenName: row.givenName,
		familyName: row.familyName,
		position: row.position,
		employmentType: row.employmentType,
		isOrgAdmin: row.isOrgAdmin,
		hasAppAccess: row.hasAppAccess,
		email: row.email,
		lifecycle: row.lifecycle,
		trainingCompletedAt: toIsoOrNull(row.trainingCompletedAt),
		assignments,
		createdAt: toIso(row.createdAt),
		updatedAt: toIso(row.updatedAt),
	};
}

export function toCredential(row: CredentialRow, today: IsoDate): Credential {
	return {
		id: row.id,
		staffId: row.staffId,
		kind: row.kind,
		reference: row.reference,
		expiresAt: row.expiresAt,
		reminder: credentialReminder(row.expiresAt, today),
		createdAt: toIso(row.createdAt),
		updatedAt: toIso(row.updatedAt),
	};
}

export function toResident(row: ResidentRow): Resident {
	return {
		id: row.id,
		organisationId: row.organisationId,
		facilityId: row.facilityId,
		givenName: row.givenName,
		preferredName: row.preferredName,
		familyName: row.familyName,
		room: row.room,
		status: row.status,
		createdAt: toIso(row.createdAt),
		updatedAt: toIso(row.updatedAt),
	};
}

export function toResidentEvent(row: typeof residentEvents.$inferSelect): ResidentEvent {
	return {
		id: row.id,
		residentId: row.residentId,
		type: row.type,
		fromFacilityId: row.fromFacilityId,
		toFacilityId: row.toFacilityId,
		occurredAt: toIso(row.occurredAt),
		recordedBy: row.recordedBy,
	};
}

// No consent row means "unknown", treated as not consented (SPEC-009 M-02, PA-03a).
export function toConsent(
	residentId: string,
	row: typeof consents.$inferSelect | undefined,
): Consent {
	if (row === undefined) {
		return {
			residentId,
			status: 'unknown',
			source: null,
			jurisdiction: null,
			basisNote: null,
			recordedBy: null,
			recordedAt: null,
		};
	}
	return {
		residentId,
		status: row.status,
		source: row.source,
		jurisdiction: row.jurisdiction,
		basisNote: row.basisNote,
		recordedBy: row.recordedBy,
		recordedAt: toIsoOrNull(row.recordedAt),
	};
}
