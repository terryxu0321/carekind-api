// SPEC-010 SA-02 / SPEC-011 PA-04: facilities configure within organisation limits, and the
// platform caps the number of facilities. Synthetic data only.
import { type WorkflowSettingsBody } from '@carekind/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApi, expectApiError, requireKey, startTestApi } from './helpers.js';

let api: TestApi;
let orgA: TestApi['seed']['organisations']['orgA'];
let admin: ReturnType<TestApi['client']>;
let platform: ReturnType<TestApi['client']>;

async function setLimits(
	enabledRecordTypes: ('progress_note' | 'adl')[],
	facilityLimit: number,
): Promise<void> {
	await platform.platform.updateOrganisationLimits(orgA.id, {
		enabledRecordTypes,
		pcwRequiresRnReview: true,
		audioRetentionDaysMax: 7,
		aiProcessingEnabled: true,
		facilityLimit,
	});
}

beforeAll(async () => {
	api = await startTestApi();
	orgA = api.seed.organisations.orgA;
	admin = api.client(await api.login(requireKey(orgA.emails, 'orgAdmin'), 'org'));
	platform = api.client(await api.login(api.seed.platformAdminEmail, 'platform'));
});

afterAll(async () => {
	await api.close();
});

describe('workflow settings limits', () => {
	it('should_reject_record_types_the_organisation_has_not_enabled', async () => {
		const nsw1 = requireKey(orgA.facilityIds, 'nsw1');
		await setLimits(['progress_note'], 10);
		const current = await admin.org.getWorkflowSettings(nsw1);
		const body: WorkflowSettingsBody = {
			pcwRequiresRnReview: current.pcwRequiresRnReview,
			reviewRecordTypes: ['progress_note', 'adl'],
			unreviewedReminderMinutes: 90,
			escalateTo: 'don',
			incidentNotifyRoles: ['don', 'rn'],
			transferToFacilitySystemDays: 5,
			transferOwnerStaffId: requireKey(orgA.staffIds, 'don'),
		};
		await expectApiError(admin.org.updateWorkflowSettings(nsw1, body), 'limit_exceeded');
		const saved = await admin.org.updateWorkflowSettings(nsw1, {
			...body,
			reviewRecordTypes: ['progress_note'],
		});
		expect(saved).toMatchObject({ reviewRecordTypes: ['progress_note'], escalateTo: 'don' });
	});

	it('should_reject_a_transfer_owner_from_another_organisation', async () => {
		const nsw1 = requireKey(orgA.facilityIds, 'nsw1');
		const current = await admin.org.getWorkflowSettings(nsw1);
		const body = { ...current, facilityId: undefined };
		await expectApiError(
			admin.org.updateWorkflowSettings(nsw1, {
				...body,
				transferOwnerStaffId: requireKey(api.seed.organisations.orgB.staffIds, 'orgAdmin'),
			}),
			'validation_failed',
		);
	});
});

describe('facility limit', () => {
	it('should_stop_creating_facilities_at_the_limit', async () => {
		const facility = {
			name: 'Synthetic Limit Test',
			address: '6 Example Street, Sydney NSW 2000',
			state: 'NSW' as const,
			beds: 12,
			timezone: 'Australia/Sydney',
		};
		await setLimits(['progress_note', 'adl'], 3);
		await expectApiError(admin.org.createFacility(facility), 'limit_exceeded');
		await setLimits(['progress_note', 'adl'], 4);
		const created = await admin.org.createFacility(facility);
		expect(created.status).toBe('configuring');
		const settings = await admin.org.getWorkflowSettings(created.id);
		expect(settings.reviewRecordTypes).toEqual(['progress_note', 'adl']);
	});
});
