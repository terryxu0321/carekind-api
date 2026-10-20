// Tech design §2 permission table / SPEC-011 PA-01a: facility-level roles act only where they
// are assigned, and only with that facility's role. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApi, expectApiError, requireKey, startTestApi } from './helpers.js';

let api: TestApi;
let orgA: TestApi['seed']['organisations']['orgA'];
let nsw1: string;
let nsw2: string;
let vic: string;

async function clientAs(role: string): Promise<ReturnType<TestApi['client']>> {
	return api.client(await api.login(requireKey(orgA.emails, role), 'org'));
}

beforeAll(async () => {
	api = await startTestApi();
	orgA = api.seed.organisations.orgA;
	nsw1 = requireKey(orgA.facilityIds, 'nsw1');
	nsw2 = requireKey(orgA.facilityIds, 'nsw2');
	vic = requireKey(orgA.facilityIds, 'vic');
});

afterAll(async () => {
	await api.close();
});

describe('facility manager (NSW 1 only)', () => {
	it('should_see_only_the_assigned_facility', async () => {
		const client = await clientAs('facilityManager');
		expect((await client.org.listFacilities()).map((facility) => facility.id)).toEqual([nsw1]);
		expect((await client.org.getOverview()).map((row) => row.facilityId)).toEqual([nsw1]);
		await expectApiError(client.org.getFacility(vic), 'forbidden');
		await expectApiError(client.org.listResidents(vic), 'forbidden');
		await expectApiError(client.org.getGoLive(nsw2), 'forbidden');
		await expectApiError(client.org.getWorkflowSettings(vic), 'forbidden');
		await expectApiError(client.org.listStaff({ facilityId: vic }), 'forbidden');
	});

	it('should_list_only_staff_assigned_to_the_facility', async () => {
		const client = await clientAs('facilityManager');
		const staff = await client.org.listStaff();
		expect(staff.length).toBeGreaterThan(0);
		for (const member of staff) {
			expect(member.assignments.some((item) => item.facilityId === nsw1)).toBe(true);
		}
		await expectApiError(client.org.getStaff(requireKey(orgA.staffIds, 'adminOfficer')), 'forbidden');
	});

	it('should_not_create_facilities_or_change_org_admins', async () => {
		const client = await clientAs('facilityManager');
		await expectApiError(
			client.org.createFacility({
				name: 'Synthetic Unauthorised',
				address: '4 Example Street, Sydney NSW 2000',
				state: 'NSW',
				beds: 10,
				timezone: 'Australia/Sydney',
			}),
			'forbidden',
		);
		await expectApiError(
			client.org.updateStaff(requireKey(orgA.staffIds, 'rn'), { isOrgAdmin: true }),
			'forbidden',
		);
	});

	it('should_keep_assignments_at_other_facilities_unchanged', async () => {
		const client = await clientAs('facilityManager');
		const pcwId = requireKey(orgA.staffIds, 'pcw');
		await expectApiError(
			client.org.updateStaffAssignments(pcwId, {
				assignments: [{ facilityId: nsw2, role: 'facility_manager' }],
			}),
			'forbidden',
		);
		const updated = await client.org.updateStaffAssignments(pcwId, {
			assignments: [{ facilityId: nsw1, role: 'en' }],
		});
		expect(updated.assignments).toEqual(
			expect.arrayContaining([
				{ facilityId: nsw1, role: 'en' },
				{ facilityId: nsw2, role: 'pcw' },
			]),
		);
	});

	it('should_see_only_own_facility_audit_entries', async () => {
		const client = await clientAs('facilityManager');
		await client.org.updateFacility(nsw1, { beds: 61 });
		const admin = await clientAs('orgAdmin');
		await admin.org.updateFacility(vic, { beds: 31 });
		const entries = await client.org.listAudit();
		expect(entries.some((entry) => entry.entityId === nsw1)).toBe(true);
		expect(entries.some((entry) => entry.entityId === vic)).toBe(false);
	});
});

describe('DON (NSW 1 don, NSW 2 rn)', () => {
	it('should_use_the_role_of_each_facility', async () => {
		const client = await clientAs('don');
		await client.org.getWorkflowSettings(nsw1);
		await expectApiError(client.org.getWorkflowSettings(nsw2), 'forbidden');
		expect((await client.org.listFacilities()).map((facility) => facility.id)).toEqual([nsw1]);
	});

	it('should_not_manage_staff_go_live_or_audit', async () => {
		const client = await clientAs('don');
		await expectApiError(client.org.listStaff(), 'forbidden');
		await expectApiError(client.org.getGoLive(nsw1), 'forbidden');
		await expectApiError(client.org.listAudit(), 'forbidden');
		await expectApiError(client.org.updateFacility(nsw1, { beds: 70 }), 'forbidden');
	});

	it('should_manage_residents_and_consent_at_nsw1', async () => {
		const client = await clientAs('don');
		const residents = await client.org.listResidents(nsw1);
		const resident = residents.find((item) => item.status === 'in_residence');
		expect(resident).toBeDefined();
		const consent = await client.org.updateConsent(resident?.id ?? '', {
			status: 'consented',
			source: 'self',
			jurisdiction: 'NSW',
		});
		expect(consent.status).toBe('consented');
	});
});

describe('admin officer (VIC)', () => {
	it('should_manage_staff_and_residents_but_not_workflow', async () => {
		const client = await clientAs('adminOfficer');
		await client.org.listStaff({ facilityId: vic });
		await client.org.listResidents(vic);
		await expectApiError(client.org.getWorkflowSettings(vic), 'forbidden');
		await expectApiError(client.org.listResidents(nsw1), 'forbidden');
	});
});

describe('org admin', () => {
	it('should_reach_every_facility', async () => {
		const client = await clientAs('orgAdmin');
		const ids = (await client.org.listFacilities()).map((facility) => facility.id).sort();
		expect(ids).toEqual([nsw1, nsw2, vic].sort());
		const overview = await client.org.getOverview();
		expect(overview).toHaveLength(3);
	});
});
