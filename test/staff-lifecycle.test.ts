// SPEC-011 §3.2 staff lifecycle: invite link (never emailed), accept, training, deactivation that
// takes effect immediately on existing tokens. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApi, expectApiError, requireKey, startTestApi } from './helpers.js';

let api: TestApi;
let orgA: TestApi['seed']['organisations']['orgA'];
let admin: ReturnType<TestApi['client']>;

beforeAll(async () => {
	api = await startTestApi();
	orgA = api.seed.organisations.orgA;
	admin = api.client(await api.login(requireKey(orgA.emails, 'orgAdmin'), 'org'));
});

afterAll(async () => {
	await api.close();
});

describe('staff lifecycle', () => {
	it('should_invite_accept_train_and_deactivate_with_immediate_effect', async () => {
		const nsw1 = requireKey(orgA.facilityIds, 'nsw1');
		const created = await admin.org.createStaff({
			givenName: 'Synthetic',
			familyName: 'Newstarter',
			position: 'Facility Manager',
			employmentType: 'full_time',
			hasAppAccess: false,
			email: 'org-a.newstarter@example.com',
			assignments: [{ facilityId: nsw1, role: 'facility_manager' }],
		});
		expect(created.lifecycle).toBe('recorded');
		const invite = await admin.org.inviteStaff(created.id);
		const inviteToken = new URL(invite.inviteUrl).searchParams.get('token') ?? '';
		const newPassword = `${api.password}-starter`;
		const session = await api
			.client(null)
			.auth.acceptInvite({ token: inviteToken, newPassword });
		expect(session.me).toMatchObject({
			audience: 'org',
			staffId: created.id,
			isOrgAdmin: false,
		});
		await expectApiError(
			api.client(null).auth.acceptInvite({ token: inviteToken, newPassword }),
			'invite_invalid',
		);

		const member = api.client(session.accessToken);
		expect((await member.org.listFacilities()).map((facility) => facility.id)).toEqual([nsw1]);
		const trained = await admin.org.completeStaffTraining(created.id);
		expect(trained.lifecycle).toBe('active');
		expect(trained.trainingCompletedAt).not.toBeNull();

		const deactivated = await admin.org.deactivateStaff(created.id);
		expect(deactivated.lifecycle).toBe('deactivated');
		await expectApiError(member.org.listFacilities(), 'unauthenticated');
		await expectApiError(
			api.client(null).auth.login({
				audience: 'org',
				email: 'org-a.newstarter@example.com',
				password: newPassword,
			}),
			'unauthenticated',
		);
		await expectApiError(admin.org.deactivateStaff(created.id), 'invalid_transition');
	});

	it('should_reject_invalid_lifecycle_steps', async () => {
		await expectApiError(
			admin.org.completeStaffTraining(requireKey(orgA.staffIds, 'kitchen')),
			'invalid_transition',
		);
		await expectApiError(
			admin.org.inviteStaff(requireKey(orgA.staffIds, 'kitchen')),
			'validation_failed',
		);
	});

	it('should_stop_facility_roles_from_touching_org_admins_and_self_deactivation', async () => {
		const manager = api.client(
			await api.login(requireKey(orgA.emails, 'facilityManager'), 'org'),
		);
		await expectApiError(
			manager.org.getStaff(requireKey(orgA.staffIds, 'orgAdmin')),
			'forbidden',
		);
		await expectApiError(
			admin.org.deactivateStaff(requireKey(orgA.staffIds, 'orgAdmin')),
			'conflict',
		);
	});

	it('should_require_email_for_app_access', async () => {
		await expectApiError(
			admin.org.updateStaff(requireKey(orgA.staffIds, 'kitchen'), { hasAppAccess: true }),
			'validation_failed',
		);
	});

	it('should_compute_credential_reminders_and_never_deactivate', async () => {
		const rnId = requireKey(orgA.staffIds, 'rn');
		const credentials = await admin.org.listCredentials(rnId);
		expect(credentials.map((item) => item.reminder).sort()).toEqual([
			'due_30',
			'due_60',
			'none',
		]);
		const added = await admin.org.createCredential(rnId, {
			kind: 'police_check',
			reference: 'PC-SYNTH-9',
			expiresAt: '2000-01-01',
		});
		expect(added.reminder).toBe('expired');
		const updated = await admin.org.updateCredential(rnId, added.id, { expiresAt: null });
		expect(updated.reminder).toBe('none');
		await admin.org.deleteCredential(rnId, added.id);
		await expectApiError(admin.org.deleteCredential(rnId, added.id), 'not_found');
		expect((await admin.org.getStaff(rnId)).lifecycle).toBe('active');
	});
});
