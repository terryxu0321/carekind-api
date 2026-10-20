// 合成数据，仅用于开发与测试. Writes the synthetic dataset (synthetic-data.ts) into a migrated
// database. Used by `npm run seed` and by the API tests, so both exercise the same records.
import { GOLIVE_ITEM_KEYS, type IsoDate, addDays } from '@carekind/shared';
import { hashPassword } from '../auth/password.js';
import { todayIn } from '../common/dates.js';
import type { Database, Transaction } from '../db/database.js';
import { currentPlatformDefaults } from '../db/queries.js';
import {
	consents,
	credentials,
	facilities,
	goLiveItems,
	organisations,
	platformAdmins,
	residentEvents,
	residents,
	staff,
	staffAssignments,
	workflowSettings,
} from '../db/schema.js';
import { initialWorkflowSettings } from '../org/workflow-defaults.js';
import {
	type FacilityKey,
	SYNTHETIC_ORGANISATIONS,
	SYNTHETIC_PLATFORM_ADMIN,
	SYNTHETIC_RESIDENT_EVENTS_A,
	type SyntheticFacility,
	type SyntheticOrganisation,
	type SyntheticStaff,
} from './synthetic-data.js';

export interface SeededOrganisation {
	id: string;
	facilityIds: Partial<Record<FacilityKey, string>>;
	staffIds: Record<string, string>;
	residentIds: Record<string, string>;
	emails: Record<string, string>;
}

