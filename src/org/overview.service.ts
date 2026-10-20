// SPEC-011 PA-06 / PA-06a: facility-level aggregates only — no per-person metrics, no rankings,
// no clinical-risk indicators. Nurse-app metrics are "no data yet", never invented (CORE-09).
import { Inject, Injectable } from '@nestjs/common';
import {
	type ConsentStatus,
	type FacilityOverview,
	NURSE_APP_NOT_LIVE,
	consentCoverage,
	isCredentialDueWithin60Days,
	isRecordingConsented,
} from '@carekind/shared';
import { inArray } from 'drizzle-orm';
import type { StaffPrincipal } from '../auth/principal.js';
import { todayIn } from '../common/dates.js';
import { DATABASE } from '../common/tokens.js';
import type { Database } from '../db/database.js';
import { consents, credentials, residents, staff, staffAssignments } from '../db/schema.js';
import { type FacilityRow, OrgAccessService } from './org-access.service.js';

type StaffRow = typeof staff.$inferSelect;

interface OverviewData {
	residentRows: (typeof residents.$inferSelect)[];
	consentByResident: Map<string, ConsentStatus>;
	assignmentRows: (typeof staffAssignments.$inferSelect)[];
	staffById: Map<string, StaffRow>;
	credentialRows: (typeof credentials.$inferSelect)[];
}

function summarise(facility: FacilityRow, data: OverviewData): FacilityOverview {
	const inResidence = data.residentRows.filter(
		(row) => row.facilityId === facility.id && row.status === 'in_residence',
	);
	const consented = inResidence.filter((row) =>
		isRecordingConsented(data.consentByResident.get(row.id) ?? null),
	);
	const currentStaff = data.assignmentRows
		.filter((assignment) => assignment.facilityId === facility.id)
		.map((assignment) => data.staffById.get(assignment.staffId))
		.filter((member): member is StaffRow => member !== undefined)
		.filter((member) => member.lifecycle !== 'deactivated');
	const currentStaffIds = new Set(currentStaff.map((member) => member.id));
	const today = todayIn(facility.timezone);
	const credentialsDue = data.credentialRows.filter(
		(row) =>
			currentStaffIds.has(row.staffId) && isCredentialDueWithin60Days(row.expiresAt, today),
	);
	return {
		facilityId: facility.id,
		facilityName: facility.name,
		state: facility.state,
		status: facility.status,
		residentsInResidence: inResidence.length,
		residentsConsented: consented.length,
		consentCoverage: consentCoverage(consented.length, inResidence.length),
		currentStaffCount: currentStaff.length,
		appEnabledStaffCount: currentStaff.filter((member) => member.hasAppAccess).length,
		credentialsDueWithin60Days: credentialsDue.length,
		recordTimeliness: NURSE_APP_NOT_LIVE,
		pendingReviewCount: NURSE_APP_NOT_LIVE,
		pendingAttributionRatio: NURSE_APP_NOT_LIVE,
	};
}

@Injectable()
export class OverviewService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly access: OrgAccessService,
	) {}

	async overview(actor: StaffPrincipal): Promise<FacilityOverview[]> {
		const visible = await this.access.facilitiesWith(actor, 'view_overview');
		if (visible.length === 0) {
			return [];
		}
		const data = await this.load(visible.map((facility) => facility.id));
		return visible.map((facility) => summarise(facility, data));
	}

	private async load(facilityIds: string[]): Promise<OverviewData> {
		const [residentRows, assignmentRows] = await Promise.all([
			this.db.select().from(residents).where(inArray(residents.facilityId, facilityIds)),
			this.db
				.select()
				.from(staffAssignments)
				.where(inArray(staffAssignments.facilityId, facilityIds)),
		]);
		const residentIds = residentRows.map((row) => row.id);
		const staffIds = [...new Set(assignmentRows.map((row) => row.staffId))];
		const [consentRows, staffRows, credentialRows] = await Promise.all([
			residentIds.length === 0
				? []
				: this.db.select().from(consents).where(inArray(consents.residentId, residentIds)),
			staffIds.length === 0
				? []
				: this.db.select().from(staff).where(inArray(staff.id, staffIds)),
			staffIds.length === 0
				? []
				: this.db.select().from(credentials).where(inArray(credentials.staffId, staffIds)),
		]);
		return {
			residentRows,
			consentByResident: new Map(consentRows.map((row) => [row.residentId, row.status])),
			assignmentRows,
			staffById: new Map(staffRows.map((row) => [row.id, row])),
			credentialRows,
		};
	}
}
