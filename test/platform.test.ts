// SPEC-010: Super Admin endpoints. SA-05 field scan — no platform response may carry residents,
// consents or staff-register detail beyond org-admin summaries. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApi, expectApiError, requireKey, startTestApi } from './helpers.js';

// Keys that only exist on resident, consent or staff-register shapes (SA-05).
const FORBIDDEN_KEYS = new Set([
	'residents',
	'resident',
	'residentId',
	'preferredName',
	'room',
	'consent',
	'consents',
	'basisNote',
	'jurisdiction',
	'position',
	'employmentType',
	'hasAppAccess',
	'assignments',
	'credentials',
	'passwordHash',
	'password_hash',
]);
// Personal names are allowed only in org-admin summaries (SA-03).
const NAME_KEYS = new Set(['givenName', 'familyName']);

function scan(value: unknown, path: string, allowNames: boolean, found: string[]): void {
	if (Array.isArray(value)) {
		value.forEach((item, index) => scan(item, `${path}[${index}]`, allowNames, found));
		return;
	}
	if (typeof value !== 'object' || value === null) {
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		if (FORBIDDEN_KEYS.has(key) || (!allowNames && NAME_KEYS.has(key))) {
			found.push(`${path}.${key}`);
		}
		scan(child, `${path}.${key}`, allowNames, found);
	}
}

let api: TestApi;
let platformToken: string;
let orgAId: string;

beforeAll(async () => {
	api = await startTestApi();
	platformToken = await api.login(api.seed.platformAdminEmail, 'platform');
	orgAId = api.seed.organisations.orgA.id;
});

afterAll(async () => {
	await api.close();
});

describe('SA-05 platform response field scan', () => {
	it('should_never_return_resident_consent_or_staff_register_fields', async () => {
		const reads: [string, boolean][] = [
			['/platform/organisations', false],
			[`/platform/organisations/${orgAId}`, false],
			[`/platform/organisations/${orgAId}/facilities`, false],
			[`/platform/organisations/${orgAId}/admins`, true],
			['/platform/defaults', false],
			['/platform/usage', false],
			['/platform/audit', false],
		];
		const found: string[] = [];
		for (const [path, allowNames] of reads) {
			const response = await api.raw('GET', path, { token: platformToken });
			expect(response.status, path).toBe(200);
			scan(response.body, path, allowNames, found);
		}
		expect(found).toEqual([]);
	});

	it('should_report_usage_as_aggregates_with_nurse_app_metrics_unavailable', async () => {
		const usage = await api.client(platformToken).platform.getUsage();
		const orgA = usage.find((row) => row.organisationId === orgAId);
		expect(orgA?.facilityCount).toBe(3);
		expect(orgA?.segmentCount).toEqual({ value: null, reason: 'nurse_app_not_live' });
		expect(orgA?.facilities).toHaveLength(3);
	});
});

describe('organisations', () => {
	it('should_copy_platform_defaults_into_a_new_organisation', async () => {
		const client = api.client(platformToken).platform;
		const defaults = await client.updateDefaults({
			enabledRecordTypes: ['progress_note'],
			pcwRequiresRnReview: true,
			audioRetentionDaysMax: 5,
			aiProcessingEnabled: true,
			facilityLimit: 4,
		});
		const created = await client.createOrganisation({
			name: 'Synthetic Care Group C',
			abn: '51 000 000 003',
			contactName: 'Synthetic Contact',
			contactEmail: 'contact@org-c.example.com',
		});
		expect(created.abn).toBe('51000000003');
		expect(created.limits).toEqual(defaults);
		expect(created.status).toBe('active');
	});

	it('should_reject_audio_retention_above_seven_days', async () => {
		await expectApiError(
			api.client(platformToken).platform.updateOrganisationLimits(orgAId, {
				enabledRecordTypes: ['progress_note', 'adl'],
				pcwRequiresRnReview: true,
				audioRetentionDaysMax: 8,
				aiProcessingEnabled: true,
				facilityLimit: 10,
			}),
			'validation_failed',
		);
	});

	it('should_block_every_sign_in_while_suspended_and_restore_on_reactivate', async () => {
		const orgB = api.seed.organisations.orgB;
		const email = requireKey(orgB.emails, 'orgAdmin');
		const orgToken = await api.login(email, 'org');
		const client = api.client(platformToken).platform;
		await client.suspendOrganisation(orgB.id);
		await expectApiError(client.suspendOrganisation(orgB.id), 'conflict');
		await expectApiError(api.client(orgToken).auth.me(), 'organisation_suspended');
		await expectApiError(
			api.client(null).auth.login({ audience: 'org', email, password: api.password }),
			'organisation_suspended',
		);
		const reactivated = await client.reactivateOrganisation(orgB.id);
		expect(reactivated.status).toBe('active');
		const me = await api.client(orgToken).auth.me();
		expect(me.audience).toBe('org');
	});

	it('should_audit_platform_actions_without_resident_data', async () => {
		const entries = await api.client(platformToken).platform.listAudit();
		expect(entries.length).toBeGreaterThan(0);
		expect(entries.every((entry) => entry.actorType === 'platform_admin')).toBe(true);
	});
});

describe('organisation admins (SA-03)', () => {
	it('should_invite_accept_and_deactivate_an_org_admin', async () => {
		const client = api.client(platformToken).platform;
		const invite = await client.inviteOrganisationAdmin(orgAId, {
			givenName: 'Synthetic',
			familyName: 'Newadmin',
			email: 'org-a.second-admin@example.com',
		});
		const inviteUrl = new URL(invite.inviteUrl);
		expect(inviteUrl.origin).toBe('http://localhost:5174');
		const inviteToken = inviteUrl.searchParams.get('token') ?? '';
		// Re-inviting retires the first link.
		const reissued = await client.inviteOrganisationAdmin(orgAId, {
			givenName: 'Synthetic',
			familyName: 'Newadmin',
			email: 'org-a.second-admin@example.com',
		});
		const newToken = new URL(reissued.inviteUrl).searchParams.get('token') ?? '';
		const newPassword = `${api.password}-new`;
		await expectApiError(
			api.client(null).auth.acceptInvite({ token: inviteToken, newPassword }),
			'invite_invalid',
		);
		const session = await api.client(null).auth.acceptInvite({ token: newToken, newPassword });
		expect(session.me.audience).toBe('org');
		const admins = await client.listOrganisationAdmins(orgAId);
		const added = admins.find((admin) => admin.staffId === invite.staffId);
		expect(added?.lifecycle).toBe('pending_training');
		const deactivated = await client.deactivateOrganisationAdmin(invite.staffId);
		expect(deactivated.lifecycle).toBe('deactivated');
		await expectApiError(api.client(session.accessToken).auth.me(), 'unauthenticated');
	});

	it('should_refuse_an_email_registered_elsewhere', async () => {
		await expectApiError(
			api.client(platformToken).platform.inviteOrganisationAdmin(orgAId, {
				givenName: 'Synthetic',
				familyName: 'Duplicate',
				email: requireKey(api.seed.organisations.orgB.emails, 'orgAdmin'),
			}),
			'conflict',
		);
	});
});