export interface SeedResult {
	platformAdminId: string;
	platformAdminEmail: string;
	organisations: Record<SyntheticOrganisation['key'], SeededOrganisation>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Accounts that have accepted their invite and can sign in (SPEC-011 §3.2).
const SIGNED_IN_LIFECYCLES = new Set(['pending_training', 'active']);

interface SeedContext {
	tx: Transaction;
	now: Date;
	today: IsoDate;
	passwordHash: string;
}

function requireId(map: Partial<Record<string, string>>, key: string): string {
	const id = map[key];
	if (id === undefined) {
		throw new Error(`Synthetic data refers to unknown key "${key}"`);
	}
	return id;
}

async function insertFacility(
	context: SeedContext,
	organisationId: string,
	facility: SyntheticFacility,
	orgAdminId: string,
): Promise<string> {
	const { tx, now, today } = context;
	const [row] = await tx
		.insert(facilities)
		.values({
			organisationId,
			name: facility.name,
			address: facility.address,
			state: facility.state,
			beds: facility.beds,
			timezone: facility.timezone,
			status: facility.isLive ? 'live' : 'configuring',
		})
		.returning({ id: facilities.id });
	const facilityId = requireId({ id: row?.id }, 'id');
	await tx.insert(goLiveItems).values(
		GOLIVE_ITEM_KEYS.map((key) => {
			const isDone = facility.completedItems.includes(key);
			const isNotice = key === 'staff_notice_sent' && facility.noticeDaysAgo !== null;
			return {
				organisationId,
				facilityId,
				key,
				completedAt: isDone ? now : null,
				completedBy: isDone ? orgAdminId : null,
				noticeSentOn: isDone && isNotice ? addDays(today, -(facility.noticeDaysAgo ?? 0)) : null,
			};
		}),
	);
	const limits = await currentPlatformDefaults(tx);
	await tx
		.insert(workflowSettings)
		.values({ organisationId, facilityId, ...initialWorkflowSettings(limits) });
	return facilityId;
}

async function insertStaff(
	context: SeedContext,
	organisationId: string,
	person: SyntheticStaff,
	facilityIds: Partial<Record<FacilityKey, string>>,
): Promise<string> {
	const { tx, now, today, passwordHash } = context;
	const [row] = await tx
		.insert(staff)
		.values({
			organisationId,
			givenName: person.givenName,
			familyName: person.familyName,
			position: person.position,
			employmentType: person.employmentType,
			isOrgAdmin: person.isOrgAdmin,
			hasAppAccess: person.hasAppAccess,
			email: person.email,
			lifecycle: person.lifecycle,
			passwordHash: SIGNED_IN_LIFECYCLES.has(person.lifecycle) ? passwordHash : null,
			trainingCompletedAt: person.lifecycle === 'active' ? now : null,
		})
		.returning({ id: staff.id });
	const staffId = requireId({ id: row?.id }, 'id');
	for (const assignment of person.assignments) {
		await tx.insert(staffAssignments).values({
			organisationId,
			staffId,
			facilityId: requireId(facilityIds, assignment.facility),
			role: assignment.role,
		});
	}
	for (const credential of person.credentials) {
		await tx.insert(credentials).values({
			organisationId,
			staffId,
			kind: credential.kind,
			reference: credential.reference,
			expiresAt:
				credential.expiresInDays === null ? null : addDays(today, credential.expiresInDays),
		});
	}
	return staffId;
}

async function insertResidents(
	context: SeedContext,
	organisation: SyntheticOrganisation,
	seeded: SeededOrganisation,
): Promise<void> {
	const { tx, now } = context;
	const recordedBy = requireId(seeded.staffIds, 'orgAdmin');
	for (const resident of organisation.residents) {
		const facilityId = requireId(seeded.facilityIds, resident.facility);
		const [row] = await tx
			.insert(residents)
			.values({
				organisationId: seeded.id,
				facilityId,
				givenName: resident.givenName,
				preferredName: resident.preferredName,
				familyName: resident.familyName,
				room: resident.room,
				status: resident.status,
			})
			.returning({ id: residents.id });
		const residentId = requireId({ id: row?.id }, 'id');
		seeded.residentIds[resident.key] = residentId;
		if (resident.consent !== null) {
			const facility = organisation.facilities.find((item) => item.key === resident.facility);
			const isUnknown = resident.consent.status === 'unknown';
			await tx.insert(consents).values({
				organisationId: seeded.id,
				residentId,
				status: resident.consent.status,
				source: resident.consent.source,
				jurisdiction: isUnknown ? null : (facility?.state ?? null),
				basisNote: null,
				recordedBy,
				recordedAt: now,
			});
		}
	}
}

async function insertResidentEvents(context: SeedContext, seeded: SeededOrganisation): Promise<void> {
	const { tx, now } = context;
	for (const event of SYNTHETIC_RESIDENT_EVENTS_A) {
		await tx.insert(residentEvents).values({
			organisationId: seeded.id,
			residentId: requireId(seeded.residentIds, event.resident),
			type: event.type,
			fromFacilityId: requireId(seeded.facilityIds, event.from),
			toFacilityId: event.to === null ? null : requireId(seeded.facilityIds, event.to),
			occurredAt: new Date(now.getTime() - event.daysAgo * MS_PER_DAY),
			recordedBy: requireId(seeded.staffIds, 'orgAdmin'),
		});
	}
}

async function insertOrganisation(
	context: SeedContext,
	organisation: SyntheticOrganisation,
): Promise<SeededOrganisation> {
	const limits = await currentPlatformDefaults(context.tx);
	const [row] = await context.tx
		.insert(organisations)
		.values({
			name: organisation.name,
			abn: organisation.abn,
			contactName: organisation.contactName,
			contactEmail: organisation.contactEmail,
			...limits,
		})
		.returning({ id: organisations.id });
	const seeded: SeededOrganisation = {
		id: requireId({ id: row?.id }, 'id'),
		facilityIds: {},
		staffIds: {},
		residentIds: {},
		emails: {},
	};
	const orgAdmin = organisation.staff.find((person) => person.key === 'orgAdmin');
	if (orgAdmin === undefined) {
		throw new Error('Each synthetic organisation needs an orgAdmin');
	}
	const orgAdminId = await insertStaff(context, seeded.id, orgAdmin, {});
	seeded.staffIds.orgAdmin = orgAdminId;
	for (const facility of organisation.facilities) {
		seeded.facilityIds[facility.key] = await insertFacility(context, seeded.id, facility, orgAdminId);
	}
	for (const person of organisation.staff.filter((item) => item.key !== 'orgAdmin')) {
		seeded.staffIds[person.key] = await insertStaff(context, seeded.id, person, seeded.facilityIds);
	}
	for (const person of organisation.staff) {
		if (person.email !== null && SIGNED_IN_LIFECYCLES.has(person.lifecycle)) {
			seeded.emails[person.key] = person.email;
		}
	}
	await insertResidents(context, organisation, seeded);
	return seeded;
}

export async function seedDatabase(
	db: Database,
	password: string,
	now: Date = new Date(),
): Promise<SeedResult> {
	const passwordHash = await hashPassword(password);
	return db.transaction(async (tx) => {
		const context: SeedContext = { tx, now, today: todayIn('Australia/Sydney', now), passwordHash };
		const [admin] = await tx
			.insert(platformAdmins)
			.values({ ...SYNTHETIC_PLATFORM_ADMIN, passwordHash })
			.returning({ id: platformAdmins.id });
		const [orgA, orgB] = SYNTHETIC_ORGANISATIONS;
		if (orgA === undefined || orgB === undefined) {
			throw new Error('Synthetic data must define two organisations');
		}
		const seededA = await insertOrganisation(context, orgA);
		await insertResidentEvents(context, seededA);
		const seededB = await insertOrganisation(context, orgB);
		return {
			platformAdminId: requireId({ id: admin?.id }, 'id'),
			platformAdminEmail: SYNTHETIC_PLATFORM_ADMIN.email,
			organisations: { orgA: seededA, orgB: seededB },
		};
	});
}
