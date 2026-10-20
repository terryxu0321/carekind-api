// SPEC-010 SA-02a platform defaults and SA-04 usage (aggregate counts only, no per-person figures).
import { Inject, Injectable } from '@nestjs/common';
import {
	type FacilityUsage,
	NURSE_APP_NOT_LIVE,
	type OrganisationUsage,
	type PlatformDefaults,
	type UsageResponse,
} from '@carekind/shared';
import { asc } from 'drizzle-orm';
import { type PlatformPrincipal, auditActorOf } from '../auth/principal.js';
import { AuditService } from '../common/audit.service.js';
import { DATABASE } from '../common/tokens.js';
import type { Database } from '../db/database.js';
import { currentPlatformDefaults } from '../db/queries.js';
import {
	facilities,
	organisations,
	platformDefaults,
	staff,
	staffAssignments,
} from '../db/schema.js';

const LOGIN_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface UsageStaff {
	id: string;
	hasAppAccess: boolean;
	lifecycle: string;
	lastLoginAt: Date | null;
}

interface UsageCounts {
	appEnabledStaffCount: number;
	staffLoggedInLast7Days: number;
}

function countUsage(members: readonly UsageStaff[], loginSince: Date): UsageCounts {
	const current = members.filter((member) => member.lifecycle !== 'deactivated');
	return {
		appEnabledStaffCount: current.filter((member) => member.hasAppAccess).length,
		staffLoggedInLast7Days: current.filter(
			(member) => member.lastLoginAt !== null && member.lastLoginAt >= loginSince,
		).length,
	};
}

// Segment and sign-off counts need the nurse app; shown as "no data yet", never invented (CORE-09).
const NURSE_APP_METRICS = {
	segmentCount: NURSE_APP_NOT_LIVE,
	signedRecordCount: NURSE_APP_NOT_LIVE,
};

@Injectable()
export class PlatformSettingsService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly audit: AuditService,
	) {}

	getDefaults(): Promise<PlatformDefaults> {
		return currentPlatformDefaults(this.db);
	}

	// SA-02a: changes apply to organisations created afterwards; existing limits stay as they are.
	async updateDefaults(
		actor: PlatformPrincipal,
		defaults: PlatformDefaults,
	): Promise<PlatformDefaults> {
		return this.db.transaction(async (tx) => {
			await tx.update(platformDefaults).set({ ...defaults, updatedAt: new Date() });
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: null,
				action: 'platform.defaults',
				entity: 'platform_defaults',
				entityId: null,
				summary: 'Updated platform defaults',
			});
			return currentPlatformDefaults(tx);
		});
	}

	async usage(now: Date = new Date()): Promise<UsageResponse> {
		const loginSince = new Date(now.getTime() - LOGIN_WINDOW_DAYS * MS_PER_DAY);
		const [orgRows, facilityRows, staffRows, assignmentRows] = await Promise.all([
			this.db.select().from(organisations).orderBy(asc(organisations.name)),
			this.db.select().from(facilities).orderBy(asc(facilities.name)),
			this.db.select().from(staff),
			this.db.select().from(staffAssignments),
		]);
		const staffById = new Map(staffRows.map((row) => [row.id, row]));
		return orgRows.map((organisation): OrganisationUsage => {
			const orgFacilities = facilityRows.filter(
				(row) => row.organisationId === organisation.id,
			);
			const facilityUsage = orgFacilities.map((facility): FacilityUsage => {
				const members = assignmentRows
					.filter((assignment) => assignment.facilityId === facility.id)
					.map((assignment) => staffById.get(assignment.staffId))
					.filter((member) => member !== undefined);
				return {
					facilityId: facility.id,
					facilityName: facility.name,
					...countUsage(members, loginSince),
					...NURSE_APP_METRICS,
				};
			});
			const orgStaff = staffRows.filter((row) => row.organisationId === organisation.id);
			return {
				organisationId: organisation.id,
				organisationName: organisation.name,
				facilityCount: orgFacilities.length,
				facilities: facilityUsage,
				...countUsage(orgStaff, loginSince),
				...NURSE_APP_METRICS,
			};
		});
	}
}
