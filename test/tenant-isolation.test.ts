// SPEC-010 SA-01a / §9 and SPEC-011 PA-01a: every org endpoint must refuse another organisation's
// records, and platform and org tokens must never cross. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApi, expectApiError, requireKey, startTestApi } from './helpers.js';

// Deliberately invalid test inputs, not secrets.
const MALFORMED_JWT = 'not.a.jwt';
const INCORRECT_LOGIN = 'wrong-password';

let api: TestApi;
let orgBToken: string;
let orgA: TestApi['seed']['organisations']['orgA'];

beforeAll(async () => {
	api = await startTestApi();
	orgA = api.seed.organisations.orgA;
	orgBToken = await api.login(requireKey(api.seed.organisations.orgB.emails, 'orgAdmin'), 'org');
});

afterAll(async () => {
	await api.close();
});

describe('cross-organisation access', () => {
	it('should_deny_every_org_endpoint_on_another_organisations_records', async () => {
		const facilityId = requireKey(orgA.facilityIds, 'nsw1');
		const staffId = requireKey(orgA.staffIds, 'rn');
		const residentId = requireKey(orgA.residentIds, 'nsw1-1');
		const credentialId = '00000000-0000-4000-8000-000000000000';
		const attempts: [string, string, unknown?][] = [
			['GET', `/org/facilities/${facilityId}`],
			['PATCH', `/org/facilities/${facilityId}`, { name: 'Taken over' }],
			['GET', `/org/facilities/${facilityId}/go-live`],
			[
				'PATCH',
				`/org/facilities/${facilityId}/go-live/items/contract_signed`,
				{ completed: true },
			],
			['POST', `/org/facilities/${facilityId}/go-live/activate`],
			['GET', `/org/facilities/${facilityId}/workflow-settings`],
			['GET', `/org/facilities/${facilityId}/residents`],
			[
				'POST',
				`/org/facilities/${facilityId}/residents`,
				{ givenName: 'X', familyName: 'Y' },
			],
			['GET', `/org/staff?facilityId=${facilityId}`],
			['GET', `/org/staff/${staffId}`],
			['PATCH', `/org/staff/${staffId}`, { position: 'Changed' }],
			['PUT', `/org/staff/${staffId}/assignments`, { assignments: [] }],
			['POST', `/org/staff/${staffId}/invite`],
			['POST', `/org/staff/${staffId}/training-complete`],
			['POST', `/org/staff/${staffId}/deactivate`],
			['GET', `/org/staff/${staffId}/credentials`],
			['POST', `/org/staff/${staffId}/credentials`, { kind: 'police_check' }],
			['PATCH', `/org/staff/${staffId}/credentials/${credentialId}`, { reference: 'X' }],
			['DELETE', `/org/staff/${staffId}/credentials/${credentialId}`],
			['GET', `/org/residents/${residentId}`],
			['PATCH', `/org/residents/${residentId}`, { room: 'Z1' }],
			[
				'POST',
				`/org/residents/${residentId}/events`,
				{ type: 'depart', occurredAt: new Date().toISOString() },
			],
			['GET', `/org/residents/${residentId}/consent`],
			[
				'PUT',
				`/org/residents/${residentId}/consent`,
				{ status: 'consented', source: 'self', jurisdiction: 'NSW' },
			],
		];
		for (const [method, path, body] of attempts) {
			const response = await api.raw(method, path, { token: orgBToken, json: body });
			expect([403, 404], `${method} ${path}`).toContain(response.status);
		}
	});

	it('should_list_only_own_facilities_staff_and_audit', async () => {
		const client = api.client(orgBToken);
		const orgBFacility = requireKey(api.seed.organisations.orgB.facilityIds, 'orgBNsw');
		const facilities = await client.org.listFacilities();
		expect(facilities.map((facility) => facility.id)).toEqual([orgBFacility]);
		const staff = await client.org.listStaff();
		expect(
			staff.every((member) => member.organisationId === api.seed.organisations.orgB.id),
		).toBe(true);
		const overview = await client.org.getOverview();
		expect(overview.map((row) => row.facilityId)).toEqual([orgBFacility]);
		const audit = await client.org.listAudit();
		expect(
			audit.every((entry) => entry.organisationId === api.seed.organisations.orgB.id),
		).toBe(true);
	});

	it('should_reject_assigning_staff_to_another_organisations_facility', async () => {
		const client = api.client(orgBToken);
		await expectApiError(
			client.org.createStaff({
				givenName: 'Synthetic',
				familyName: 'Crossover',
				position: 'PCW',
				employmentType: 'casual',
				hasAppAccess: false,
				assignments: [{ facilityId: requireKey(orgA.facilityIds, 'nsw1'), role: 'pcw' }],
			}),
			'validation_failed',
		);
	});

	it('should_not_move_a_resident_to_another_organisation', async () => {
		const orgAToken = await api.login(requireKey(orgA.emails, 'orgAdmin'), 'org');
		await expectApiError(
			api.client(orgAToken).org.recordResidentEvent(requireKey(orgA.residentIds, 'nsw1-2'), {
				type: 'transfer_out',
				occurredAt: new Date().toISOString(),
				toFacilityId: requireKey(api.seed.organisations.orgB.facilityIds, 'orgBNsw'),
			}),
			'not_found',
		);
	});
});

describe('audiences', () => {
	it('should_require_a_token', async () => {
		const response = await api.raw('GET', '/org/facilities');
		expect(response.status).toBe(401);
		expect(response.body).toEqual({
			error: { code: 'unauthenticated', message: 'Please sign in' },
		});
	});

	it('should_refuse_org_tokens_on_platform_endpoints', async () => {
		const response = await api.raw('GET', '/platform/organisations', { token: orgBToken });
		expect(response.status).toBe(403);
	});

	it('should_refuse_platform_tokens_on_org_endpoints', async () => {
		const platformToken = await api.login(api.seed.platformAdminEmail, 'platform');
		const response = await api.raw('GET', '/org/overview', { token: platformToken });
		expect(response.status).toBe(403);
	});

	it('should_reject_a_forged_token', async () => {
		const response = await api.raw('GET', '/auth/me', { token: MALFORMED_JWT });
		expect(response.status).toBe(401);
	});

	it('should_not_reveal_whether_an_email_exists', async () => {
		const client = api.client(null);
		await expectApiError(
			client.auth.login({
				audience: 'org',
				email: 'nobody@example.com',
				password: INCORRECT_LOGIN,
			}),
			'unauthenticated',
		);
		await expectApiError(
			client.auth.login({
				audience: 'org',
				email: requireKey(orgA.emails, 'orgAdmin'),
				password: INCORRECT_LOGIN,
			}),
			'unauthenticated',
		);
	});
});
